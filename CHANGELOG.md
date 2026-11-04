# Changelog

All notable changes to this fork are documented here.

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
- Added a `bin` entry (`onenote-mcp`), so `npx github:baibo3180/onenote-mcp-server` works.
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
