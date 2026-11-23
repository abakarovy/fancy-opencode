export const FRAME_DIVIDER = "---FRAME---"

export type AsciiClip = {
  cols: number
  rows: number
  intervalMs: number
  frames: string[]
}

export function columns(text: string) {
  let width = 0
  for (const symbol of text) {
    const code = symbol.codePointAt(0) ?? 0
    width += wide(code) ? 2 : 1
  }
  return width
}

export function parseAsciiFrames(text: string, cols: number, rows: number): AsciiClip["frames"] | string {
  if (text.includes("\u001b")) return "ASCII frames cannot include color escapes"
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "")
  const blocks = normalized.length === 0 ? [] : normalized.split(`\n${FRAME_DIVIDER}\n`)
  if (blocks.length === 0) return "ASCII frame file is empty"
  const frames: string[] = []
  for (const block of blocks) {
    const lines = block.split("\n")
    if (lines.length > rows) return `ASCII frame is ${lines.length} rows; the pack allows ${rows}`
    const padded: string[] = []
    for (const line of lines) {
      const width = columns(line)
      if (width > cols) return `ASCII frame is ${width} columns; the pack allows ${cols}`
      padded.push(line + " ".repeat(cols - width))
    }
    while (padded.length < rows) padded.push(" ".repeat(cols))
    frames.push(padded.join("\n"))
  }
  return frames
}

export function frameLines(frame: string) {
  return frame.split("\n")
}

function wide(code: number) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}
