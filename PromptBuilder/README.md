# PaperDesign Prompt Builder

## Data Persistence Overview

This project uses two browser storage layers:

1. IndexedDB (core business data)
   - Database: `prompt-builder-v2`
   - Stores:
     - `canvases`
     - `blocks`
   - Content includes canvas metadata, pipeline order, block content, block color, block position, and IDs.

2. localStorage (UI/settings)
   - All keys with `pb-` prefix are treated as application settings and included in backup.
   - Current known keys:
     - `pb-theme`
     - `pb-result-font-scale`
     - `pb-editor-rect-percent`
     - `pb-editor-size-percent` (legacy compatibility)
     - `pb-layout`

## Persistent Storage Permission (How It Is Requested)

### Entry

Permission check is triggered during every application startup:

- `init()` calls `StoragePersistence.ensure()`
- File: `js/05-actions-init.js`

### Request flow

1. Check whether `navigator.storage.persisted` and `navigator.storage.persist` are supported.
2. If already persisted, mark status as enabled.
3. If not persisted, call `navigator.storage.persist()` to request persistent storage.
4. Update UI status:
   - Header badge (`storage-badge`)
   - Data menu status line (`data-storage-status`)

### Is it requested every time?

- Yes, startup always checks status.
- No repeated forced prompt: if already persisted, it only reads status and does not re-request grant.
- Re-request only happens when current status is not persisted.

### Notes

- Browsers may grant or deny silently based on policy and engagement score.
- This is best-effort protection against browser cleanup, not an absolute guarantee.
- Regular backup is still recommended.

## OneDrive Backup Logic (OAuth + Graph)

This project now uses OneDrive OAuth (Microsoft Entra ID) + Microsoft Graph upload.

Default OAuth values are built in, so normal users do not need to manually input configuration:

- Client ID: `f5bc199c-44bd-495e-9168-7efb5262b048`
- Tenant ID: `a27888d4-ada2-4871-b099-316283e9bdf5`
- Redirect URI: `https://shixund.github.io/PromptBuilder`

### Trigger

- UI path: Data -> OneDrive Backup
- Action: `Actions.backupToOneDrive()`
- Optional advanced override: Data -> Configure OneDrive OAuth (advanced)

### What happens

1. Build full backup payload via `Actions.exportData(false)`.
2. Ensure OneDrive OAuth config exists (Client ID / Tenant / Redirect URI).
3. Sign in with Microsoft account via popup (MSAL browser SDK).
4. Acquire access token for `Files.ReadWrite.AppFolder`.
5. Upload backup JSON to Graph endpoint:
   - `PUT /me/drive/special/approot:/PaperDesignBackups/<file>:/content`
6. Open uploaded file page (`webUrl`) if available.
7. If upload fails, user can choose fallback local download + manual upload.

### Important behavior

- This is direct cloud upload to OneDrive AppFolder when OAuth succeeds.
- Fallback mode still exists for temporary errors or unconfigured OAuth.

### Azure App Registration (for deployment)

Target website:

- `https://shixund.github.io/PromptBuilder`

Register an app in Microsoft Entra admin center and configure:

1. Platform: Single-page application (SPA).
2. Redirect URI: `https://shixund.github.io/PromptBuilder`
3. API permissions (delegated):
   - `Files.ReadWrite.AppFolder`
   - `User.Read`
4. Allow public client/SPA login flow.
5. Ensure the application IDs match the built-in values above, or use advanced override configuration.

Note: Redirect URI must match exactly with Azure configuration.

## Full Export/Import Scope (for Cross-PC Restore)

Current schema version: `2`

Export now includes:

1. Data files
   - All canvases
   - All blocks
   - Block details (including content, color, coordinates, IDs)

2. Settings
   - All `pb-` localStorage entries

3. Pipeline data
   - Pipeline embedded in canvases
   - Additional pipeline snapshot map for compatibility

4. UI snapshot (for closer visual restore)
   - Active canvas ID
   - Canvas panel scroll position
   - Result panel temporary HTML

5. Live draft safety
   - If a block editor is open and unsaved, current editor draft is merged into export snapshot.

Import behavior:

- Fully replaces existing IndexedDB data (`canvases` + `blocks`).
- Replaces existing `pb-` settings.
- Restores preferred active canvas if available.
- Restores canvas scroll and result panel temporary content.
- Compatible with older backup shapes.

## Cross-Computer Migration Steps

1. On old computer:
   - Data -> Export All Data (or OneDrive Backup)
   - Keep generated JSON file

2. Move JSON to new computer:
   - Via OneDrive, USB, or any transfer method

3. On new computer:
   - Open app
   - Data -> Import and Replace
   - Select backup JSON

4. Verify:
   - Canvas count and names
   - Block contents and colors
   - Pipeline order
   - Theme/layout/font settings

## Change Log (2026-04-11)

1. Added data tools menu in header.
2. Added storage status badge and status line in data menu.
3. Added persistent storage request and status update logic.
4. Added full export and import capability.
5. Added OneDrive backup entry and save fallback logic.
6. Upgraded backup schema to v2 full snapshot.
7. Added compatibility parsing for old backup formats.
8. Added live-editor-draft merge during export.
9. Added UI state restore (active canvas, scroll, temporary result HTML).
10. Switched OneDrive backup from file-save mode to OAuth + Graph upload mode.
11. Added OneDrive OAuth configuration entry in Data menu.
12. Added MSAL browser SDK integration and token-based upload to OneDrive AppFolder.
13. Added built-in OAuth app configuration so end users can backup without manual OAuth parameter input.

## Related Files

- `index.html`
- `css/01-theme-base.css`
- `css/03-panels-overlays.css`
- `js/01-core.js`
- `js/04-render-menus.js`
- `js/05-actions-init.js`