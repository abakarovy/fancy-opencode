import type { RemoteMascot } from "@opencode/mascot"
import { createSignal } from "solid-js"
import type { Platform } from "@/runtime/platform/platform"

// The desktop pack as the main process last reported it. `null` until the first load finishes.
const [remote, setRemote] = createSignal<RemoteMascot | null>(null)
let requested: Promise<void> | undefined

export const mascotRemote = remote

/** Read the pack once. Later calls return the same load. */
export function loadMascotRemote(platform: Platform) {
  requested ??= platform.loadMascot
    ? platform.loadMascot().then(
        (next) => {
          setRemote(next)
        },
        () => {
          setRemote(null)
        },
      )
    : Promise.resolve()
  return requested
}

export function setMascotRemote(next: RemoteMascot) {
  setRemote(next)
}
