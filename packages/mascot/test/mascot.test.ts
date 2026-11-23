import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { builtinPack } from "../src/builtin"
import { columns, parseAsciiFrames } from "../src/frames"
import { encodeGif } from "../src/gif"
import { installMascotPack, loadActiveMascot, loadMascotPack, parseMascotChoice } from "../src/load"
import { applyRemoteMascot, cliClip, desktopPicture, frameAt } from "../src/pack"
import {
  deriveMascotState,
  mascotInputFromMessages,
  mascotPlacement,
  nextSuccessHold,
} from "../src/state"

const idle = { running: false, toolRunning: false, failed: false, succeeded: false }

describe("mascot state", () => {
  test("picks the active pose and keeps talking small", () => {
    expect(deriveMascotState(idle)).toBe("idle")
    expect(deriveMascotState({ ...idle, succeeded: true })).toBe("success")
    expect(deriveMascotState({ ...idle, running: true })).toBe("thinking")
    expect(deriveMascotState({ ...idle, running: true, toolRunning: true })).toBe("tool")
    expect(deriveMascotState({ ...idle, failed: true })).toBe("error")
    expect(deriveMascotState({ ...idle, running: true, failed: true, toolRunning: true })).toBe("tool")
    expect(mascotPlacement("thinking")).toBe("badge")
    expect(mascotPlacement("tool")).toBe("presence")
    expect(mascotPlacement("idle")).toBe("presence")
  })

  test("holds success only after a clean stop", () => {
    expect(nextSuccessHold(false, false, false)).toBe("keep")
    expect(nextSuccessHold(false, true, false)).toBe("clear")
    expect(nextSuccessHold(true, false, false)).toBe("start")
    expect(nextSuccessHold(true, false, true)).toBe("clear")
  })

  test("reads a tool call and a failed turn from the transcript", () => {
    const running = mascotInputFromMessages(
      [{ type: "assistant", content: [{ type: "tool", state: { status: "running" } }] }],
      true,
      false,
    )
    expect(deriveMascotState(running)).toBe("tool")
    const failed = mascotInputFromMessages(
      [{ type: "user" }, { type: "assistant", error: { message: "no" }, content: [] }],
      false,
      true,
    )
    expect(deriveMascotState(failed)).toBe("error")
  })
})

describe("mascot art", () => {
  test("built-in ascii stays on a fixed grid and talking uses the badge", () => {
    for (const clip of Object.values(builtinPack.cli.presence)) {
      if (!clip) continue
      for (const frame of clip.frames) {
        const lines = frame.split("\n")
        expect(lines).toHaveLength(clip.rows)
        for (const line of lines) expect(columns(line)).toBe(clip.cols)
      }
    }
    const talking = cliClip(builtinPack, "thinking")
    expect(talking?.placement).toBe("badge")
    expect(talking?.clip.rows).toBeLessThan(6)
    const working = cliClip(builtinPack, "tool")
    expect(working?.placement).toBe("presence")
    expect(frameAt(working!.clip, 0)).toHaveLength(working!.clip.rows)
  })

  test("a custom desktop file replaces the built-in and missing poses fall back inside it", () => {
    const custom = applyRemoteMascot(builtinPack, {
      enabled: true,
      name: "crab",
      presenceSize: 200,
      badgeSize: 36,
      pixelated: false,
      assets: [{ state: "idle", placement: "presence", dataUrl: "data:image/gif;base64,custom" }],
    })
    expect(custom?.name).toBe("crab")
    expect(desktopPicture(custom!, "thinking")?.src).toBe("data:image/gif;base64,custom")
    expect(desktopPicture(custom!, "thinking")?.size).toBe(36)
    expect(applyRemoteMascot(builtinPack, { ...{ enabled: false, name: "off", presenceSize: 1, badgeSize: 1, pixelated: false, assets: [] } })).toBeUndefined()
  })

  test("desktop talking uses the same gif at badge size", () => {
    const idlePicture = desktopPicture(builtinPack, "idle")
    const talking = desktopPicture(builtinPack, "thinking")
    expect(idlePicture?.size).toBe(160)
    expect(talking?.placement).toBe("badge")
    expect(talking?.size).toBe(52)
    expect(talking?.src).toBe(idlePicture?.src)
  })

  test("pads a short frame and rejects escapes and overflow", () => {
    const frames = parseAsciiFrames("ab\n", 4, 2)
    expect(frames).toEqual(["ab  \n    "])
    expect(parseAsciiFrames("\u001b[31mcrab", 8, 1)).toBe("ASCII frames cannot include color escapes")
    expect(typeof parseAsciiFrames("too-wide", 4, 1)).toBe("string")
  })

  test("a one-pixel gif round-trips the expected lzw bytes", () => {
    const gif = encodeGif([{ width: 1, height: 1, indices: Uint8Array.of(1) }], [[0, 0, 0], [1, 2, 3], [0, 0, 0], [0, 0, 0]], 5)
    expect(Buffer.from(gif.subarray(0, 6)).toString()).toBe("GIF89a")
    expect(gif.at(-1)).toBe(0x3b)
    const marker = Buffer.from(gif).indexOf(Buffer.from([2, 2, 0x4c, 0x01, 0]))
    expect(marker).toBeGreaterThan(0)
  })
})

