import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardFile = 'test/test_privacy.mjs';

// Split the known account tokens so this guard never matches its own source.
const knownAccount = ['A', '067'].join('') + '|' + ['kain', '3180'].join('');
const mailDomains = '(?:outlook|hotmail|live|msn|gmail|qq|163|126|foxmail|icloud|yahoo|sina|sohu)';

const rules = [
  {
    label: 'hard-coded Windows user directory',
    re: new RegExp(
      '[A-Za-z]:[\\\\/]+Users[\\\\/]+(?!<USERNAME>|%USERNAME%|\\$\\{)[A-Za-z0-9._-]+',
      'gi'
    ),
  },
  {
    label: 'personal mailbox',
    re: new RegExp('@' + mailDomains + '\\.(?:com|cn|net|com\\.cn)', 'gi'),
  },
  {
    label: 'OneDrive account deep link',
    re: /onedrive\.live\.com\/redir|[?&]cid=[0-9a-f]{16,}|resid=/gi,
  },
  {
    label: 'GitHub credential',
    re: /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g,
  },
  { label: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { label: 'known local account', re: new RegExp(knownAccount, 'gi') },
];

const collectTracked = () => {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
};

// ZIP installs have no .git, so fall back to a directory walk. Only project
// source/doc files are considered: generated logs can legitimately contain the
// machine's own absolute paths and must not turn into false positives.
const sourceExtensions = [
  '.mjs',
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.txt',
  '.html',
  '.sh',
  '.py',
];
const sourceNames = ['LICENSE', '.gitignore', '.gitattributes', '.prettierignore'];

const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (
      entry.isFile() &&
      (sourceExtensions.includes(path.extname(entry.name).toLowerCase()) ||
        sourceNames.includes(entry.name))
    ) {
      acc.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  }
  return acc;
};

test('repository files contain no personal identifiers or credentials', () => {
  const tracked = collectTracked();
  const files = tracked.length ? tracked : walk(repoRoot);
  const findings = [];

  for (const rel of files) {
    // This file holds the detection patterns themselves, not project content.
    if (rel === guardFile) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binary
    text.split(/\r?\n/).forEach((line, index) => {
      for (const rule of rules) {
        rule.re.lastIndex = 0;
        const match = rule.re.exec(line);
        if (match) findings.push(`${rel}:${index + 1} [${rule.label}] ${match[0]}`);
      }
    });
  }

  assert.deepEqual(findings, [], 'personal data found in repository files');
});
