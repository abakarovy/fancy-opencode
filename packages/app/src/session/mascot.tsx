import {
  applyRemoteMascot,
  BUILTIN_DESKTOP_SRC,
  builtinPack,
  deriveMascotState,
  desktopPicture,
  mascotInputFromMessages,
  nextSuccessHold,
  SUCCESS_HOLD_MS,
  type MascotPack,
  type MascotPicture,
  type MascotState,
} from "@opencode/mascot"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import tesseract from "@/assets/tesseract.gif"
import { usePlatform } from "@/runtime/platform/platform"
import { loadMascotRemote, mascotRemote } from "./mascot-remote"
import type { SessionModel } from "./model"

const REPLY_SIZE_FALLBACK = 52
const MOVE_MS = 1100
// Idle actions start after a random gap, then hold for a fixed time before the idle picture returns.
const ACTION_GAP_MIN_MS = 6000
const ACTION_GAP_MAX_MS = 14000
const ACTION_HOLD_MS = 2800

export function SessionMascot(props: { session: SessionModel }) {
  const platform = usePlatform()
  const pack = createMemo<MascotPack | undefined>(() => {
    const remote = mascotRemote()
    return remote ? applyRemoteMascot(builtinPack, remote) : builtinPack
  })
  const [store, setStore] = createStore<{ succeeded: boolean; action: string | undefined }>({
    succeeded: false,
    action: undefined,
  })
  let actionTimer: ReturnType<typeof setTimeout> | undefined
  let lastAction: string | undefined
  const [spot, setSpot] = createStore({ x: 0, y: 0, shown: false, dx: 0, dy: 0, soft: false })
  let host: HTMLDivElement | undefined
  let priorRunning = false
  let hold: ReturnType<typeof setTimeout> | undefined
  let lastAnchor: string | undefined
  let lastPoint = { x: 0, y: 0 }
  let glide: { fromX: number; fromY: number; started: number } | undefined

  onMount(() => {
    void loadMascotRemote(platform)
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick)
      place()
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })

  createEffect(() => {
    const running = props.session.data.working()
    const failed = running
      ? false
      : mascotInputFromMessages(props.session.history.messages(), false, false).failed
    const action = nextSuccessHold(priorRunning, running, failed)
    priorRunning = running
    if (action === "keep") return
    if (hold) clearTimeout(hold)
    hold = undefined
    if (action === "clear") {
      setStore("succeeded", false)
      return
    }
    setStore("succeeded", true)
    hold = setTimeout(() => setStore("succeeded", false), SUCCESS_HOLD_MS)
  })
  onCleanup(() => {
    if (hold) clearTimeout(hold)
  })

  const state = createMemo<MascotState>(() =>
    deriveMascotState(mascotInputFromMessages(props.session.history.messages(), props.session.data.working(), store.succeeded)),
  )

  createEffect(() => {
    const actions = state() === "idle" ? (pack()?.desktop.actions ?? []) : []
    stopActions()
    if (actions.length === 0 || reducedMotion()) return
    scheduleAction(actions)
  })
  onCleanup(stopActions)

  function scheduleAction(actions: readonly string[]) {
    const gap = ACTION_GAP_MIN_MS + Math.random() * (ACTION_GAP_MAX_MS - ACTION_GAP_MIN_MS)
    actionTimer = setTimeout(() => {
      const choice = pickAction(actions, lastAction)
      lastAction = choice
      setStore("action", choice)
      actionTimer = setTimeout(() => {
        setStore("action", undefined)
        scheduleAction(actions)
      }, ACTION_HOLD_MS)
    }, gap)
  }

  function stopActions() {
    if (actionTimer) clearTimeout(actionTimer)
    actionTimer = undefined
    setStore("action", undefined)
  }

  const picture = createMemo<MascotPicture | undefined>(
    () => {
      const current = pack()
      if (!current) return
      if (store.action && state() === "idle") {
        return {
          placement: "presence",
          src: store.action,
          size: current.desktop.presenceSize,
          pixelated: current.desktop.pixelated,
        }
      }
      return desktopPicture(current, state())
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.src === next?.src &&
        previous?.size === next?.size &&
        previous?.placement === next?.placement &&
        previous?.pixelated === next?.pixelated,
    },
  )

  const size = () => picture()?.placement === "badge" ? picture()!.size : (pack()?.desktop.badgeSize ?? REPLY_SIZE_FALLBACK)

  function place() {
    const root = host?.parentElement
    const current = picture()
    if (!root || !current) return
    const anchorID = replyAnchor(props.session.history.messages())
    const anchor = anchorID ? findReply(root, anchorID) : undefined
    if (!anchor) {
      const switching = anchorID !== undefined && lastAnchor !== undefined && anchorID !== lastAnchor
      if (!switching && spot.shown) setSpot({ shown: false, dx: 0, dy: 0, soft: false })
      return
    }
    const next = measure(root, anchor, size(), host?.querySelector("img")?.getBoundingClientRect().height || size())
    // No gutter beside the reply (narrow window): hide rather than cover the text.
    if (!next) {
      if (spot.shown) setSpot({ shown: false, dx: 0, dy: 0, soft: false })
      return
    }
    const switching = lastAnchor !== undefined && anchorID !== lastAnchor && spot.shown
    const reduce = reducedMotion()
    if (switching && !reduce) glide = { fromX: lastPoint.x, fromY: lastPoint.y, started: performance.now() }
    let drawn = next
    if (glide && !reduce) {
      const t = Math.min(1, (performance.now() - glide.started) / MOVE_MS)
      const ease = 1 - (1 - t) ** 3
      drawn = {
        x: glide.fromX + (next.x - glide.fromX) * ease,
        y: glide.fromY + (next.y - glide.fromY) * ease,
      }
      setSpot({ x: drawn.x, y: drawn.y, shown: true, dx: 0, dy: 0, soft: t < 0.45 })
      if (t >= 1) glide = undefined
    } else if (spot.x !== next.x || spot.y !== next.y || !spot.shown || spot.dx !== 0 || spot.dy !== 0 || spot.soft) {
      glide = undefined
      setSpot({ x: next.x, y: next.y, shown: true, dx: 0, dy: 0, soft: false })
    }
    lastPoint = drawn
    lastAnchor = anchorID
  }

  return (
    <div ref={host} class="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <img
        alt=""
        aria-hidden="true"
        src={mascotSrc(picture()?.src)}
        class="absolute transition-[transform,opacity] duration-[900ms] ease-out motion-reduce:transition-none"
        style={{
          left: `${spot.x}px`,
          top: `${spot.y}px`,
          width: `${size()}px`,
          height: "auto",
          opacity: spot.shown && picture() ? (spot.soft ? "0.45" : "1") : "0",
          transform: `translate(${spot.dx}px, ${spot.dy}px)`,
          "image-rendering": picture()?.pixelated ? "pixelated" : "auto",
        }}
      />
    </div>
  )
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Never repeat the action just played when there is a choice. */
function pickAction(actions: readonly string[], previous: string | undefined) {
  const choices = actions.length > 1 ? actions.filter((action) => action !== previous) : actions
  return choices[Math.floor(Math.random() * choices.length)]!
}

