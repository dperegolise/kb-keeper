import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STALE_MINUTES, acquire, heartbeat, holder, lockPath, release } from '../scripts/lock.mjs';

const LOG = fileURLToPath(new URL('../scripts/log.mjs', import.meta.url));
let root;
let worktree;

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const ageLock = (cwd, minutes) => {
  const t = new Date(Date.now() - minutes * 60000);
  utimesSync(lockPath(cwd), t, t);
};

before(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kb-lock-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  worktree = path.join(root, '..', path.basename(root) + '-wt');
  git(root, 'worktree', 'add', '-q', '-b', 'kb/sweep-a', worktree);
});

test('a second sweep in another worktree is refused while the first holds the lock', () => {
  const first = acquire(worktree);
  assert.ok(first.ok);
  const second = acquire(root);
  assert.equal(second.ok, false);
  assert.equal(second.holder.branch, 'kb/sweep-a');
  assert.equal(second.holder.stale, false);
  assert.ok(release(worktree, first.token).ok);
  assert.equal(holder(root), null);
});

test('release refuses a token that does not hold the lock', () => {
  const first = acquire(root);
  assert.equal(release(root, 'not-the-token').ok, false);
  assert.ok(holder(root));
  assert.ok(release(root, first.token).ok);
});

test('a lock without a heartbeat for an hour is stale and can be taken over', () => {
  const dead = acquire(worktree);
  ageLock(worktree, STALE_MINUTES + 5);
  assert.equal(holder(root).stale, true);
  const next = acquire(root);
  assert.ok(next.ok);
  assert.notEqual(next.token, dead.token);
  assert.equal(release(worktree, dead.token).ok, false);
  release(root, next.token);
});

test('log entries from the holding branch keep the lock alive, others do not', () => {
  const lock = acquire(worktree);
  ageLock(worktree, STALE_MINUTES - 5);
  spawnSync('node', [LOG, 'sweep', 'flag', 'docs/x.md', '--why', 'from main'], { cwd: root });
  assert.ok(holder(root).ageMinutes >= STALE_MINUTES - 6);
  spawnSync('node', [LOG, 'sweep', 'flag', 'docs/x.md', '--why', 'from the sweep'], { cwd: worktree });
  assert.equal(holder(root).ageMinutes, 0);
  assert.equal(heartbeat(root), false);
  release(worktree, lock.token);
});

test('the CLI exits 3 and names the holder when the lock is taken', () => {
  const lock = acquire(worktree);
  const r = spawnSync('node', [fileURLToPath(new URL('../scripts/lock.mjs', import.meta.url)), 'acquire'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /held by kb\/sweep-a/);
  release(worktree, lock.token);
});
