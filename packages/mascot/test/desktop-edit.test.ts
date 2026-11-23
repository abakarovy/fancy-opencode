import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { editDesktopMascot } from "../src/edit"
import { encodeGif } from "../src/gif"
import { desktopPackDir, loadDesktopMascot } from "../src/load"
import { applyRemoteMascot, builtinPack, MASCOT_MAX_ACTIONS, remoteAssets } from "../src/index"

const gif = encodeGif([{ width: 1, height: 1, indices: Uint8Array.of(1) }], [[0, 0, 0], [9, 9, 9], [0, 0, 0], [0, 0, 0]], 5)
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3)

async function withConfig(run: (config: string) => Promise<void>) {
  const config = await mkdtemp(path.join(tmpdir(), "mascot-desktop-"))
  try {
    await run(config)
  } finally {
    await rm(config, { recursive: true, force: true })
  }
}

describe("desktop mascot edits", () => {
  test("uploads a state picture and loads it back", async () => {
    await withConfig(async (config) => {
      await editDesktopMascot(config, { type: "setState", state: "idle", bytes: gif })
      const loaded = await loadDesktopMascot(config)
      expect(loaded.custom).toBe(true)
      expect(loaded.pack.desktop.presence.idle).toStartWith("data:image/gif;base64,")
      expect(remoteAssets(loaded.pack).map((asset) => asset.state)).toEqual(["idle"])
    })
  })

  test("replacing a state removes the previous file", async () => {
    await withConfig(async (config) => {
      await editDesktopMascot(config, { type: "setState", state: "tool", bytes: gif })
      await editDesktopMascot(config, { type: "setState", state: "tool", bytes: png })
      const files = await readdir(path.join(desktopPackDir(config), "states"))
      expect(files.length).toBe(1)
      expect(files[0]).toEndWith(".png")
    })
  })

  test("clearing a state removes its file and manifest entry", async () => {
    await withConfig(async (config) => {
      await editDesktopMascot(config, { type: "setState", state: "error", bytes: gif })
      await editDesktopMascot(config, { type: "clearState", state: "error" })
      expect((await loadDesktopMascot(config)).pack.desktop.presence.error).toBeUndefined()
      expect(await readdir(path.join(desktopPackDir(config), "states"))).toEqual([])
    })
  })

  test("idle actions can be added, removed, and capped", async () => {
    await withConfig(async (config) => {
      await editDesktopMascot(config, { type: "addAction", bytes: gif })
      await editDesktopMascot(config, { type: "addAction", bytes: png })
      expect((await loadDesktopMascot(config)).pack.desktop.actions?.length).toBe(2)

      await editDesktopMascot(config, { type: "removeAction", index: 0 })
      const after = (await loadDesktopMascot(config)).pack.desktop.actions ?? []
      expect(after.length).toBe(1)
      expect(after[0]).toStartWith("data:image/png;base64,")

      for (let index = after.length; index < MASCOT_MAX_ACTIONS; index++) {
        await editDesktopMascot(config, { type: "addAction", bytes: gif })
      }
      await expect(editDesktopMascot(config, { type: "addAction", bytes: gif })).rejects.toThrow("at most")
    })
  })

  test("rejects files that are neither GIF nor PNG", async () => {
    await withConfig(async (config) => {
      await expect(
        editDesktopMascot(config, { type: "setState", state: "idle", bytes: Uint8Array.of(1, 2, 3) }),
      ).rejects.toThrow("GIF or PNG")
    })
  })

  test("accepts images of any size", async () => {
    await withConfig(async (config) => {
      const large = new Uint8Array(4 * 1024 * 1024)
      large.set(png)
      await editDesktopMascot(config, { type: "setState", state: "idle", bytes: large })
      const loaded = await loadDesktopMascot(config)
      expect(loaded.pack.desktop.presence.idle).toStartWith("data:image/png;base64,")
    })
  })

  test("reset returns to the built-in mascot", async () => {
    await withConfig(async (config) => {
      await editDesktopMascot(config, { type: "setState", state: "idle", bytes: gif })
      await editDesktopMascot(config, { type: "reset" })
      const loaded = await loadDesktopMascot(config)
      expect(loaded.custom).toBe(false)
    })
  })

  test("a state without its own picture falls back to the nearest one, then the built-in art", () => {
    const pack = applyRemoteMascot(builtinPack, {
      enabled: true,
      name: "desktop-app",
      presenceSize: 160,
      badgeSize: 52,
      pixelated: false,
      assets: [{ state: "idle", placement: "presence", dataUrl: "data:image/gif;base64,AA==" }],
    })
    expect(pack?.desktop.presence.tool).toBe("data:image/gif;base64,AA==")
    expect(pack?.desktop.presence.error).toBe("data:image/gif;base64,AA==")
  })
})
