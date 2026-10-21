; Included by electron-builder's NSIS installer (electron-builder.config.cjs -> nsis.include).
; Puts <install dir>\bin, which holds the command-line shim (<exeName>.cmd -> dist/cli.js), on the
; per-user PATH (HKCU\Environment, no admin prompt), and takes it off again on uninstall.
; The registry value is read and written raw (REG_EXPAND_SZ, %VARS% kept) through PowerShell, so a
; long PATH is never cut at NSIS's string length limit. The folder is handed over in an environment
; variable, so an apostrophe in the user name can't break the command.

!macro customInstall
  System::Call 'Kernel32::SetEnvironmentVariable(t "TB_CLI_BIN", t "$INSTDIR\bin")i'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$b=$$env:TB_CLI_BIN; $$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p=[string]$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); if((($$p -split ';') | ForEach-Object { $$_.TrimEnd('\') }) -notcontains $$b.TrimEnd('\')){ $$k.SetValue('Path',(($$p.TrimEnd(';')+';'+$$b).TrimStart(';')),[Microsoft.Win32.RegistryValueKind]::ExpandString) }; $$k.Close()"`
  Pop $0
  ; Tell running programs (Explorer, new terminals) that the environment changed.
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  System::Call 'Kernel32::SetEnvironmentVariable(t "TB_CLI_BIN", t "$INSTDIR\bin")i'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$b=$$env:TB_CLI_BIN.TrimEnd('\'); $$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p=[string]$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$n=(($$p -split ';') | Where-Object { $$_ -and ($$_.TrimEnd('\') -ne $$b) }) -join ';'; if($$n -ne $$p){ $$k.SetValue('Path',$$n,[Microsoft.Win32.RegistryValueKind]::ExpandString) }; $$k.Close()"`
  Pop $0
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend
