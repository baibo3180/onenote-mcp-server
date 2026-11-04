# OneNote MCP Server — fork with truly persistent login

[![CI](https://github.com/baibo3180/onenote-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/baibo3180/onenote-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

An MCP (Model Context Protocol) server that lets an AI assistant read, search,
write and edit your Microsoft OneNote notebooks over Microsoft Graph — 25 tools
covering notebooks, sections, section groups and pages.

This is a fork of
[IAmKSquared/onenotemcp](https://github.com/IAmKSquared/onenotemcp) (MIT).
Upstream asks for a device-code login far too often; this fork fixes the token
plumbing so **you authenticate once per machine, not once per hour**.

---

## What this fork changes

| Change                                                                   | Why it matters                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Persistent MSAL cache actually enabled (`tokenCachePersistenceOptions`)  | Upstream passed a wrong field name and never registered the cache plugin, so the refresh token died with the process |
| `AuthenticationRecord` persisted (AES-256-GCM) and reloaded on startup   | A brand-new process can renew silently instead of prompting for a device code                                        |
| `createCredential()` is async and awaited                                | It used to pass an unresolved `Promise` as the account record → silent renewal broke                                 |
| Stale cache-lock cleanup (30s threshold)                                 | A crash while holding MSAL's lock file used to degrade every later renewal into a device-code prompt                 |
| Renewal credential is **silent-only** (`disableAutomaticAuthentication`) | On a fresh install the first tool call used to block for up to 15 minutes waiting for a login you never saw          |
| Device-code prompt is forced to **stderr**                               | The SDK printed it to stdout, which corrupts the MCP JSON-RPC stream and makes the client report a hung server       |
| `npm install` no longer runs `husky` via `prepare`                       | `npm install` failed outright in a folder without `.git` (e.g. ZIP download)                                         |
| Troubleshooting docs for device-code loops and the OneNote freeze bug    | Saves hours of debugging                                                                                             |

Measured on Windows 11 / Node 22: cold process, expired access token, 24
concurrent renewals — zero prompts, and the refresh token rotates on disk each
time (rolling 90-day lifetime).

---

## Requirements

- **Node.js ≥ 20**
- A Microsoft account with OneNote (personal or work/school)
- No Azure subscription needed for a quick test (see [Client ID](#client-id))

---

## Installation

### Option A — clone (recommended)

```bash
git clone https://github.com/baibo3180/onenote-mcp-server.git
cd onenote-mcp-server
npm install
```

Recommended because the session files (`.access-token.txt`, `.auth-record.txt`)
live in the project folder. They survive restarts and `git pull`, so you stay
logged in.

> If `git clone` stalls or fails with `Connection was reset`, force HTTP/1.1 and
> retry — GitHub over HTTP/2 is throttled on some networks:
>
> ```bash
> git -c http.version=HTTP/1.1 clone https://github.com/baibo3180/onenote-mcp-server.git
> ```
>
> Simply run it again if it fails once. The connection is intermittent, not
> broken.

### Option B — run straight from GitHub

```bash
npx -y github:baibo3180/onenote-mcp-server
```

Zero install, but every time npm re-fetches the repository (new commit, cleared
npx cache) it lands in a **different folder**, so `.auth-record.txt` is gone and
you will be asked for a device code again. The MSAL refresh token in the OS
token cache survives, but it is not enough on its own. Prefer Option A if you
dislike re-authenticating.

> This needs **npm itself** to reach `github.com` (it shells out to git and
> pulls a tarball). Behind a proxy that blocks GitHub you get `E502 Bad Gateway`
> or a silent hang. Use Option A in that case — the `git` client can be forced
> onto HTTP/1.1 as shown above.

### Forked this repo?

Everything is relative to the checkout, so a fork behaves exactly like the
original — no code references this repository's URL. Only the docs and
`package.json` names point at the original owner, so after forking, replace
`baibo3180` with your username in:

| File           | What                                                               |
| -------------- | ------------------------------------------------------------------ |
| `README.md`    | clone URL, `npx github:` example, the Windows `cmd /c npx` snippet |
| `package.json` | `repository.url`, `bugs.url`, `homepage`                           |
| `CHANGELOG.md` | the `npx github:` line (cosmetic)                                  |

```bash
git clone https://github.com/<your-user>/onenote-mcp-server.git
cd onenote-mcp-server
npm install
```

Two things stay per-machine, not per-repo, so a fork is not "shared login":

- `<repo>/.access-token.txt` and `<repo>/.auth-record.txt` live **inside the
  checkout** — every clone/fork needs one `authenticate` on first run.
- The MSAL refresh token lives in the OS cache (Windows DPAPI, macOS Keychain,
  Linux libsecret). It is scoped to your OS user, so it never travels with a
  fork.

Both are already in `.gitignore`; a fork will not carry your credentials, and
your fork will not leak them either.

---

## Connect your MCP client

Add this to your client's MCP configuration (Trae, Claude Desktop, Cursor, …):

```json
{
  "mcpServers": {
    "onenote": {
      "command": "node",
      "args": ["/absolute/path/to/REPO/src/server.mjs"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Notes:

- Use an **absolute** path to `src/server.mjs`.
- `NODE_ENV=production` keeps structured logs on stderr (stdout stays clean for
  the MCP protocol).
- On Windows some clients cannot spawn `.cmd` shims. If you use the `npx` route,
  set `"command": "cmd"` and
  `"args": ["/c", "npx", "-y", "github:baibo3180/onenote-mcp-server"]`.
- Optional environment variables: `AZURE_CLIENT_ID`, `LOG_LEVEL`.

---

## First-time authentication (once per machine)

1. Restart your MCP client so it loads the new server.
2. Call the **`authenticate`** tool.
3. It returns a device code and a URL. Open <https://microsoft.com/devicelogin>,
   enter the code and sign in with the account that owns your OneNote notebooks.
4. Call **`listNotebooks`** — you should see your notebooks.

From then on:

- the **access token** (~1 hour) is renewed silently before it expires;
- the **refresh token** is rotated and written back on every use, so its rolling
  90-day window keeps moving as long as you use the server;
- a new process (app restart, reboot, client switch) renews silently — no device
  code.

### Where credentials live

| File                        | Purpose                                  | Protection                                               |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `<repo>/.access-token.txt`  | Current access token + metadata          | AES-256-GCM                                              |
| `<repo>/.auth-record.txt`   | Account record needed for silent renewal | AES-256-GCM                                              |
| OS keychain (`onenote-mcp`) | AES key                                  | Windows Credential Manager / Keychain / libsecret        |
| MSAL token cache (OS-level) | Refresh token                            | Windows: DPAPI file · macOS: Keychain · Linux: libsecret |

If no OS keychain is available at all, the AES key falls back to a file
**outside the project**: `%LOCALAPPDATA%\onenote-mcp\encryption.key` on Windows,
`~/.config/onenote-mcp/encryption.key` elsewhere (override with
`ONENOTE_MCP_KEY_FILE`). It is never written into the checkout, so zipping or
copying the project does not hand over the key.

MSAL cache location per OS:

- **Windows** — `%LOCALAPPDATA%\.IdentityService\msal.cache.nocae` (DPAPI,
  current user; a sibling `.lockfile` serialises cross-process access)
- **macOS** — macOS Keychain, service `Microsoft.Developer.IdentityService`
- **Linux** — libsecret / GNOME Keyring. The backend is loaded lazily: if
  `libsecret-1.so.0` is missing (`sudo apt install libsecret-1-0`), the server
  still starts and works, but keeps tokens in memory only — so you log in once
  per process run instead of once per machine. Set
  `ONENOTE_MCP_DISABLE_CACHE_PERSISTENCE=1` to skip the native backend on
  purpose (useful on headless hosts and in CI).

All of these are already in `.gitignore`. **Never commit them** — the token
cache is a credential that grants standing access to your notes.

---

## Troubleshooting

**The first tool call hangs, or the client says the server is unresponsive**

Fixed in 1.1.1. On a fresh install with no saved login, the renewal credential
used to start an interactive device-code flow inside the tool call — blocking up
to 15 minutes and printing the prompt to **stdout**, which corrupts the MCP
stream. Renewal is now silent-only: you get an instant `Authentication Required`
message telling you to run `authenticate`.

If you are on 1.1.0 or earlier, call `authenticate` before any other tool, or
upgrade.

**Asked for a device code again, even though I logged in before**

In order of likelihood:

1. A crash left `msal.cache.nocae.lockfile` behind. This fork deletes locks
   older than 30 seconds automatically; if you are on a build without that fix,
   delete the file manually.
2. The cache or the account record was deleted (`msal.cache.nocae`,
   `.auth-record.txt`), or you cleared Windows Credential Manager.
3. More than 90 days without using the server (documented refresh-token
   lifetime), or you revoked the app at
   <https://account.live.com/consent/Manage>.
4. You ran it through `npx` and npm re-downloaded the repo (see Option B).

Re-running `authenticate` is the fix in every case.

**`No access token available. Please authenticate first...`**

Nothing to renew from. Call `authenticate` once.

**OneNote desktop freezes when I click a code block on a page the server wrote**

OneNote converts every newline inside `<pre>` / `<code>` into an object
placeholder character (`U+FFFC`). Pages containing them can make the desktop
client hang. When generating page HTML, write code as **one `<p>` per line**
with a monospace `<span>` (e.g. `font-family:Consolas`), and put inline code in
a monospace span instead of `<code>`.

**Everything worked, then stopped after I moved the folder**

The paths in your MCP config are absolute, and the account record is bound to
the old location. Update the config path and call `authenticate` once.

**`git clone` hangs, or `npx github:` ends with `E502` / never prints anything**

Network, not code. Two different clients are involved:

- `npx github:...` → npm does the fetching, and npm honours the proxy
  environment. If that proxy cannot reach GitHub, you get `E502` or a silent
  hang. Do not fight it — clone first (Option A), then `npm install` from the
  local folder and point your MCP client at `src/server.mjs`.
- `git clone` → force HTTP/1.1 (`git -c http.version=HTTP/1.1 clone ...`) and
  retry on failure. If a proxy is set, unset it for the clone:
  `env -u HTTPS_PROXY -u HTTP_PROXY git clone ...`

Once the repo is on disk, nothing else needs GitHub access — `authenticate`
talks only to `login.microsoft.com`.

---

## Client ID

Out of the box the server uses Microsoft Graph Explorer's public client ID. It
is fine for trying things out, but it is shared by many apps and not something
you should rely on long-term.

For regular use, register your own app in
[Microsoft Entra admin center](https://entra.microsoft.com):

1. **App registrations → New registration**
2. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts**
3. **Authentication → Allow public client flows: Yes**
4. Copy the _Application (client) ID_ and set `AZURE_CLIENT_ID` in your MCP
   config's `env` block.

Delegated permissions used: `Notes.Read`, `Notes.ReadWrite`, `Notes.Create`,
`User.Read` (`offline_access` is added implicitly).

---

## Available tools (25)

- **Auth:** `authenticate`, `saveAccessToken`
- **Read:** `listNotebooks`, `listSections`, `listSectionGroups`,
  `searchSections`, `listPagesInSection`, `searchPages`, `getRecentPages`,
  `getPageContent`, `getPageByTitle`, `getPageLink`
- **Create:** `createNotebook`, `createSection`, `createSectionGroup`,
  `createPage`, `createPageInSection`
- **Write:** `updatePageContent`, `appendToPage`, `updatePageTitle`,
  `replaceTextInPage`, `addNoteToPage`, `addTableToPage`
- **Delete / copy:** `deletePage`, `copyPage`

Full parameter-level reference:
[`docs/UPSTREAM_README.md`](docs/UPSTREAM_README.md).

---

## Development

```bash
npm install
npm run quality        # eslint + prettier --check + all tests
npm run husky:init     # optional: install git hooks
```

Tests do not need a Microsoft account; they mock Graph.

---

## Security notes

- The server runs locally over stdio and only talks to `graph.microsoft.com`.
- Token files are encrypted with a key held in the OS keychain; the MSAL cache
  is protected by DPAPI (Windows) / Keychain (macOS) / libsecret (Linux).
- Credentials are per-user and per-machine. Copying the project folder to
  another PC does **not** carry the login over.
- Revoke access at <https://account.live.com/consent/Manage> (personal accounts)
  or in Entra ID (work accounts) if you ever suspect exposure.

---

## Credits & license

MIT — see [LICENSE](LICENSE).

- Original project:
  [IAmKSquared/onenotemcp](https://github.com/IAmKSquared/onenotemcp) by Kyle
  Klimek.
- That project was in turn derived from
  [eshlon/onenotemcp](https://github.com/eshlon/onenotemcp).
- This fork adds persistent authentication, the stale-lock guard and the
  packaging fixes described above.

Not affiliated with or endorsed by Microsoft. OneNote and Microsoft Graph are
trademarks of Microsoft Corporation.

---

## 中文快速开始

1. 安装：`git clone https://github.com/baibo3180/onenote-mcp-server.git` →
   `cd onenote-mcp-server` → `npm install` （需要 Node ≥ 20）。
2. 在你的 MCP 客户端里加配置，`command` 用 `node`，`args` 填
   `<仓库绝对路径>/src/server.mjs`，`env` 里加 `NODE_ENV=production`。
3. 重启客户端，调用 `authenticate` 工具，按返回的设备码到
   <https://microsoft.com/devicelogin> 登录。
4. 再调用 `listNotebooks` 验证。之后同一台机器上会自动静默续期，不用反复登录。

注意：`npx github:...`
每次重新拉取都会换目录，需要重新授权一次；想长期免登录请用上面的 clone 方式。
