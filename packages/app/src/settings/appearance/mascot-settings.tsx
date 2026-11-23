import { Component, For, Show, createSignal, onMount } from "solid-js"
import {
  MASCOT_MAX_ACTIONS,
  type MascotEdit,
  type MascotState,
} from "@opencode/mascot"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { loadMascotRemote, mascotRemote, setMascotRemote } from "@/session/mascot-remote"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import "@/settings/settings.css"

const STATES = [
  {
    state: "idle",
    title: "settings.mascot.state.idle.title",
    description: "settings.mascot.state.idle.description",
  },
  {
    state: "thinking",
    title: "settings.mascot.state.thinking.title",
    description: "settings.mascot.state.thinking.description",
  },
  {
    state: "tool",
    title: "settings.mascot.state.tool.title",
    description: "settings.mascot.state.tool.description",
  },
  {
    state: "success",
    title: "settings.mascot.state.success.title",
    description: "settings.mascot.state.success.description",
  },
  {
    state: "error",
    title: "settings.mascot.state.error.title",
    description: "settings.mascot.state.error.description",
  },
] as const

/** Settings for the desktop mascot's pictures. Hidden where the desktop bridge is not available. */
export const SettingsMascot: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [busy, setBusy] = createSignal(false)

  onMount(() => {
    void loadMascotRemote(platform)
  })

  const pictureFor = (state: MascotState) =>
    mascotRemote()?.assets.find((asset) => asset.state === state && asset.placement === "presence")?.dataUrl
  const actions = () =>
    mascotRemote()?.assets.filter((asset) => asset.placement === "action").map((asset) => asset.dataUrl) ?? []
  const customized = () => (mascotRemote()?.assets.length ?? 0) > 0

  const fail = () =>
    showToast({
      title: language.t("settings.mascot.error.title"),
      description: language.t("settings.mascot.error.description"),
    })

  async function apply(edit: MascotEdit) {
    if (!platform.editMascot) return
    setBusy(true)
    try {
      setMascotRemote(await platform.editMascot(edit))
    } catch {
      fail()
    } finally {
      setBusy(false)
    }
  }

  /** Pick GIFs or PNGs and hand each one's bytes to `edit`. */
  async function upload(multiple: boolean, edit: (bytes: Uint8Array<ArrayBuffer>) => MascotEdit) {
    const pick = platform.openAttachmentPickerDialog
    if (!pick) return
    await pick(
      // Mascot pictures are the user's own files, so they get no size cap of their own.
      { extensions: ["gif", "png"], multiple, maxBytes: Number.MAX_SAFE_INTEGER },
      async (file) => {
        await apply(edit(new Uint8Array<ArrayBuffer>(await file.arrayBuffer())))
      },
    )
  }

  return (
    <Show when={platform.editMascot}>
      <div class="settings-section">
        <SettingsList>
          <SettingsRow
            title={language.t("settings.mascot.title")}
            description={language.t("settings.mascot.description")}
          >
            <Button
              size="small"
              variant="ghost"
              data-action="settings-mascot-reset"
              disabled={busy() || !customized()}
              onClick={() => apply({ type: "reset" })}
            >
              {language.t("settings.mascot.reset.action")}
            </Button>
          </SettingsRow>

          <For each={STATES}>
            {(item) => (
              <SettingsRow title={language.t(item.title)} description={language.t(item.description)}>
                <div class="flex items-center gap-2" data-action={`settings-mascot-${item.state}`}>
                  <Picture src={pictureFor(item.state)} label={language.t("settings.mascot.builtin")} />
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={busy()}
                    onClick={() => upload(false, (bytes) => ({ type: "setState", state: item.state, bytes }))}
                  >
                    {language.t(pictureFor(item.state) ? "settings.mascot.replace" : "settings.mascot.upload")}
                  </Button>
                  <Show when={pictureFor(item.state)}>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy()}
                      onClick={() => apply({ type: "clearState", state: item.state })}
                    >
                      {language.t("settings.mascot.remove")}
                    </Button>
                  </Show>
                </div>
              </SettingsRow>
            )}
          </For>

          <SettingsRow
            title={language.t("settings.mascot.actions.title")}
            description={language.t("settings.mascot.actions.description")}
          >
            <div class="flex flex-wrap items-center justify-end gap-2" data-action="settings-mascot-actions">
              <For each={actions()}>
                {(src, index) => (
                  <div class="flex items-center gap-1">
                    <Picture src={src} label={String(index() + 1)} />
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy()}
                      onClick={() => apply({ type: "removeAction", index: index() })}
                    >
                      {language.t("settings.mascot.remove")}
                    </Button>
                  </div>
                )}
              </For>
              <Button
                size="small"
                variant="ghost"
                disabled={busy() || actions().length >= MASCOT_MAX_ACTIONS}
                onClick={() => upload(true, (bytes) => ({ type: "addAction", bytes }))}
              >
                {language.t(
                  actions().length >= MASCOT_MAX_ACTIONS ? "settings.mascot.actions.limit" : "settings.mascot.actions.add",
                )}
              </Button>
            </div>
          </SettingsRow>
        </SettingsList>
      </div>
    </Show>
  )
}

const Picture: Component<{ src: string | undefined; label: string }> = (props) => (
  <Show
    when={props.src}
    fallback={<span class="text-11-regular text-v2-text-text-muted">{props.label}</span>}
  >
    {(src) => <img src={src()} alt="" aria-hidden="true" class="h-10 w-10 object-contain" />}
  </Show>
)
