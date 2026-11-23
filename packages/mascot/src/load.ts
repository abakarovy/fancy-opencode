import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseAsciiFrames, type AsciiClip } from "./frames"
import { gifDataUrl } from "./gif"
import { builtinPack } from "./builtin"
import { MASCOT_MAX_ACTIONS, type MascotPack } from "./pack"
import { MASCOT_STATES, type MascotState } from "./state"

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,64}$/
export const DESKTOP_PACK_NAME = "desktop-app"

export type LoadedMascot = {
  enabled: boolean
  /** False when the built-in mascot is in use, so a client can keep its bundled art. */
  custom: boolean
  name: string
  presenceSize: number
  badgeSize: number
  pixelated: boolean
  pack: MascotPack
}

type Manifest = {
  format?: unknown
  name?: unknown
  cli?: {
    cols?: unknown
    rows?: unknown
    intervalMs?: unknown
    states?: unknown
    badge?: {
      cols?: unknown
      rows?: unknown
      intervalMs?: unknown
      states?: unknown
    }
  }
  desktop?: {
    presence?: unknown
    badge?: unknown
    pixelated?: unknown
    states?: unknown
    badges?: unknown
    actions?: unknown
  }
}

export function mascotConfigDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR
  const home = env.OPENCODE_TEST_HOME || os.homedir()
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config")
  return path.join(base, "opencode")
}

/** Pack name, absolute directory, or `off`. An empty file keeps the built-in mascot. */
export function parseMascotChoice(value: string | undefined) {
  const choice = value?.trim()
  if (!choice) return { type: "builtin" as const }
  if (choice === "off") return { type: "off" as const }
  if (path.isAbsolute(choice)) return { type: "path" as const, path: choice }
  if (!NAME.test(choice)) return { type: "invalid" as const, choice }
  return { type: "name" as const, name: choice }
}

export function mascotChoiceFromCliConfig(text: string | undefined) {
  if (!text?.trim()) return
  try {
    const parsed = JSON.parse(text) as { mascot?: unknown }
    return typeof parsed.mascot === "string" ? parsed.mascot : undefined
  } catch {
    return
  }
}

export async function loadActiveMascot(configDir: string, override?: string): Promise<LoadedMascot> {
  const choice = await readChoice(configDir, override)
  const parsed = parseMascotChoice(choice)
  if (parsed.type === "off") return disabled()
  if (parsed.type === "builtin" || parsed.type === "invalid") return builtin()
  const directory =
    parsed.type === "path" ? parsed.path : path.join(configDir, "mascots", parsed.name)
  const pack = await loadMascotPack(directory)
  if (!pack) return builtin()
  return custom(pack)
}

/**
 * The desktop app's own pack, edited from its settings page. It wins over the shared choice when it exists,
 * so the CLI's mascot selection stays as it was.
 */
export async function loadDesktopMascot(configDir: string): Promise<LoadedMascot> {
  const pack = await loadMascotPack(desktopPackDir(configDir))
  if (pack) return custom(pack)
  return loadActiveMascot(configDir)
}

export function desktopPackDir(configDir: string) {
  return path.join(configDir, "mascots", DESKTOP_PACK_NAME)
}

function custom(pack: MascotPack): LoadedMascot {
  return {
    enabled: true,
    custom: true,
    name: pack.name,
    presenceSize: pack.desktop.presenceSize,
    badgeSize: pack.desktop.badgeSize,
    pixelated: pack.desktop.pixelated,
    pack,
  }
}

export async function loadMascotPack(directory: string): Promise<MascotPack | undefined> {
  const root = await realpath(directory).catch(() => undefined)
  if (!root) return
  const manifest = await readJson(path.join(root, "mascot.json"))
  if (!manifest || manifest.format !== 1 || typeof manifest.name !== "string" || !NAME.test(manifest.name)) return
  const cli = await readCli(root, manifest)
  const desktop = await readDesktop(root, manifest)
  if (!cli || !desktop) return
  return { format: 1, name: manifest.name, cli, desktop }
}

/** Copy a pack folder into the config mascots directory and check that it loads. */
export async function installMascotPack(source: string, configDir: string) {
  const pack = await loadMascotPack(source)
  if (!pack) return { installed: false as const }
  const destination = path.join(configDir, "mascots", pack.name)
  await mkdir(destination, { recursive: true })
  await copyPack(await realpath(source), destination)
  const loaded = await loadMascotPack(destination)
  if (!loaded) return { installed: false as const }
  await writeFile(path.join(configDir, "mascot"), `${pack.name}\n`)
  return { installed: true as const, name: pack.name, path: destination }
}

async function readChoice(configDir: string, override?: string) {
  if (override !== undefined) return override
  const fromCli = mascotChoiceFromCliConfig(await readText(path.join(configDir, "cli.json")))
  if (fromCli !== undefined) return fromCli
  return readText(path.join(configDir, "mascot"))
}

