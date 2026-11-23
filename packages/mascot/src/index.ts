export { BUILTIN_DESKTOP_SRC, builtinPack } from "./builtin"
export { columns, FRAME_DIVIDER, frameLines, parseAsciiFrames, type AsciiClip } from "./frames"
export { encodeGif, gifDataUrl, type GifFrame, type Rgb } from "./gif"
export {
  applyRemoteMascot,
  MASCOT_MAX_ACTIONS,
  type MascotEdit,
  cliClip,
  desktopPicture,
  frameAt,
  remoteAssets,
  type MascotPack,
  type MascotPicture,
  type RemoteMascot,
  type RemoteMascotAsset,
} from "./pack"
export {
  deriveMascotState,
  mascotFallbacks,
  mascotInputFromMessages,
  mascotPlacement,
  MASCOT_STATES,
  nextSuccessHold,
  SUCCESS_HOLD_MS,
  type MascotInput,
  type MascotPlacement,
  type MascotSessionMessage,
  type MascotState,
} from "./state"
