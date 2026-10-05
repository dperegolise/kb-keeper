import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { add, answer, linkPr, load } from '../scripts/review.mjs';

const CLI = fileURLToPath(new URL('../scripts/review.mjs', import.meta.url));
let root;
let worktree;

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const cli = (cwd, ...args) => spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
const flag = { doc: 'docs/HANDOFF-X.md', question: 'Is this still wanted?', would: 'delete it', whyNot: 'no proof it is done' };

before(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kb-review-')));
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(root, 'HANDOFF.md'), 'x');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  worktree = path.join(root, '..', path.basename(root) + '-wt');
  git(root, 'worktree', 'add', '-q', '-b', 'kb/sweep-r', worktree);
  writeFileSync(path.join(worktree, 'docs-x.md'), 'v1');
});

test('a flag from a worktree lands on the shared list, and flagging again updates it', () => {
  const first = add(worktree, { ...flag, doc: 'docs-x.md' });
  assert.ok(first.added);
  assert.equal(first.item.branch, 'kb/sweep-r');
  const again = add(root, { ...flag, doc: 'docs-x.md', question: 'Still wanted, now that X shipped?' });
  assert.ok(again.updated);
  const items = load(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].question, 'Still wanted, now that X shipped?');
});

test('an answered doc is not flagged again until it changes', () => {
  const [item] = load(root);
  answer(worktree, item.id, 'keep it', 'no change');
  const repeat = add(worktree, { ...flag, doc: 'docs-x.md' });
  assert.equal(repeat.skipped, true);
  assert.equal(repeat.item.answer, 'keep it');
  writeFileSync(path.join(worktree, 'docs-x.md'), 'v2: someone edited it');
  const changed = add(worktree, { ...flag, doc: 'docs-x.md' });
  assert.ok(changed.added);
  assert.equal(load(root).filter((i) => i.status === 'open').length, 1);
});

test('decisions are tracked per backlog entry', () => {
  add(root, { doc: 'docs/BACKLOG.md', kind: 'decide', backlog: 'Decide: A', question: 'A?' });
  add(root, { doc: 'docs/BACKLOG.md', kind: 'decide', backlog: 'Decide: B', question: 'B?' });
  assert.equal(load(root).filter((i) => i.kind === 'decide').length, 2);
});

test('link-pr attaches the pull request to that branch only', () => {
  // The answered item and the one raised again after its doc changed both came from kb/sweep-r.
  assert.equal(linkPr(root, 'kb/sweep-r', 'https://example.test/pr/1'), 2);
  assert.ok(load(root).filter((i) => i.branch === 'main').every((i) => !i.pr));
});

test('the CLI exits 4 for an answered, unchanged doc, logs flags and answers, and feeds the page', () => {
  writeFileSync(path.join(root, 'n.md'), 'note');
  const id = cli(root, 'add', '--doc', 'n.md', '--question', 'Q?', '--would', 'w', '--why-not', 'n').stdout.trim();
  assert.match(id, /^r-[0-9a-f]{6}$/);
  assert.equal(cli(root, 'answer', id, '--answer', 'drop it').status, 0);
  assert.equal(cli(root, 'add', '--doc', 'n.md', '--question', 'Q?').status, 4);
  const log = readFileSync(path.join(root, '.git', 'kb', 'log'), 'utf8');
  assert.match(log, /\| review \| flag \| n\.md \|/);
  assert.match(log, /\| review \| answer \| n\.md \| .* \| drop it \|/);
  const page = readFileSync(path.join(root, '.git', 'kb', 'log.html'), 'utf8');
  const data = JSON.parse(page.match(/<script id="kb-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.ok(data.review.some((r) => r.id === id && r.status === 'answered'));
  assert.ok(!git(root, 'status', '--porcelain').includes('kb'));
});
