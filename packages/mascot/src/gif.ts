export type Rgb = readonly [number, number, number]

export type GifFrame = {
  width: number
  height: number
  /** Palette index per pixel, row-major. Index 0 is transparent. */
  indices: Uint8Array
}

const MAX_CODE_SIZE = 12

/** Animated GIF89a. Palette index 0 is transparent, and the animation loops. */
export function encodeGif(frames: readonly GifFrame[], palette: readonly Rgb[], delayCs: number) {
  const first = frames[0]
  if (!first) throw new Error("GIF needs a frame")
  if (palette.length < 2 || palette.length > 256) throw new Error("GIF palette must hold 2 to 256 colors")
  const tableSize = nextPow2(palette.length)
  const sizeField = Math.log2(tableSize) - 1
  const bytes: number[] = []
  pushText(bytes, "GIF89a")
  push16(bytes, first.width)
  push16(bytes, first.height)
  bytes.push(0x80 | (7 << 4) | sizeField, 0, 0)
  for (let index = 0; index < tableSize; index++) {
    const color = palette[index] ?? [0, 0, 0]
    bytes.push(color[0], color[1], color[2])
  }
  pushText(bytes, "!\xFF\x0BNETSCAPE2.0\x03\x01")
  push16(bytes, 0)
  bytes.push(0)
  for (const frame of frames) {
    if (frame.width !== first.width || frame.height !== first.height) throw new Error("GIF frames differ in size")
    bytes.push(0x21, 0xf9, 0x04, 0x09)
    push16(bytes, delayCs)
    bytes.push(0, 0)
    bytes.push(0x2c)
    push16(bytes, 0)
    push16(bytes, 0)
    push16(bytes, frame.width)
    push16(bytes, frame.height)
    bytes.push(0)
    const minCodeSize = Math.max(2, sizeField + 1)
    bytes.push(minCodeSize)
    const image = lzw(frame.indices, minCodeSize)
    for (let offset = 0; offset < image.length; offset += 255) {
      const chunk = image.subarray(offset, offset + 255)
      bytes.push(chunk.length, ...chunk)
    }
    bytes.push(0)
  }
  bytes.push(0x3b)
  return Uint8Array.from(bytes)
}

export function gifDataUrl(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/gif;base64,${btoa(binary)}`
}

function lzw(indices: Uint8Array, minCodeSize: number) {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  let codeSize = minCodeSize + 1
  let maxCode = (1 << codeSize) - 1
  let next = eoi + 1
  let dictionary = new Map<string, number>()
  const reset = () => {
    dictionary = new Map()
    for (let code = 0; code < clear; code++) dictionary.set(String(code), code)
    codeSize = minCodeSize + 1
    maxCode = (1 << codeSize) - 1
    next = eoi + 1
  }
  reset()
  const packed: number[] = []
  let bitBuffer = 0
  let bitCount = 0
  // Grow the code width after the code that filled the current width has already been written.
  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      packed.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
    if (next > maxCode && codeSize < MAX_CODE_SIZE) {
      codeSize++
      maxCode = codeSize === MAX_CODE_SIZE ? 1 << codeSize : (1 << codeSize) - 1
    }
  }
  emit(clear)
  let prefix = ""
  for (const index of indices) {
    const symbol = String(index)
    const combined = prefix.length === 0 ? symbol : `${prefix},${symbol}`
    if (dictionary.has(combined)) {
      prefix = combined
      continue
    }
    if (prefix.length > 0) emit(dictionary.get(prefix)!)
    if (next < 4096) dictionary.set(combined, next++)
    else {
      emit(clear)
      reset()
    }
    prefix = symbol
  }
  if (prefix.length > 0) emit(dictionary.get(prefix)!)
  emit(eoi)
  if (bitCount > 0) packed.push(bitBuffer & 0xff)
  return Uint8Array.from(packed)
}

function nextPow2(value: number) {
  let size = 2
  while (size < value) size *= 2
  return size
}

function push16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff)
}

function pushText(bytes: number[], text: string) {
  for (let index = 0; index < text.length; index++) bytes.push(text.charCodeAt(index))
}
