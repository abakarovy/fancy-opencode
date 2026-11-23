import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Transferable } from "effect/workers"

const MascotState = Schema.Literals(["idle", "thinking", "tool", "success", "error"])

const MascotAsset = Schema.Struct({
  state: MascotState,
  placement: Schema.Literals(["presence", "badge", "action"]),
  dataUrl: Schema.String,
})

const MascotLoadSuccess = Schema.Struct({
  enabled: Schema.Boolean,
  name: Schema.String,
  presenceSize: Schema.Number,
  badgeSize: Schema.Number,
  pixelated: Schema.Boolean,
  assets: Schema.Array(MascotAsset),
})

const MascotEdit = Schema.Union([
  Schema.Struct({ type: Schema.Literal("setState"), state: MascotState, bytes: Transferable.Uint8Array }),
  Schema.Struct({ type: Schema.Literal("clearState"), state: MascotState }),
  Schema.Struct({ type: Schema.Literal("addAction"), bytes: Transferable.Uint8Array }),
  Schema.Struct({ type: Schema.Literal("removeAction"), index: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("reset") }),
])

export const MascotLoad = Rpc.make("MascotLoad", { success: MascotLoadSuccess })

export const MascotEditRpc = Rpc.make("MascotEdit", { payload: { edit: MascotEdit }, success: MascotLoadSuccess })

export const MascotRpcs = RpcGroup.make(MascotLoad, MascotEditRpc)
