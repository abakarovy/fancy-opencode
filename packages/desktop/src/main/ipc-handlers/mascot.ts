import { remoteAssets } from "@opencode/mascot"
import { editDesktopMascot } from "@opencode/mascot/edit"
import { loadDesktopMascot, mascotConfigDir } from "@opencode/mascot/load"
import { Effect } from "effect"
import { MascotRpcs } from "../../shared/ipc-rpc/mascot"

async function current() {
  const loaded = await loadDesktopMascot(mascotConfigDir())
  return {
    enabled: loaded.enabled,
    name: loaded.name,
    presenceSize: loaded.presenceSize,
    badgeSize: loaded.badgeSize,
    pixelated: loaded.pixelated,
    assets: loaded.custom ? remoteAssets(loaded.pack) : [],
  }
}

export const mascotHandlers = MascotRpcs.toLayer(
  Effect.gen(function* () {
    return MascotRpcs.of({
      MascotLoad: () => Effect.tryPromise(current).pipe(Effect.orDie),
      MascotEdit: ({ edit }) =>
        Effect.tryPromise(async () => {
          await editDesktopMascot(mascotConfigDir(), edit)
          return current()
        }).pipe(Effect.orDie),
    })
  }),
)
