import { useTerminalDimensions } from "@opentui/solid"
import { Global } from "@opencode/util/global"
import {
  builtinPack,
  cliClip,
  deriveMascotState,
  frameAt,
  mascotInputFromMessages,
  nextSuccessHold,
  SUCCESS_HOLD_MS,
  type MascotPack,
} from "@opencode/mascot"
import { loadActiveMascot } from "@opencode/mascot/load"
import { createContext, createEffect, createMemo, createSignal, For, onCleanup, Show, useContext, type ParentProps } from "solid-js"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"

const MascotContext = createContext<{
  placement: () => "presence" | "badge" | undefined
  lines: () => string[] | undefined
  cols: () => number
  color: () => ReturnType<typeof useTheme>["text"]["base"]
}>()

export function SessionMascot(props: ParentProps<{ sessionID: string }>) {
  const data = useData()
  const config = useConfig()
  const theme = useTheme()
  const [pack, setPack] = createSignal<MascotPack | undefined>(builtinPack)
  const [succeeded, setSucceeded] = createSignal(false)
  const [frame, setFrame] = createSignal(0)
  let priorRunning = false
  let hold: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    const override = config.data.mascot
    let cancelled = false
    void loadActiveMascot(process.env.OPENCODE_CONFIG_DIR ?? Global.Path.config, override).then((loaded) => {
      if (!cancelled) setPack(loaded.enabled ? loaded.pack : undefined)
    })
    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    const running = data.session.status(props.sessionID) === "running"
    const failed = running
      ? false
      : mascotInputFromMessages(data.session.message.list(props.sessionID), false, false).failed
    const action = nextSuccessHold(priorRunning, running, failed)
    priorRunning = running
    if (action === "keep") return
    if (hold) clearTimeout(hold)
    hold = undefined
    if (action === "clear") {
      setSucceeded(false)
      return
    }
    setSucceeded(true)
    hold = setTimeout(() => setSucceeded(false), SUCCESS_HOLD_MS)
  })
  onCleanup(() => {
    if (hold) clearTimeout(hold)
  })

  const state = createMemo(() => {
    const current = pack()
    if (!current) return
    const running = data.session.status(props.sessionID) === "running"
    return deriveMascotState(mascotInputFromMessages(data.session.message.list(props.sessionID), running, succeeded()))
  })

  const shown = createMemo(() => {
    const current = pack()
    const pose = state()
    if (!current || !pose) return
    return cliClip(current, pose)
  })

  createEffect(() => {
    const clip = shown()?.clip
    setFrame(0)
    if (!clip || clip.frames.length < 2 || config.data.animations === false) return
    const id = setInterval(() => setFrame((current) => (current + 1) % clip.frames.length), clip.intervalMs)
    onCleanup(() => clearInterval(id))
  })

  const lines = createMemo(() => {
    const clip = shown()?.clip
    if (!clip) return
    return frameAt(clip, frame())
  })

  return (
    <MascotContext.Provider
      value={{
        placement: () => shown()?.placement,
        lines,
        cols: () => shown()?.clip.cols ?? 0,
        color: () => theme.text.base,
      }}
    >
      {props.children}
    </MascotContext.Provider>
  )
}

export function SessionMascotPresence() {
  const mascot = useMascot()
  const dimensions = useTerminalDimensions()
  return (
    <Show
      when={
        mascot.placement() === "presence" && mascot.lines() && dimensions().width >= mascot.cols() + 40
          ? mascot.lines()
          : undefined
      }
    >
      {(rows) => (
        <box
          width={mascot.cols()}
          flexShrink={0}
          flexDirection="column"
          justifyContent="flex-end"
          paddingRight={1}
          paddingBottom={1}
        >
          <For each={rows()}>
            {(line) => (
              <text wrapMode="none" fg={mascot.color()}>
                {line}
              </text>
            )}
          </For>
        </box>
      )}
    </Show>
  )
}

export function SessionMascotBadge() {
  const mascot = useMascot()
  return (
    <Show when={mascot.placement() === "badge" ? mascot.lines() : undefined}>
      {(rows) => (
        <box flexDirection="column" alignItems="flex-start" marginBottom={1} flexShrink={0}>
          <For each={rows()}>
            {(line) => (
              <text wrapMode="none" fg={mascot.color()}>
                {line}
              </text>
            )}
          </For>
        </box>
      )}
    </Show>
  )
}

function useMascot() {
  const mascot = useContext(MascotContext)
  if (!mascot) throw new Error("SessionMascot is missing")
  return mascot
}
