import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { desktopPackDir, imageKind, readJson } from "./load"
import { MASCOT_MAX_ACTIONS, type MascotEdit } from "./pack"

type ManifestFile = {
  format: 1
  name: string
  desktop: {
    presence: number
    badge: number
    pixelated: boolean
    states: Record<string, string>
    badges?: Record<string, string>
    actions: string[]
  }
}

const DEFAULT_PRESENCE_SIZE = 160
const DEFAULT_BADGE_SIZE = 52

/**
 * Apply one settings-page change to the desktop app's pack in the config directory.
 * Files are written under the pack folder with generated names, and replaced files are removed.
 */
export async function editDesktopMascot(configDir: string, edit: MascotEdit) {
  const dir = desktopPackDir(configDir)
  if (edit.type === "reset") {
    await rm(dir, { recursive: true, force: true })
    return
  }

  const manifest = await readManifest(dir)
  switch (edit.type) {
    case "setState": {
      const file = await writeImage(dir, "states", edit.state, edit.bytes)
      const previous = manifest.desktop.states[edit.state]
      manifest.desktop.states[edit.state] = file
      await save(dir, manifest)
      if (previous) await removeFile(dir, previous)
      return
    }
    case "clearState": {
      const previous = manifest.desktop.states[edit.state]
      delete manifest.desktop.states[edit.state]
      await save(dir, manifest)
      if (previous) await removeFile(dir, previous)
      return
    }
    case "addAction": {
      if (manifest.desktop.actions.length >= MASCOT_MAX_ACTIONS) {
        throw new Error(`A mascot can have at most ${MASCOT_MAX_ACTIONS} idle actions`)
      }
      manifest.desktop.actions.push(await writeImage(dir, "actions", "action", edit.bytes))
      await save(dir, manifest)
      return
    }
    case "removeAction": {
      const [removed] = manifest.desktop.actions.splice(edit.index, 1)
      if (removed === undefined) throw new Error(`No idle action at index ${edit.index}`)
      await save(dir, manifest)
      await removeFile(dir, removed)
      return
    }
  }
}

async function readManifest(dir: string): Promise<ManifestFile> {
  const existing = await readJson(path.join(dir, "mascot.json"))
  const desktop = existing?.desktop as Partial<ManifestFile["desktop"]> | undefined
  return {
    format: 1,
    name: "desktop-app",
    desktop: {
      presence: typeof desktop?.presence === "number" ? desktop.presence : DEFAULT_PRESENCE_SIZE,
      badge: typeof desktop?.badge === "number" ? desktop.badge : DEFAULT_BADGE_SIZE,
      pixelated: desktop?.pixelated === true,
      states: isRecord(desktop?.states) ? { ...(desktop.states as Record<string, string>) } : {},
      badges: isRecord(desktop?.badges) ? { ...(desktop.badges as Record<string, string>) } : undefined,
      actions: Array.isArray(desktop?.actions) ? desktop.actions.filter((item) => typeof item === "string") : [],
    },
  }
}

async function writeImage(dir: string, folder: string, label: string, bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new Error("Mascot images must not be empty")
  const kind = imageKind(bytes)
  if (!kind) throw new Error("Mascot images must be GIF or PNG")
  const extension = kind === "image/gif" ? "gif" : "png"
  const relative = path.posix.join(folder, `${label}-${randomUUID()}.${extension}`)
  const target = path.join(dir, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
  return relative
}

async function save(dir: string, manifest: ManifestFile) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "mascot.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function removeFile(dir: string, relative: string) {
  // Only files under the pack folder are removed, whatever the manifest says.
  const target = path.resolve(dir, relative)
  if (!target.startsWith(path.resolve(dir) + path.sep)) return
  await rm(target, { force: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