async function readCli(root: string, manifest: Manifest) {
  // A desktop-only pack has no terminal art. The CLI then shows nothing for it.
  if (manifest.cli === undefined) return { presence: {}, badge: {} }
  const cols = number(manifest.cli?.cols)
  const rows = number(manifest.cli?.rows)
  if (!cols || !rows) return
  const intervalMs = number(manifest.cli?.intervalMs) ?? 180
  const presence = await readClips(root, manifest.cli?.states, cols, rows, intervalMs)
  if (!presence?.idle) return
  const badgeCols = number(manifest.cli?.badge?.cols)
  const badgeRows = number(manifest.cli?.badge?.rows)
  const badge =
    badgeCols && badgeRows
      ? await readClips(
          root,
          manifest.cli?.badge?.states,
          badgeCols,
          badgeRows,
          number(manifest.cli?.badge?.intervalMs) ?? intervalMs,
        )
      : {}
  if (!badge) return
  return { presence, badge }
}

async function readDesktop(root: string, manifest: Manifest) {
  const presenceSize = number(manifest.desktop?.presence) ?? 240
  const badgeSize = number(manifest.desktop?.badge) ?? 40
  if (presenceSize < badgeSize) return
  const presence = await readImages(root, manifest.desktop?.states)
  const badge = await readImages(root, manifest.desktop?.badges)
  const actions = await readActions(root, manifest.desktop?.actions)
  if (!presence || !badge || !actions) return
  return {
    presenceSize,
    badgeSize,
    pixelated: manifest.desktop?.pixelated === true,
    presence,
    badge,
    actions,
  }
}

async function readClips(
  root: string,
  value: unknown,
  cols: number,
  rows: number,
  intervalMs: number,
): Promise<Partial<Record<MascotState, AsciiClip>> | undefined> {
  const files = stateFiles(value)
  if (!files) return
  const clips: Partial<Record<MascotState, AsciiClip>> = {}
  for (const state of MASCOT_STATES) {
    const relative = files[state]
    if (!relative) continue
    const file = await inside(root, relative)
    if (!file) return
    const text = await readText(file)
    if (text === undefined) return
    const frames = parseAsciiFrames(text, cols, rows)
    if (typeof frames === "string") return
    clips[state] = { cols, rows, intervalMs, frames }
  }
  return clips
}

async function readImages(root: string, value: unknown) {
  const files = stateFiles(value)
  if (!files) return
  const images: Partial<Record<MascotState, string>> = {}
  for (const state of MASCOT_STATES) {
    const relative = files[state]
    if (!relative) continue
    const file = await inside(root, relative)
    if (!file) return
    const url = await imageUrl(file)
    if (!url) return
    images[state] = url
  }
  return images
}

async function readActions(root: string, value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MASCOT_MAX_ACTIONS) return
  const actions: string[] = []
  for (const relative of value) {
    if (typeof relative !== "string" || relative.length === 0) return
    const file = await inside(root, relative)
    if (!file) return
    const url = await imageUrl(file)
    if (!url) return
    actions.push(url)
  }
  return actions
}

async function imageUrl(file: string) {
  const bytes = await readFile(file).catch(() => undefined)
  if (!bytes) return
  const kind = imageKind(bytes)
  if (!kind) return
  return `data:${kind};base64,${gifDataUrl(bytes).split(",")[1]}`
}

function stateFiles(value: unknown) {
  if (value === undefined) return {}
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  const files: Partial<Record<MascotState, string>> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isState(key) || typeof entry !== "string" || entry.length === 0) return
    files[key] = entry
  }
  return files
}

async function inside(root: string, relative: string) {
  if (path.isAbsolute(relative)) return
  const file = await realpath(path.join(root, relative)).catch(() => undefined)
  if (!file) return
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (file !== root && !file.startsWith(prefix)) return
  return file
}

async function copyPack(source: string, destination: string) {
  const manifest = path.join(source, "mascot.json")
  await writeFile(path.join(destination, "mascot.json"), await readFile(manifest))
  const tree = await readJson(manifest)
  const relatives = [
    ...Object.values(stateFiles(tree?.cli?.states) ?? {}),
    ...Object.values(stateFiles(tree?.cli?.badge?.states) ?? {}),
    ...Object.values(stateFiles(tree?.desktop?.states) ?? {}),
    ...Object.values(stateFiles(tree?.desktop?.badges) ?? {}),
    ...(Array.isArray(tree?.desktop?.actions) ? tree.desktop.actions.filter((item) => typeof item === "string") : []),
  ]
  for (const relative of relatives) {
    const from = await inside(source, relative)
    if (!from) continue
    const target = path.join(destination, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, await readFile(from))
  }
}

export function imageKind(bytes: Uint8Array) {
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  return
}

function isState(value: string): value is MascotState {
  return (MASCOT_STATES as readonly string[]).includes(value)
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

async function readText(file: string) {
  return readFile(file, "utf8").catch(() => undefined)
}

export async function readJson(file: string) {
  const text = await readText(file)
  if (!text) return
  try {
    return JSON.parse(text) as Manifest
  } catch {
    return
  }
}

function builtin(): LoadedMascot {
  return {
    enabled: true,
    custom: false,
    name: builtinPack.name,
    presenceSize: builtinPack.desktop.presenceSize,
    badgeSize: builtinPack.desktop.badgeSize,
    pixelated: builtinPack.desktop.pixelated,
    pack: builtinPack,
  }
}

function disabled(): LoadedMascot {
  return { ...builtin(), enabled: false }
}
