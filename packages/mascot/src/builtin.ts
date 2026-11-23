import { parseAsciiFrames, type AsciiClip } from "./frames"
import type { MascotPack } from "./pack"

/** Desktop renders this as the bundled tesseract GIF. It is not a URL. */
export const BUILTIN_DESKTOP_SRC = "builtin:tesseract"

function clip(frames: readonly string[], cols: number, rows: number, intervalMs: number): AsciiClip {
  const text = frames.join("\n---FRAME---\n")
  const parsed = parseAsciiFrames(text, cols, rows)
  if (typeof parsed === "string") throw new Error(parsed)
  return { cols, rows, intervalMs, frames: parsed }
}

function asciiFrame(inset: number) {
  const cols = 34
  const rows = 15
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "))
  const mark = (x: number, y: number, glyph: string) => {
    const row = grid[y]
    if (!row || x < 0 || x >= cols) return
    if (row[x] === " " || row[x] === "." || glyph === "+") row[x] = glyph
  }
  const box = (left: number, top: number, right: number, bottom: number) => {
    for (let x = left; x <= right; x++) {
      mark(x, top, x === left || x === right ? "+" : "-")
      mark(x, bottom, x === left || x === right ? "+" : "-")
    }
    for (let y = top; y <= bottom; y++) {
      mark(left, y, y === top || y === bottom ? "+" : "|")
      mark(right, y, y === top || y === bottom ? "+" : "|")
    }
  }
  const stroke = (x0: number, y0: number, x1: number, y1: number) => {
    let x = x0
    let y = y0
    const dx = Math.abs(x1 - x)
    const dy = Math.abs(y1 - y)
    const stepX = x < x1 ? 1 : -1
    const stepY = y < y1 ? 1 : -1
    let error = dx - dy
    for (;;) {
      mark(x, y, ".")
      if (x === x1 && y === y1) break
      const doubled = error * 2
      if (doubled > -dy) {
        error -= dy
        x += stepX
      }
      if (doubled < dx) {
        error += dx
        y += stepY
      }
    }
  }
  box(1, 1, cols - 2, rows - 2)
  const left = 1 + inset
  const right = cols - 2 - inset
  const top = 1 + Math.max(1, inset - 2)
  const bottom = rows - 2 - Math.max(1, inset - 2)
  box(left, top, right, bottom)
  stroke(1, 1, left, top)
  stroke(cols - 2, 1, right, top)
  stroke(1, rows - 2, left, bottom)
  stroke(cols - 2, rows - 2, right, bottom)
  return grid.map((row) => row.join("")).join("\n")
}

const presence = [3, 5, 6, 5].map(asciiFrame)
const badge = [String.raw` +--+   `, String.raw`/   /|  `, String.raw`+--+ |  `, String.raw`|  | +  `, String.raw`+--+    `]

export const builtinPack: MascotPack = {
  format: 1,
  name: "opencode",
  cli: {
    presence: {
      idle: clip(presence, 34, 15, 180),
      thinking: clip(presence, 34, 15, 180),
      tool: clip(presence, 34, 15, 120),
      success: clip([presence[0]!], 34, 15, 180),
      error: clip([presence[2]!], 34, 15, 180),
    },
    badge: {
      thinking: clip([badge.join("\n")], 8, 5, 180),
    },
  },
  desktop: {
    presenceSize: 160,
    badgeSize: 52,
    pixelated: false,
    presence: {
      idle: BUILTIN_DESKTOP_SRC,
      thinking: BUILTIN_DESKTOP_SRC,
      tool: BUILTIN_DESKTOP_SRC,
      success: BUILTIN_DESKTOP_SRC,
      error: BUILTIN_DESKTOP_SRC,
    },
    badge: {},
  },
}
