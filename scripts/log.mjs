#!/usr/bin/env node
// Appends one line to the kb activity log: what a kb skill did, to what, and why.
//
//   node log.mjs <skill> <action> <target> --why "<reason>" [--evidence "<proof>"] [--where <source>]
//   node log.mjs --init         create the log if it is missing and print its path
//   node log.mjs --path         print the log's path
//   node log.mjs --dir          print kb's local folder (log, log.html, sources.json, tmp/)
//
// kb's local state lives in `kb/` inside the repository's common git dir: git never tracks it, and
// every worktree of the repository shares it. The log is `kb/log` there, and each write rebuilds
// the activity page `kb/log.html` (view.mjs).
// Each line: time | skill | action | target | where | branch | why | evidence

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = '# kb activity log: time | skill | action | target | where | branch | why | evidence\n';

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// `kb/` in the common git dir, so that every worktree of a repository shares it.
export function kbDir(cwd = process.cwd()) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) throw new Error('not inside a git repository');
  return path.join(common, 'kb');
}

export const logPath = (cwd = process.cwd()) => path.join(kbDir(cwd), 'log');

function ensureLog(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, HEADER);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

export function formatEntry({ skill, action, target, where = 'repo', branch = '', why, evidence = '' }, now = new Date()) {
  const time = now.toISOString().replace(/\.\d+Z$/, 'Z');
  return [time, skill, action, target, where, branch, why, evidence].map(clean).join(' | ').trimEnd() + '\n';
}

export function append(entry, cwd = process.cwd()) {
  const file = logPath(cwd);
  ensureLog(file);
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

// Rebuild the activity page after a write. A page that fails to build never fails the log entry.
async function refreshPage() {
  try {
    const { render } = await import('./view.mjs');
    render();
  } catch {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.path) return console.log(logPath());
  if (args.dir) return console.log(kbDir());
  if (args.init) {
    const file = logPath();
    ensureLog(file);
    await refreshPage();
    return console.log(file);
  }
  const [skill, action, target] = args.positional;
  if (!skill || !action || !target || typeof args.why !== 'string') {
    console.error('usage: log.mjs <skill> <action> <target> --why "<reason>" [--evidence "<proof>"] [--where <source>]');
    process.exit(2);
  }
  append({ skill, action, target, why: args.why, evidence: args.evidence, where: args.where });
  await refreshPage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
