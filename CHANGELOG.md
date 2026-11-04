# Changelog

All notable changes to this fork are documented here.

## 1.1.2 — 2026-11-04

Documentation only; no code change since 1.1.1.

### Changed

- README install section now separates the two network paths: `git clone`
  (Option A) honours `http.version` and is the reliable one behind a proxy;
  `npx github:` (Option B) makes **npm** do the fetching, so a proxy that blocks
  GitHub yields `E502` or a silent hang.
- Added troubleshooting for `git clone` stalls (force HTTP/1.1, retry, unset
  proxy) and for `npx github:` failures.
- Noted that after cloning, nothing else needs GitHub access — authentication
  only talks to `login.microsoft.com`.

## 1.1.1 — 2026-11-04

Fixes for first-run and forked copies. No credential format changes: an existing
login keeps working.

### Fixed

- **The first tool call could hang for up to 15 minutes.** With no saved login,
  the renewal `DeviceCodeCredential` fell back to an interactive device-code
  flow _inside_ the tool call, waiting for a login the user never saw. Renewal
  is now created with `disableAutomaticAuthentication: true`, so it fails fast
  and the tool returns `Authentication Required` in milliseconds instead.
- **The device-code prompt was printed to stdout**, which corrupts the MCP
  JSON-RPC stream and makes clients report a broken or hung server. The SDK
  prompt is now redirected to stderr; the real code is delivered by the
  `authenticate` tool.
- **A transient renewal failure broke every request.** The Graph `authProvider`
  now falls back to the access token already held in memory instead of failing
  the call outright.
- **LICENSE was not detected as MIT** because a fork-attribution paragraph was
  inserted in the middle of the licence text. It is verbatim MIT again; the
  attribution lives in the README credits.

### Changed

- README: added a "Forked this repo?" section (which three files name the
  original owner), per-OS credential locations, and a troubleshooting entry for
  the first-call hang.
- `.gitignore`: a trailing comment made the `!.env.example` rule ineffective.

## 1.1.0 — 2026-11-04

Fork of [IAmKSquared/onenotemcp](https://github.com/IAmKSquared/onenotemcp) with
fixes for authentication persistence and packaging.

### Fixed

- **Persistent token cache was never actually enabled.** The
  `tokenCachePersistenceOptions` object used `enablePersistence` instead of the
  required `enabled`, so the provider was ignored and every process fell back to
  an in-memory cache.
- **Cache persistence plugin was not registered.**
  `useIdentityPlugin(cachePersistencePlugin)` is now called once at module load;
  without it the SDK throws and the credential silently degrades to
  non-persistent.
- **Account record was never persisted**, so a new process had no way to look up
  the stored refresh token and always fell back to a device-code prompt. The
  `AuthenticationRecord` is now saved (AES-256-GCM) and reloaded on startup.
- **`createCredential()` passed a `Promise` as the account record.** It called
  an async loader without awaiting it; the function is now async and every
  caller awaits it.
- **`npm install` failed outside a git checkout.** The `prepare: husky` script
  aborted installs in folders without `.git` (e.g. ZIP downloads). Husky is now
  opt-in via `npm run husky:init`.
- **A stale MSAL lock file forced a device-code prompt.** If a process died
  while holding `msal.cache.nocae.lockfile`, every later renewal failed to read
  the cache and re-prompted. Locks older than 30 seconds are now removed before
  the credential is built.

### Changed

- Server version reported over MCP now comes from `package.json` instead of a
  hardcoded string.
- Added a `bin` entry (`onenote-mcp`), so
  `npx github:baibo3180/onenote-mcp-server` works.
- Standardised on npm: removed the pnpm lock/workspace files, regenerated
  `package-lock.json`.
- `.gitignore` now also covers `.auth-record.txt`, token backups and local
  scratch scripts.
- New README focused on installing from this repository; the upstream README is
  preserved at `docs/UPSTREAM_README.md` for its tool reference.

### Verified

- Fresh process with an expired access token renews silently (no device code).
- Refresh token rotates on disk on every renewal (rolling 90-day lifetime).
- 24 concurrent renewals across 6 processes: all succeeded, no prompts, no cache
  corruption.
- Clean export → `npm ci` → server boots with 25 tools.

## 1.0.0 — upstream baseline

Initial fork point, matching upstream `onenote-mcp-server` 1.0.0.
