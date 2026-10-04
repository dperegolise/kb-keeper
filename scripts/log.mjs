#!/usr/bin/env node
// Appends one line to the kb activity log: what a kb skill did, to what, and why.
//
//   node log.mjs <skill> <action> <target> --why "<reason>" [--evidence "<proof>"] [--where <source>]
//   node log.mjs --init         create the log if it is missing and print its path
//   node log.mjs --path         print the log's path
//
// The log is `.kb.log` at the root of the main checkout, so every worktree of a repository writes
// to the same file. Setup adds it to .gitignore: it is a local record, not project history.
// Each line: time | skill | action | target | where | branch | why | evidence

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOG_NAME = '.kb.log';
const HEADER = '# kb activity log: time | skill | action | target | where | branch | why | evidence\n';

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The main checkout's root, found through the common git dir so that worktrees share one log.
export function logPath(cwd = process.cwd()) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) throw new Error('not inside a git repository');
  const root = path.basename(common) === '.git' ? path.dirname(common) : common;
  return path.join(root, LOG_NAME);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

export function formatEntry({ skill, action, target, where = 'repo', branch = '', why, evidence = '' }, now = new Date()) {
  const time = now.toISOString().replace(/\.\d+Z$/, 'Z');
  return [time, skill, action, target, where, branch, why, evidence].map(clean).join(' | ').trimEnd() + '\n';
}

export function append(entry, cwd = process.cwd()) {
  const file = logPath(cwd);
  if (!existsSync(file)) writeFileSync(file, HEADER);
  const branch = entry.branch ?? git(cwd, ['branch', '--show-current']);
  appendFileSync(file, formatEntry({ ...entry, branch }));
  return file;
}

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else out[key] = argv[++i];
    } else out.positional.push(a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.path) return console.log(logPath());
  if (args.init) {
    const file = logPath();
    if (!existsSync(file)) writeFileSync(file, HEADER);
    return console.log(file);
  }
  const [skill, action, target] = args.positional;
  if (!skill || !action || !target || typeof args.why !== 'string') {
    console.error('usage: log.mjs <skill> <action> <target> --why "<reason>" [--evidence "<proof>"] [--where <source>]');
    process.exit(2);
  }
  append({ skill, action, target, why: args.why, evidence: args.evidence, where: args.where });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
