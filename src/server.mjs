#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OneNoteSession } from './session.mjs';
import { getClientId } from './auth/device-code-flow.mjs';
import { registerAuthTools } from './tools/auth-tools.mjs';
import { registerReadTools } from './tools/read-tools.mjs';
import { registerWriteTools } from './tools/write-tools.mjs';
import { registerCreateTools } from './tools/create-tools.mjs';
import { registerDeleteTools } from './tools/delete-tools.mjs';
import { logger } from './utils/logger.mjs';
import { createRequire } from 'module';

// Report the real package version instead of a hardcoded string, so it never
// drifts from package.json after a release.
const { version: pkgVersion } = createRequire(import.meta.url)('../package.json');

// --- MCP Server Initialization ---
const server = new McpServer({
  name: 'onenote',
  version: pkgVersion,
  description: 'OneNote MCP Server - Read, Write, and Edit OneNote content.',
});

// --- Session Initialization ---
const session = new OneNoteSession();

// Record tools as they are actually registered. The old banner was a
// hand-written list that had drifted to 22 names while the server exposed 25,
// so derive it from the live catalog instead.
const toolCatalog = [];
const categories = [];
const registrar = {
  tool: (name, ...args) => {
    toolCatalog.push(name);
    return server.tool(name, ...args);
  },
};

/**
 * Registers one tool category and remembers which names belong to it.
 * @param {string} label - Human-readable category label.
 * @param {(server: object, session: object) => void} register - Category registration function.
 */
function registerCategory(label, register) {
  const first = toolCatalog.length;
  register(registrar, session);
  categories.push({ label, names: toolCatalog.slice(first) });
}

registerCategory('🔐 Auth', registerAuthTools);
registerCategory('📚 Read', registerReadTools);
registerCategory('✏️ Edit', registerWriteTools);
registerCategory('➕ Create', registerCreateTools);
registerCategory('🗑️ Delete', registerDeleteTools);

/**
 * Writes a fatal error to stderr only — stdout belongs to the MCP protocol —
 * and flushes before the process is terminated.
 * @param {string} message - Short description.
 * @param {unknown} error - The error or rejection reason.
 */
function reportFatal(message, error) {
  try {
    logger.fatal({ err: error }, message);
    logger.flush?.();
  } catch {
    process.stderr.write(`${message}: ${String(error)}\n`);
  }
}

// With no listener, Node >= 15 terminates the whole process on an unhandled
// rejection — taking a healthy stdio connection down with it. Log it and keep
// serving; genuine startup failures are reported by main().catch() below.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection (server stays alive)');
});

// An uncaught exception leaves the process in an undefined state, so exit
// cleanly with a diagnostic instead of a silent crash.
process.on('uncaughtException', (error) => {
  reportFatal('Uncaught exception', error);
  process.exit(1);
});

/**
 * Main function to initialize and start the MCP server.
 */
async function main() {
  // These used to sit outside the try block: a rejected promise here produced
  // an unhandled rejection and killed the process before it ever answered
  // initialize. main().catch() now covers the whole startup path.
  await session.loadExistingToken(); // Attempt to load token at startup
  await session.initializeGraphClient(); // Initialize client if token was loaded

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const clientId = getClientId();
  logger.info('🚀✨ OneNote Ultimate MCP Server is now LIVE! ✨🚀');
  logger.info(
    `   Client ID: ${clientId.substring(0, 8)}... (Using ${process.env.AZURE_CLIENT_ID ? 'environment variable' : 'default'})`
  );
  logger.info('   Ready to manage your OneNote like never before!');
  logger.info(`--- Available Tools (${toolCatalog.length}) ---`);
  for (const { label, names } of categories) {
    logger.info(`   ${label} (${names.length}): ${names.join(', ')}`);
  }
  logger.info('---------------------------------');

  process.on('SIGINT', () => {
    logger.info('\n🔌 OneNote MCP Server shutting down gracefully...');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    logger.info('\n🔌 OneNote MCP Server terminated...');
    process.exit(0);
  });
}

main().catch((error) => {
  reportFatal('💀 Critical error starting server', error);
  process.exit(1);
});
