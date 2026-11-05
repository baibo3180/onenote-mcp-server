# Changelog

All notable changes to this fork are documented here.

## 1.1.5 — 2026-11-05

Correctness and reliability fixes found while verifying user feedback. No
credential format changes: an existing login keeps working.

### Fixed

- **Markdown links could inject HTML attributes.** `textToHtml()` put a
  `sanitizeUrl()` result straight into `href="..."` without escaping quotes, so
  `[x](https://example.com/" onmouseover="alert(1))` produced an extra
  `onmouseover` attribute on pages written by every write tool. URLs are now
  decoded, validated and escaped for a double-quoted attribute. `sanitizeUrl()`
  also blocks protocol-relative URLs (`//evil.com`), control-character and
  HTML-entity obfuscation of forbidden schemes.
- **Multi-line fenced code blocks produced invalid HTML.** Each code line was
  wrapped in `<p>` _inside_ `<pre><code>`, and the fence language (`bash`) was
  rendered as the first line of code. Blocks are now extracted before any
  line-based processing, newlines become `<br>` (OneNote's importer turns raw
  CR/LF inside `<pre>` into U+FFFC), and the language token is consumed rather
  than printed.
- **Nested `<p>` in headings, table cells and notes.** New `textToInlineHtml()`
  renders inline markup without block wrappers; it is used for page titles,
  table headings/cells and note bodies. A preserved page title is no longer
  emitted as `<h1><p>…</p></h1>`, which confused OneNote's title detection.
- **An unhandled promise rejection killed the server before `initialize`.**
  `main()` had no `.catch()` and there were no process-level handlers. Startup
  failures now produce a fatal log on stderr and a clean exit, while a stray
  background rejection is logged and the live stdio connection is kept.
- **The startup banner undercounted the tools.** It listed 22 hand-written names
  (7 read, 6 edit) while the server actually exposes 25 (10 read, 7 edit, with
  `copyPage` registered in the edit module). The banner is now derived from the
  real registration catalog, so it cannot drift again.

### Added

- `escapeHtmlAttribute()` and `textToInlineHtml()` exports, plus regression
  tests for URL injection, code blocks and inline rendering.
- `test/test_startup.mjs`: spawns the real server over raw stdio JSON-RPC and
  verifies both a clean `initialize` and survival of an injected unhandled
  rejection. Wired into `npm test` (`test:startup`).

### Docs

- The install checklist's "keytar 加载钩子" section referenced three
  `scripts/*.mjs` files that do not exist in this repository and mixed in
  hard-coded paths from another machine; it has been replaced with the real
  v1.1.3+ behaviour (automatic native-backend probe, in-memory fallback).
- Shell examples now show both PowerShell and Bash forms, and the tool count
  breakdown matches the real catalog.

## 1.1.4 — 2026-11-04

Security hardening. Existing logins keep working: the saved key is migrated
automatically on first run.

### Fixed

- **The fallback AES key no longer lives inside the project folder.** When no OS
  keychain was available the key was written to `<repo>/.local-secret-key`,
  right next to the ciphertext it unlocks — so copying, zipping or force-adding
  the project handed over both halves of the credential. It now goes to
  `%LOCALAPPDATA%\onenote-mcp\encryption.key` (`~/.config/onenote-mcp/`
  elsewhere, or `ONENOTE_MCP_KEY_FILE`), and a key left in the old location is
  moved on first use.

### Added

- `SECURITY.md` documenting the data boundary: the only outbound hosts are
  `login.microsoftonline.com` and `graph.microsoft.com`, credentials are never
  committed, and notebook content is never written to disk by the server.

## 1.1.3 — 2026-11-04

Fixes a startup crash on Linux. No credential format changes: an existing login
keeps working, and Windows/macOS behaviour is unchanged.

### Fixed

- **The server could die on startup on Linux.**
  `@azure/identity-cache-persistence` pulls in `@azure/msal-node-extensions` →
  `keytar`, which `dlopen()`s `libsecret-1.so.0` as soon as it is required. On a
  host without libsecret the import threw — and on Node 20 aborted the process
  outright — so the stdio server closed the connection on the very first tool
  call instead of merely losing the persistent cache. The plugin is now probed
  in a throwaway child process and only loaded when that probe succeeds;
  otherwise the server runs with an in-memory cache and asks for a login once
  per process run.

### Added

- `ONENOTE_MCP_DISABLE_CACHE_PERSISTENCE=1` skips the native backend on purpose
  (useful on headless hosts and in CI).
- GitHub Actions CI: `npm run quality` (lint, prettier, tests) on Node 20, 22
  and 24, with lint/format/test as separate steps.

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