function mascotSrc(src: string | undefined) {
  if (!src || src === BUILTIN_DESKTOP_SRC) return tesseract
  return src
}

function replyAnchor(messages: readonly { readonly type: string; readonly id: string }[]) {
  let userID: string | undefined
  let anchor: string | undefined
  for (const message of messages) {
    if (message.type === "user") userID = message.id
    if (message.type === "shell") userID = undefined
    if (message.type === "assistant") anchor = userID ?? message.id
  }
  return anchor
}

function findReply(root: HTMLElement, id: string) {
  const escaped = CSS.escape(id)
  const nodes = root.querySelectorAll<HTMLElement>(
    `[data-message-id="${escaped}"][data-timeline-row="AssistantPart"] [data-slot="session-turn-assistant-content"], [data-message-id="${escaped}"][data-timeline-row="Thinking"] [data-slot="session-turn-thinking-row"]`,
  )
  for (const node of nodes) {
    if (node.getBoundingClientRect().height >= 8) return node
  }
}

function measure(root: HTMLElement, anchor: HTMLElement, size: number, height: number) {
  const frame = root.getBoundingClientRect()
  const box = anchor.getBoundingClientRect()
  const style = getComputedStyle(anchor)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
  const rtl = style.direction === "rtl"
  const x = rtl ? box.right - frame.left + 6 : box.left - frame.left - size - 6
  const limit = frame.width - size - 4
  if (x < 4 || x > limit) return
  // A reply taller than one line wraps, so sit level with its last line instead of its first.
  const y = box.height > lineHeight * 1.5 ? box.bottom - frame.top - height : box.top - frame.top
  return { x, y }
}