describe("mascot packs", () => {
  test("names, paths, and off are the only choices", () => {
    expect(parseMascotChoice(undefined)).toEqual({ type: "builtin" })
    expect(parseMascotChoice("off")).toEqual({ type: "off" })
    expect(parseMascotChoice("crab")).toEqual({ type: "name", name: "crab" })
    expect(parseMascotChoice("../crab").type).toBe("invalid")
    expect(parseMascotChoice("/tmp/crab")).toEqual({ type: "path", path: "/tmp/crab" })
  })

  test("a folder pack loads and a missing state falls back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mascot-"))
    try {
      await writePack(root, { tool: false })
      const pack = await loadMascotPack(root)
      expect(pack?.name).toBe("crab")
      expect(cliClip(pack!, "tool")?.clip).toEqual(cliClip(pack!, "thinking")?.clip)
      expect(desktopPicture(pack!, "idle")?.size).toBe(180)
      const loaded = await loadActiveMascot(path.dirname(root), "off")
      expect(loaded.enabled).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("install copies the pack and rejects a file that escapes the folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mascot-install-"))
    const config = path.join(root, "config")
    const source = path.join(root, "source")
    try {
      await writePack(source, { tool: true })
      const installed = await installMascotPack(source, config)
      expect(installed.installed).toBe(true)
      if (!installed.installed) return
      const choice = await readFile(path.join(config, "mascot"), "utf8")
      expect(choice.trim()).toBe("crab")
      const loaded = await loadActiveMascot(config)
      expect(loaded.name).toBe("crab")
      expect(loaded.pack.cli.presence.tool).toBeDefined()

      const escaped = path.join(root, "escaped")
      await writePack(escaped, { tool: true, idlePath: "../secret.txt" })
      expect(await loadMascotPack(escaped)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function writePack(directory: string, options: { tool: boolean; idlePath?: string }) {
  await mkdir(path.join(directory, "cli"), { recursive: true })
  await mkdir(path.join(directory, "desktop"), { recursive: true })
  const idle = "ab\ncd"
  await writeFile(path.join(directory, "cli", "idle.txt"), idle)
  await writeFile(path.join(directory, "cli", "thinking.txt"), "ef\ngh")
  if (options.tool) await writeFile(path.join(directory, "cli", "tool.txt"), "ij\nkl")
  await writeFile(path.join(directory, "desktop", "idle.gif"), encodeGif([{ width: 1, height: 1, indices: Uint8Array.of(1) }], [[0, 0, 0], [9, 9, 9], [0, 0, 0], [0, 0, 0]], 5))
  await writeFile(
    path.join(directory, "mascot.json"),
    JSON.stringify({
      format: 1,
      name: "crab",
      cli: {
        cols: 2,
        rows: 2,
        intervalMs: 100,
        states: {
          idle: options.idlePath ?? "cli/idle.txt",
          thinking: "cli/thinking.txt",
          ...(options.tool ? { tool: "cli/tool.txt" } : {}),
        },
      },
      desktop: { presence: 180, badge: 32, states: { idle: "desktop/idle.gif" } },
    }),
  )
}
