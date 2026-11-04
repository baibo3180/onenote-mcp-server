import { writeFile, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { encrypt, decrypt } from './encryption.mjs';
import { logger } from '../utils/logger.mjs';

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokenFilePath = path.join(__dirname, '..', '..', '.access-token.txt');
const authRecordFilePath = path.join(__dirname, '..', '..', '.auth-record.txt');

/**
 * Saves an access token to the local file system (encrypted).
 * @param {object} tokenData - The token data object to save.
 * @returns {Promise<void>}
 */
export async function saveToken(tokenData) {
  const encryptedToken = await encrypt(JSON.stringify(tokenData));
  await writeFile(tokenFilePath, JSON.stringify(encryptedToken, null, 2), { mode: 0o600 });
  logger.info('🔒 Token saved securely (encrypted)');
}

/**
 * Persists the AuthenticationRecord (account identity) returned by the first
 * device-code login. A brand-new process (e.g. after the MCP server restarts)
 * constructs its credential with this record, which lets @azure/identity look
 * up the persisted refresh token in the OS credential store and renew the
 * access token SILENTLY instead of forcing the user to log in again.
 * @param {object} record - The AuthenticationRecord from credential.authenticate().
 * @returns {Promise<void>}
 */
export async function saveAuthRecord(record) {
  if (!record) return;
  const encrypted = await encrypt(JSON.stringify(record));
  await writeFile(authRecordFilePath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  logger.info('🔒 Authentication record saved (enables cross-process silent renewal)');
}

/**
 * Loads a previously persisted AuthenticationRecord, or null if none exists
 * (e.g. first run / record was cleared).
 * @returns {Promise<object|null>}
 */
export async function loadAuthRecord() {
  try {
    const fileContent = await readFile(authRecordFilePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    const recordStr = await decrypt(parsed);
    const record = JSON.parse(recordStr);
    // Guard against a corrupted/incomplete record being handed to MSAL, which
    // would produce an account with undefined fields and break silent renewal.
    if (!record || typeof record !== 'object' || !record.homeAccountId || !record.username) {
      logger.warn('Authentication record is missing required fields; ignoring it');
      return null;
    }
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    logger.warn({ err: error }, 'Could not load authentication record');
    return null;
  }
}
