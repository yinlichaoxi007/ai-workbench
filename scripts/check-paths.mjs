#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_FILES = [
  'README.md',
  'AGENTS.md',
  'adapters/README.md',
  'launchers/README.md',
  'docs/adapters.md',
  'docs/maintenance.md',
  'docs/migration.md',
  'docs/onboarding.md'
];

const PATH_PREFIXES = [
  'content/',
  'machines/',
  'adapters/',
  'src/',
  'launchers/',
  'scripts/',
  'tests/',
  'docs/'
];

const IGNORED_PREFIXES = ['dist/', 'state/', 'node_modules/'];

const missing = [];
let checked = 0;
let scanned = 0;

for (const relativeFile of SCAN_FILES) {
  const filePath = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(filePath)) {
    missing.push(`${relativeFile}（文档文件不存在）`);
    continue;
  }
  scanned += 1;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const candidate = normalizeCandidate(match[1]);
      if (!candidate) continue;
      checked += 1;

      if (!fs.existsSync(path.join(repoRoot, candidate.replace(/\/$/, '')))) {
        missing.push(`${relativeFile}:${index + 1} -> ${candidate}`);
      }
    }
  });
}

if (missing.length > 0) {
  console.error(`路径检查未通过：扫描 ${scanned} 个文件，检查 ${checked} 个路径，缺失 ${missing.length} 个`);
  for (const item of missing) console.error(`  - ${item}`);
  process.exitCode = 1;
} else {
  console.log(`路径检查通过：扫描 ${scanned} 个文件，检查 ${checked} 个路径`);
}

function normalizeCandidate(raw) {
  let candidate = raw.trim().replace(/[，。；,;：:]+$/, '');
  candidate = candidate.replace(/\\/g, '/');

  if (!candidate.includes('/')) return null;
  if (candidate.startsWith('~') || /^[A-Za-z]:\//.test(candidate)) return null;
  if (/[\s<>*{}$()`]/.test(candidate)) return null;
  if (IGNORED_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return null;
  if (!PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return null;

  return candidate;
}
