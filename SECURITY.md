# Security

This server handles two things worth protecting: your Microsoft account
credentials, and the contents of your OneNote notebooks. This document states
exactly what happens to both, so you can verify the claims against the code.

## What leaves your machine

Only two destinations, both Microsoft-owned:

- `login.microsoftonline.com` — device-code login and token refresh.
- `graph.microsoft.com` — the OneNote API calls you ask for.

There is no analytics, no telemetry, no crash reporting, no "phone home" call.
The source has no other outbound host
(`grep -rhoE 'https?://[a-zA-Z0-9.-]+' src/`). Your notebook content goes from
Microsoft Graph to the MCP client you are using, in memory, and nowhere else.

## What is stored, and where

| Item                               | Location                                                | Protection                                |
| ---------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Access token + metadata            | `<repo>/.access-token.txt`                              | AES-256-GCM                               |
| Authentication record (account ID) | `<repo>/.auth-record.txt`                               | AES-256-GCM                               |
| AES key                            | OS keychain (`onenote-mcp`)                             | Credential Manager / Keychain / libsecret |
| AES key, keychain-less fallback    | `%LOCALAPPDATA%\onenote-mcp` or `~/.config/onenote-mcp` | file mode 0600, **outside the repo**      |
| Refresh token                      | MSAL cache (OS-level)                                   | DPAPI / Keychain / libsecret              |

Every credential file is listed in `.gitignore`. The encrypted token files hold
ciphertext only: the key is not in the repository, so copying or zipping the
project directory does not expose a usable token.

## Trust boundary

- Tokens identify **your** Microsoft account. Nothing is shared between users of
  this repo, and a fork does not inherit anyone's credentials.
- The default client ID in `src/config/constants.mjs` is Microsoft's public
  "Graph Command Line Tools" application ID — a public identifier, not a secret.
  Each user consents separately with their own account.
- Anything the server can read, the client you connected it to can read. That is
  the point of the tool; only connect it to clients you trust.

## Hardening notes

- The default is `read` plus whatever tools your client chooses to call. If you
  only need reading, do not call the write/delete tools.
- Revoke access at any time: <https://account.live.com/consent/Manage>, then
  delete `.access-token.txt`, `.auth-record.txt` and the OS-level MSAL cache.
- `ONENOTE_MCP_DISABLE_CACHE_PERSISTENCE=1` keeps tokens in memory only.

## Reporting a vulnerability

Open a private security advisory via the repository's **Security** tab, or email
the maintainer listed in `package.json`. Please do not open a public issue for a
credential-handling flaw before it is fixed.
