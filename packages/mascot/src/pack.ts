import { frameLines, type AsciiClip } from "./frames"
import { MASCOT_STATES, mascotFallbacks, mascotPlacement, type MascotPlacement, type MascotState } from "./state"

export type MascotPack = {
  format: 1
  name: string
  cli: {
    presence: Partial<Record<MascotState, AsciiClip>>
    badge: Partial<Record<MascotState, AsciiClip>>
  }
  desktop: {
    presenceSize: number
    badgeSize: number
    pixelated: boolean
    presence: Partial<Record<MascotState, string>>
    badge: Partial<Record<MascotState, string>>
    /** Idle actions, played at random while idle. Empty means the mascot stays still. */
    actions?: readonly string[]
  }
}

/** Most idle actions a desktop pack may hold. */
export const MASCOT_MAX_ACTIONS = 12

/** A change to the desktop pack made from the settings page. */
export type MascotEdit =
  | { type: "setState"; state: MascotState; bytes: Uint8Array<ArrayBuffer> }
  | { type: "clearState"; state: MascotState }
  | { type: "addAction"; bytes: Uint8Array<ArrayBuffer> }
  | { type: "removeAction"; index: number }
  | { type: "reset" }

export type MascotPicture = {
  placement: MascotPlacement
  src: string
  size: number
  pixelated: boolean
}

export function cliClip(pack: MascotPack, state: MascotState) {
  const placement = mascotPlacement(state)
  if (placement === "badge") {
    const badge = pack.cli.badge[state] ?? pack.cli.badge.thinking
    if (badge) return { placement, clip: badge }
  }
  const clip = firstClip(pack.cli.presence, state)
  if (!clip) return
  return { placement: "presence" as const, clip }
}

export function desktopPicture(pack: MascotPack, state: MascotState): MascotPicture | undefined {
  const placement = mascotPlacement(state)
  const badge = placement === "badge" ? (pack.desktop.badge[state] ?? pack.desktop.badge.thinking) : undefined
  const src = badge ?? firstSrc(pack.desktop.presence, state)
  if (!src) return
  // A desktop GIF scales, so talking uses the large art at badge size when the pack has no badge file.
  const small = placement === "badge"
  return {
    placement: small ? "badge" : "presence",
    src,
    size: small ? pack.desktop.badgeSize : pack.desktop.presenceSize,
    pixelated: pack.desktop.pixelated,
  }
}

export type RemoteMascotAsset = {
  state: MascotState
  placement: MascotPlacement | "action"
  dataUrl: string
}

export type RemoteMascot = {
  enabled: boolean
  name: string
  presenceSize: number
  badgeSize: number
  pixelated: boolean
  assets: readonly RemoteMascotAsset[]
}

/** Custom desktop files replace the built-in pictures. Missing states fall back inside that set. */
export function applyRemoteMascot(base: MascotPack, remote: RemoteMascot | undefined) {
  if (!remote) return base
  if (!remote.enabled) return
  if (remote.assets.length === 0) return base
  const given: Partial<Record<MascotState, string>> = {}
  const badge: Partial<Record<MascotState, string>> = {}
  const actions: string[] = []
  for (const asset of remote.assets) {
    if (asset.placement === "action") actions.push(asset.dataUrl)
    else if (asset.placement === "badge") badge[asset.state] = asset.dataUrl
    else given[asset.state] = asset.dataUrl
  }
  // A state with no picture of its own uses the nearest fallback, and the built-in art when there is none.
  const presence: Partial<Record<MascotState, string>> = {}
  for (const state of MASCOT_STATES) {
    presence[state] = firstSrc(given, state) ?? base.desktop.presence[state]
  }
  return {
    ...base,
    name: remote.name,
    desktop: {
      presence,
      badge,
      actions,
      presenceSize: remote.presenceSize,
      badgeSize: remote.badgeSize,
      pixelated: remote.pixelated,
    },
  }
}

export function remoteAssets(pack: MascotPack): RemoteMascotAsset[] {
  const assets: RemoteMascotAsset[] = []
  for (const state of MASCOT_STATES) {
    const presence = pack.desktop.presence[state]
    if (presence) assets.push({ state, placement: "presence", dataUrl: presence })
    const badge = pack.desktop.badge[state]
    if (badge) assets.push({ state, placement: "badge", dataUrl: badge })
  }
  for (const action of pack.desktop.actions ?? []) {
    assets.push({ state: "idle", placement: "action", dataUrl: action })
  }
  return assets
}

export function frameAt(clip: AsciiClip, index: number) {
  const frame = clip.frames[index % clip.frames.length] ?? clip.frames[0] ?? ""
  return frameLines(frame)
}

function firstClip(clips: Partial<Record<MascotState, AsciiClip>>, state: MascotState) {
  for (const name of mascotFallbacks(state)) {
    const clip = clips[name]
    if (clip) return clip
  }
}

function firstSrc(sources: Partial<Record<MascotState, string>>, state: MascotState) {
  for (const name of mascotFallbacks(state)) {
    const src = sources[name]
    if (src) return src
  }
}
