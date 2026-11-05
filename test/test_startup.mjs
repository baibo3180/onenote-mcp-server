/**
 * Startup regressions for the stdio server.
 *
 * An unhandled promise rejection used to kill the process before it answered
 * `initialize`, because main() was called without a .catch() and no rejection
 * listener existed. These tests spawn the real server and speak raw JSON-RPC
 * over stdin/stdout so the protocol stream is checked too.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(repoRoot, 'src', 'server.mjs');

const initializeRequest =
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'startup-test', version: '1.0.0' },
    },
  }) + '\n';

/**
 * Spawns the real server, sends one initialize request and collects output.
 * @param {string[]} extraArgs - Extra Node arguments (e.g. --import hooks).
 * @param {number} [settleAfterStdoutMs] - Extra time to collect stderr after the response.
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number|null}>} Collected stdio output and exit status.
 */
function probeServer(extraArgs = [], settleAfterStdoutMs = 0) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...extraArgs, serverPath], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve({ stdout, stderr, exitCode });
    };

    const timer = setTimeout(() => finish(child.exitCode), 8000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('\n')) {
        // Give late stderr lines (e.g. an injected rejection log) time to land.
        setTimeout(() => finish(), settleAfterStdoutMs);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', () => finish());
    child.on('exit', (code) => {
      // Only settle early when the process died before answering.
      if (!stdout.includes('\n')) finish(code);
    });

    child.stdin.write(initializeRequest);
  });
}

/**
 * Creates a throwaway ESM module that raises an unhandled rejection once the
 * server's own listeners are installed.
 *
 * Rejecting synchronously inside a --import preload is NOT a testable server
 * scenario: on Node 20 that rejection is reported before the entry module
 * graph is even fetched, so no application code can possibly have installed a
 * listener yet. Polling listenerCount() waits for the real guard to be live,
 * which is the situation the server can actually protect.
 * @returns {{dir: string, url: string}} Temp directory and --import URL.
 */
function createRejectionHook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onenote-mcp-startup-'));
  const file = path.join(dir, 'reject-on-import.mjs');
  fs.writeFileSync(
    file,
    `const timer = setInterval(() => {
  if (process.listenerCount('unhandledRejection') > 0) {
    clearInterval(timer);
    Promise.reject(new Error('injected-unhandled-rejection'));
  }
}, 1);
setTimeout(() => clearInterval(timer), 5000).unref();
`,
    'utf8'
  );
  return { dir, url: pathToFileURL(file).href };
}

test('server answers initialize with a clean stdout JSON-RPC stream', async () => {
  const { stdout, stderr } = await probeServer();

  const line = stdout.split('\n').find((candidate) => candidate.trim().startsWith('{'));
  assert.ok(line, `expected a JSON-RPC response on stdout, got: ${stdout.slice(0, 200)}`);
  const response = JSON.parse(line);
  assert.strictEqual(response.jsonrpc, '2.0');
  assert.strictEqual(response.id, 1);
  assert.ok(response.result?.serverInfo, 'initialize result is missing');
  assert.match(stderr, /Available Tools \(25\)/);
  assert.match(stderr, /📚 Read \(10\)/);
});

test('a stray unhandled rejection no longer kills the running server', async () => {
  const { dir, url } = createRejectionHook();
  try {
    const { stdout, stderr } = await probeServer(['--import', url], 400);

    const line = stdout.split('\n').find((candidate) => candidate.trim().startsWith('{'));
    assert.ok(line, `server died before answering initialize; stderr: ${stderr.slice(0, 400)}`);
    const response = JSON.parse(line);
    assert.strictEqual(response.id, 1);
    assert.ok(response.result?.serverInfo, 'initialize result is missing');
    assert.match(stderr, /Unhandled promise rejection \(server stays alive\)/);
    assert.match(stderr, /injected-unhandled-rejection/);
    // The rejection must never leak onto the protocol stream.
    assert.doesNotMatch(stdout, /injected-unhandled-rejection/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
