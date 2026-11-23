export const MASCOT_STATES = ["idle", "thinking", "tool", "success", "error"] as const

export type MascotState = (typeof MASCOT_STATES)[number]

export type MascotPlacement = "presence" | "badge"

export type MascotInput = {
  /** A turn is in progress, including streaming text. */
  running: boolean
  /** A tool call is in progress during the current turn. */
  toolRunning: boolean
  /** The latest assistant turn failed and nothing is running. */
  failed: boolean
  /** The latest turn just finished cleanly. The caller holds this briefly. */
  succeeded: boolean
}

export const SUCCESS_HOLD_MS = 1200

const FALLBACK: Record<MascotState, readonly MascotState[]> = {
  idle: ["idle"],
  thinking: ["thinking", "idle"],
  tool: ["tool", "thinking", "idle"],
  success: ["success", "idle"],
  error: ["error", "idle"],
}

export function deriveMascotState(input: MascotInput): MascotState {
  if (input.failed && !input.running) return "error"
  if (input.toolRunning) return "tool"
  if (input.running) return "thinking"
  if (input.succeeded) return "success"
  return "idle"
}

/** Talking is the only small placement. Every other state keeps the large mascot. */
export function mascotPlacement(state: MascotState): MascotPlacement {
  return state === "thinking" ? "badge" : "presence"
}

export function mascotFallbacks(state: MascotState) {
  return FALLBACK[state]
}

/**
 * Start the short success pose when a turn ends cleanly.
 * Clear it when another turn starts or the turn failed.
 */
export function nextSuccessHold(
  previousRunning: boolean,
  running: boolean,
  failed: boolean,
): "start" | "clear" | "keep" {
  if (running || failed) return "clear"
  if (previousRunning) return "start"
  return "keep"
}

export type MascotSessionMessage = {
  readonly type: string
  readonly error?: unknown
  readonly content?: readonly {
    readonly type: string
    readonly state?: { readonly status?: string }
  }[]
}

export function mascotInputFromMessages(
  messages: readonly MascotSessionMessage[],
  running: boolean,
  succeeded: boolean,
): MascotInput {
  let assistant: MascotSessionMessage | undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type === "assistant") {
      assistant = message
      break
    }
  }
  const content = assistant?.content ?? []
  const toolRunning =
    running &&
    content.some(
      (part) => part.type === "tool" && (part.state?.status === "running" || part.state?.status === "streaming"),
    )
  const failed =
    !running &&
    (!!assistant?.error || content.some((part) => part.type === "tool" && part.state?.status === "error"))
  return { running, toolRunning, failed, succeeded }
}
