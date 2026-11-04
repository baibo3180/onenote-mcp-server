import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { KeyStorage } from './key-storage.mjs';
import { ENCRYPTION } from '../config/constants.mjs';
import { logger } from '../utils/logger.mjs';

/**
 * Custom error class for decryption failures.
 * Use instanceof DecryptionError to detect decryption-specific errors.
 */
export class DecryptionError extends Error {
  /**
   *
   * @param message
   */
  constructor(message) {
    super(message);
    this.name = 'DecryptionError';
  }
}

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback location for the AES key, used only when the OS keychain is
// unavailable. It deliberately lives OUTSIDE the checkout: keeping the key next
// to the encrypted token files (as this fork did up to 1.1.3) means copying the
// project folder, zipping it, or force-adding it to a fork also hands over the
// key — which turns the encryption into decoration.
const legacyKeyFilePath = path.join(__dirname, '..', '..', '.local-secret-key');

/**
 * Resolves the per-user path for the fallback key file.
 * @returns {string} Absolute path to the key file.
 */
function resolveKeyFilePath() {
  if (process.env.ONENOTE_MCP_KEY_FILE) return process.env.ONENOTE_MCP_KEY_FILE;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'onenote-mcp', 'encryption.key');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'onenote-mcp', 'encryption.key');
}

const keyFilePath = resolveKeyFilePath();

/**
 * Moves a key left in the old in-repo location to the per-user directory, so
 * existing installs keep decrypting their saved tokens after the upgrade.
 * @returns {void}
 */
function migrateLegacyKeyFile() {
  try {
    if (!existsSync(legacyKeyFilePath) || existsSync(keyFilePath)) return;
    mkdirSync(path.dirname(keyFilePath), { recursive: true, mode: 0o700 });
    try {
      copyFileSync(legacyKeyFilePath, keyFilePath, 0o600);
    } finally {
      // Only drop the old copy once the new one exists.
      if (existsSync(keyFilePath)) unlinkSync(legacyKeyFilePath);
    }
    logger.info('Moved the local encryption key out of the project folder');
  } catch (error) {
    // A failure here only costs a re-login (a new key is generated); never fatal.
    logger.warn({ err: error }, 'Could not migrate the legacy local encryption key');
  }
}

const keyStorage = new KeyStorage(keyFilePath);

/**
 * Retrieves or generates the encryption key from secure storage.
 * @returns {Promise<Buffer>} The 32-byte encryption key.
 */
export async function getEncryptionKey() {
  // Move any key stranded in the checkout to the per-user directory first.
  migrateLegacyKeyFile();

  // Attempt migration from file-based to keyring storage
  await keyStorage.migrate();

  // Try to get existing key
  const existingKey = await keyStorage.getKey();
  if (existingKey) {
    return Buffer.from(existingKey, 'hex');
  }

  // Generate new key
  const newKey = crypto.randomBytes(ENCRYPTION.KEY_LENGTH_BYTES);
  await keyStorage.setKey(newKey.toString('hex'));
  logger.info('🔑 Generated new encryption key and stored securely.');
  return newKey;
}

/**
 * Encrypts text using AES-256-GCM (authenticated encryption).
 * @param {string} text - The text to encrypt.
 * @returns {Promise<object>} The encrypted data { iv, encryptedData, authTag }.
 */
export async function encrypt(text) {
  if (typeof text !== 'string') {
    throw new Error('encrypt() requires a string input');
  }
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(ENCRYPTION.IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION.ALGORITHM, key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypts text using AES-256-GCM (authenticated encryption).
 * @param {object} text - The encrypted data object { iv, encryptedData, authTag }.
 * @returns {Promise<string>} The decrypted text.
 * @throws {DecryptionError} If the input object is structurally invalid (wrong type or missing fields).
 * @throws {Error} A native crypto error if GCM authentication fails (data was tampered with or the key is wrong).
 */
export async function decrypt(text) {
  // Validate input structure
  if (!text || typeof text !== 'object') {
    throw new DecryptionError('Invalid encrypted data: expected object');
  }
  if (!text.iv || !text.encryptedData || !text.authTag) {
    throw new DecryptionError(
      'Invalid encrypted data: missing required fields (iv, encryptedData, authTag)'
    );
  }

  const key = await getEncryptionKey();
  const iv = Buffer.from(text.iv, 'hex');
  const encryptedText = Buffer.from(text.encryptedData, 'hex');
  const authTag = Buffer.from(text.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION.ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}
