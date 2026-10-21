// IPC channels for the settings window, app-level settings and the keychain (own file so the
// shared ipc.ts stays untouched by this feature).
export const SETTINGS_IPC = {
  popoutControl: "bedrock:popout-control", // (frameName, "minimize"|"maximize"|"close"|"focus"|"devtools")
  popoutState: "bedrock:popout-state", // main -> renderer (frameName, state)
  popoutClosed: "bedrock:popout-closed", // main -> renderer (frameName)
  getAppSettings: "bedrock:app-settings-get",
  setAppSettings: "bedrock:app-settings-set",
  relaunch: "bedrock:relaunch",
  secretsAvailable: "bedrock:secrets-available",
  secretsEncrypt: "bedrock:secrets-encrypt",
  secretsDecrypt: "bedrock:secrets-decrypt",
  getGpuInfo: "bedrock:gpu-info",
  spellcheckLanguages: "bedrock:spellcheck-languages", // () -> {available[], current[]}
  setSpellcheckLanguages: "bedrock:spellcheck-languages-set", // (langs[])
} as const;
