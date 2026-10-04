import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatEntry, logPath } from '../scripts/log.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/log.mjs', import.meta.url));
let root;
let worktree;

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const run = (cwd, ...args) => execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' }).trim();

before(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kb-log-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  worktree = path.join(root, '..', path.basename(root) + '-wt');
  git(root, 'worktree', 'add', '-q', '-b', 'kb/sweep-x', worktree);
});

test('the log lives at the main checkout root, from the repo and from a worktree', () => {
  assert.equal(logPath(root), path.join(root, '.kb.log'));
  assert.equal(logPath(worktree), path.join(root, '.kb.log'));
});

test('entries from a worktree land in the shared log with their branch', () => {
  assert.equal(run(root, '--init'), path.join(root, '.kb.log'));
  run(worktree, 'sweep', 'delete', 'docs/a.md', '--why', 'expired (keepLatest 10)', '--evidence', 'abc123');
  run(root, 'sweep', 'update', 'task 42', '--where', 'Todoist', '--why', 'built in | def456');
  const lines = readFileSync(path.join(root, '.kb.log'), 'utf8').trim().split('\n');
  assert.match(lines[0], /^# kb activity log/);
  assert.match(lines[1], / \| sweep \| delete \| docs\/a\.md \| repo \| kb\/sweep-x \| expired \(keepLatest 10\) \| abc123$/);
  assert.match(lines[2], / \| sweep \| update \| task 42 \| Todoist \| main \| built in \/ def456 \|$/);
});

test('formatEntry keeps one line per entry', () => {
  const line = formatEntry({ skill: 'distill', action: 'distill', target: 'x.md', why: 'two\nlines' }, new Date(0));
  assert.equal(line, '1970-01-01T00:00:00Z | distill | distill | x.md | repo |  | two lines |\n');
});

test('missing --why is refused', () => {
  assert.throws(() => run(root, 'sweep', 'delete', 'docs/a.md'));
});
