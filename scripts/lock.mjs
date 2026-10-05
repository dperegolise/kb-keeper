#!/usr/bin/env node
// One sweep at a time per clone. The lock is `sweep.lock` in kb's local folder, which every
// worktree shares, so it covers the main checkout and all worktrees.
//
//   node lock.mjs acquire [--branch <name>]   take the lock; prints a token (exit 0), or the holder (exit 3)
//   node lock.mjs release --token <token>     give it back; refuses another run's lock (exit 3)
//   node lock.mjs status                      print the holder, or "free"
//
// A lock is stale when its heartbeat (the file's mtime) is older than STALE_MINUTES. log.mjs
// refreshes the heartbeat whenever the branch that holds the lock writes a log entry, and sweeps
// log after every doc, so only a run that died leaves a stale lock. A stale lock can be taken over.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kbDir } from './log.mjs';

export const STALE_MINUTES = 60;

export const lockPath = (cwd = process.cwd()) => path.join(kbDir(cwd), 'sweep.lock');

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The holder, with `stale` and `ageMinutes`, or null when nobody holds the lock.
export function holder(cwd = process.cwd(), now = Date.now()) {
  const file = lockPath(cwd);
  let info;
  let mtime;
  try {
    info = JSON.parse(readFileSync(file, 'utf8'));
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const ageMinutes = Math.floor((now - mtime) / 60000);
  return { ...info, ageMinutes, stale: ageMinutes >= STALE_MINUTES };
}

export function acquire(cwd = process.cwd(), branch = currentBranch(cwd)) {
  const file = lockPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const info = { token: randomBytes(8).toString('hex'), branch, worktree: cwd, started: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
      return { ok: true, token: info.token };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const held = holder(cwd);
      if (held && !held.stale) return { ok: false, holder: held };
      // Stale or unreadable: take it over. Two runs racing here both remove it, and `wx` lets one win.
      rmSync(file, { force: true });
    }
  }
  return { ok: false, holder: holder(cwd) };
}

export function release(cwd = process.cwd(), token) {
  const held = holder(cwd);
  if (!held) return { ok: true };
  if (held.token !== token) return { ok: false, holder: held };
  rmSync(lockPath(cwd), { force: true });
  return { ok: true };
}

// Called by log.mjs on every entry: the branch holding the lock is still alive.
export function heartbeat(cwd = process.cwd(), branch = currentBranch(cwd)) {
  const held = holder(cwd);
  if (!held || held.branch !== branch) return false;
  const now = new Date();
  utimesSync(lockPath(cwd), now, now);
  return true;
}

function describe(h) {
  return `held by ${h.branch || '(detached)'} in ${h.worktree}, started ${h.started}, last heartbeat ${h.ageMinutes} min ago${h.stale ? ' (stale)' : ''}`;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (cmd === 'acquire') {
    const r = acquire(process.cwd(), opt('branch') ?? currentBranch(process.cwd()));
    if (r.ok) return console.log(r.token);
    console.error(`kb sweep lock is ${describe(r.holder)}`);
    process.exit(3);
  }
  if (cmd === 'release') {
    const r = release(process.cwd(), opt('token'));
    if (r.ok) return;
    console.error(`not releasing: the lock is ${describe(r.holder)}`);
    process.exit(3);
  }
  if (cmd === 'status') {
    const h = holder();
    return console.log(h ? describe(h) : 'free');
  }
  console.error('usage: lock.mjs acquire [--branch <name>] | release --token <token> | status');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
