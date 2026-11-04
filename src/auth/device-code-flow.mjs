import { DeviceCodeCredential, useIdentityPlugin } from '@azure/identity';
import { cachePersistencePlugin } from '@azure/identity-cache-persistence';
import { statSync, unlinkSync } from 'fs';
import path from 'path';
import { saveToken, saveAuthRecord, loadAuthRecord } from './token-manager.mjs';
import { TIMEOUTS, AUTH_CONFIG } from '../config/constants.mjs';
import { logger } from '../utils/logger.mjs';

// Register the persistent token-cache plugin ONCE. Without this, passing
// `tokenCachePersistenceOptions: { enabled: true }` is silently ignored (or
// throws and falls back to an in-memory cache), so the refresh token would
// never survive a process restart.
useIdentityPlugin(cachePersistencePlugin);

// --- Configuration ---
const clientId = process.env.AZURE_CLIENT_ID || AUTH_CONFIG.DEFAULT_CLIENT_ID;
const scopes = AUTH_CONFIG.SCOPES;

// The persistent cache plugin serialises read/write with a lock file next to the
// cache. Unlock() only runs on the normal path, so a process killed while
// holding the lock leaves the file behind forever. A leftover lock makes every
// later read fail (the plugin gives up after ~5s), which makes MSAL believe the
// cache is empty and fall back to a fresh device-code prompt. Locks are held for
// milliseconds, so anything older than this threshold is definitely orphaned.
const STALE_LOCK_MS = 30 * 1000;
const cacheLockPath =
  process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, '.IdentityService', 'msal.cache.nocae.lockfile')
    : null;

/**
 * Removes an orphaned cache lock left behind by a crashed process, so token
 * renewal does not degrade into a device-code prompt. Never touches a lock that
 * is currently held (i.e. younger than STALE_LOCK_MS).
 * @returns {void}
 */
function clearStaleCacheLock() {
  if (!cacheLockPath) return;
  try {
    const { mtimeMs } = statSync(cacheLockPath);
    const ageMs = Date.now() - mtimeMs;
    if (ageMs > STALE_LOCK_MS) {
      unlinkSync(cacheLockPath);
      logger.warn(
        { ageMs, path: cacheLockPath },
        'Removed stale MSAL cache lock file left by a crashed process'
      );
    }
  } catch {
    // No lock file (the common case) or it vanished concurrently: nothing to do.
  }
}

/**
 * Initiates device code authentication flow.
 * @param {import('../session.mjs').OneNoteSession} session - The session instance.
 * @returns {Promise<{success: boolean, deviceCodeInfo: object | null, authPromise: Promise | null, error: string | null}>}
 */
export async function authenticateWithDeviceCode(session) {
  try {
    logger.info('Starting device code authentication...');
    let deviceCodeInfo = null;

    const credential = buildCredential({
      userPromptCallback: (info) => {
        deviceCodeInfo = info;
        logger.info(
          `\n=== AUTHENTICATION REQUIRED ===\n${info.message}\n================================\n`
        );
      },
    });

    // Keep a reference to the credential so the Graph client can silently renew
    // the access token (using the persisted refresh token) without re-prompting.
    session.setCredential(credential);
    session.setScopes(scopes);

    // Run the device-code flow, then persist the AuthenticationRecord so that a
    // brand-new process can silently renew the token later. `authenticate()`
    // performs the interactive device-code login AND returns the account record;
    // the subsequent `getToken()` is silent because the account is now cached
    // in this process.
    const authPromise = (async () => {
      // Interactive device-code login; returns the account record.
      const record = await credential.authenticate(scopes);
      // Persisting the record must not invalidate a successful login: if it
      // fails we still have a working session for this process.
      try {
        await saveAuthRecord(record);
      } catch (recordError) {
        logger.warn(
          { err: recordError },
          'Could not persist authentication record; cross-process silent renewal may require a re-login after restart'
        );
      }
      // Silent now (account already cached in this process).
      const tokenResponse = await credential.getToken(scopes);
      session.setAccessToken(tokenResponse.token);
      const tokenData = {
        token: tokenResponse.token,
        clientId: clientId,
        scopes: scopes,
        createdAt: new Date().toISOString(),
        expiresOn: tokenResponse.expiresOnTimestamp
          ? new Date(tokenResponse.expiresOnTimestamp).toISOString()
          : null,
      };
      await saveToken(tokenData);
      return tokenResponse;
    })();

    // Ensure the promise always has a rejection handler; otherwise a getToken
    // rejection during the sleep or an early return would surface as an
    // unhandled rejection and crash the whole MCP server.
    authPromise.catch((error) => {
      logger.error({ err: error }, 'Background authentication failed');
      session.setAuthError(error?.message || 'Authentication failed');
    });

    await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DEVICE_CODE_CALLBACK_MS)); // Allow time for userPromptCallback

    if (!deviceCodeInfo) {
      return {
        success: false,
        deviceCodeInfo: null,
        authPromise: null,
        error: 'Could not retrieve device code information.',
      };
    }

    return {
      success: true,
      deviceCodeInfo,
      authPromise,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      deviceCodeInfo: null,
      authPromise: null,
      error: error.message,
    };
  }
}

/**
 * Constructs a DeviceCodeCredential.
 *
 * Enables persistent token caching so the refresh token is stored in the OS
 * credential store and can be used to silently renew the access token across
 * process restarts (no re-login needed for months). Falls back to an in-memory
 * credential if the native persistence backend is unavailable, so authentication
 * still works (with within-process silent renewal only).
 *
 * @param {object} [extra] - Extra options forwarded to DeviceCodeCredential (e.g. userPromptCallback, authenticationRecord).
 * @returns {DeviceCodeCredential} The credential instance.
 */
export function buildCredential(extra = {}) {
  // Recover from an orphaned lock BEFORE the plugin tries to read the cache.
  clearStaleCacheLock();
  const opts = { clientId, ...extra };
  try {
    return new DeviceCodeCredential({
      ...opts,
      tokenCachePersistenceOptions: { enabled: true },
    });
  } catch (error) {
    logger.warn(
      { err: error },
      'Persistent token cache unavailable, falling back to in-memory credential'
    );
    return new DeviceCodeCredential(opts);
  }
}

/**
 * Creates a credential for silent token renewal (used by the session when no
 * in-memory credential exists yet, e.g. after a process restart). If a
 * previously persisted AuthenticationRecord exists, it is loaded and passed to
 * the credential so it can look up the persisted refresh token and renew
 * silently — no device-code prompt.
 * @returns {DeviceCodeCredential} The credential instance.
 */
export async function createCredential(extra = {}) {
  // IMPORTANT: await the record — loadAuthRecord() is async. Passing the
  // unresolved Promise as `authenticationRecord` would silently produce an
  // account object with undefined fields and break silent renewal.
  const record = await loadAuthRecord();
  const opts = record ? { authenticationRecord: record, ...extra } : { ...extra };
  return buildCredential(opts);
}

/**
 * Gets the client ID being used.
 * @returns {string} The client ID.
 */
export function getClientId() {
  return clientId;
}

/**
 * Gets the scopes being requested.
 * @returns {string[]} The scopes array.
 */
export function getScopes() {
  return scopes;
}
