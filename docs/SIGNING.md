# Code signing

Unsigned apps trigger Windows SmartScreen ("Windows protected your PC") and macOS Gatekeeper ("can't be
opened because Apple cannot check it"). `.github/workflows/release.yml` turns signing on by itself once
these repository secrets exist (GitHub → sriptcollector/bedrock → Settings → Secrets and variables →
Actions). They use the same names as Toolbay Flow and Cereal, so the same values can be copied over.

## Windows: Azure Trusted Signing (about $9.99/month)

Secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `TRUSTED_SIGNING_ACCOUNT`,
`TRUSTED_SIGNING_PROFILE` and, if the account isn't in East US, `TRUSTED_SIGNING_ENDPOINT`
(e.g. `https://weu.codesigning.azure.net`). electron-builder signs the app, the installer and the
uninstaller with them (`azureSignOptions` in `app/electron-builder.config.cjs`).

## macOS: Apple Developer Program ($99/year)

Secrets: `APPLE_CERTIFICATE` (Developer ID Application certificate exported as .p12, base64),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD` (app-specific password), `APPLE_TEAM_ID`.
With the certificate the build is signed with the hardened runtime; with the Apple ID and team id it is
also notarized and stapled. Without them the Mac build is ad-hoc signed only, and people must right-click
→ Open the first time.
