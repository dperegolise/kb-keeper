import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { globToRegExp, inventory, pathTokens, summarize } from '../scripts/inventory.mjs';

const DAY = 86400;
let root;

function git(args, daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * DAY * 1000).toISOString();
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

function write(file, content) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

function commit(daysAgo, message = 'c') {
  git(['add', '-A']);
  git(['commit', '-q', '-m', message], daysAgo);
  return git(['rev-parse', '--short', 'HEAD']);
}

const doc = (inv, p) => inv.docs.find((d) => d.path === p);

before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'kb-inventory-'));
  git(['init', '-q', '-b', 'main']);

  write('kb.json', JSON.stringify({
    wiki: 'docs/wiki',
    backlog: 'docs/BACKLOG.md',
    rules: [
      { match: 'docs/adr/**', class: 'record' },
      { match: 'docs/runs/**', class: 'ephemeral', keepLatest: 1, exit: 'A later run exists.' },
      { match: 'docs/HANDOFF-*.md', class: 'ephemeral', maxAgeDays: 14, exit: 'The work is merged.' },
      { match: 'docs/research/**', class: 'raw' },
    ],
    ignore: ['docs/generated/**'],
  }));
  write('src/dialer/pacer.ts', 'export const pace = 1;\n');
  write('src/dialer/ring.ts', '// see docs/HANDOFF-DIALER.md for the ring fix\nexport const ring = 1;\n');
  write('docs/HANDOFF-DIALER.md', [
    '# Handoff',
    'Pacing lives in `src/dialer/pacer.ts` and the old arm in `src/dialer/session-arm.ts`.',
    'Decision: [ADR 1](adr/0001-pacer.md). See https://example.com/src/thing.ts and docs/<name>.md.',
    '',
  ].join('\n'));
  write('docs/adr/0001-pacer.md', '# ADR 1\nSupersedes the plan in ../HANDOFF-DIALER.md\n');
  write('docs/runs/2026-01-01-run.md', 'run one\n');
  write('docs/runs/2026-01-02-run.md', 'run two\n');
  write('docs/research/vendors.md', 'raw notes\n');
  write('docs/NOTES.md', 'loose\n');
  write('node_modules/pkg/README.md', 'ignored\n');
  write('docs/generated/api.md', 'ignored by config\n');
  write('docs/spec.pdf', '%PDF-1.4\0binary');
  commit(30, 'old');

  write('docs/wiki/index.md', '- [Dialer](dialer.md): pacing\n');
  write('docs/wiki/dialer.md', '# Dialer\nThe pacer is `src/dialer/pacer.ts`; ringing is `ring.ts`.\n');
  const sha = commit(10, 'wiki');
  write('docs/wiki/dialer.md', `# Dialer\nThe pacer is \`src/dialer/pacer.ts\`; ringing is \`ring.ts\`.\n\n<!-- verified: ${sha} -->\n`);
  commit(10, 'stamp');
  git(['branch', 'base']);

  write('src/dialer/pacer.ts', 'export const pace = 2;\n');
  commit(2, 'code change');
  write('docs/DRAFT.md', 'untracked work in progress\n');
});

after(() => rmSync(root, { recursive: true, force: true }));

test('globToRegExp handles **, * and literals', () => {
  assert.ok(globToRegExp('**/*.md').test('README.md'));
  assert.ok(globToRegExp('**/*.md').test('a/b/c.md'));
  assert.ok(globToRegExp('docs/wiki/**').test('docs/wiki/a/b.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/a/b.md'));
  assert.ok(globToRegExp('docs/HANDOFF-*.md').test('docs/HANDOFF-X.md'));
  assert.ok(!globToRegExp('docs/a.md').test('docs/aXmd'));
});

test('pathTokens peels markdown links and skips URLs', () => {
  const tokens = pathTokens('See [x](../adr/0001.md), (docs/a.md) and https://h.com/p/q.ts or app/(desk)/[id]/page.tsx:12.');
  assert.deepEqual([...tokens].sort(), ['../adr/0001.md', 'app/(desk)/[id]/page.tsx', 'docs/a.md']);
});

test('classifies by first matching rule, wiki is living by default', () => {
  const inv = inventory({ root });
  assert.equal(doc(inv, 'docs/wiki/dialer.md').class, 'living');
  assert.equal(doc(inv, 'docs/adr/0001-pacer.md').class, 'record');
  assert.equal(doc(inv, 'docs/HANDOFF-DIALER.md').class, 'ephemeral');
  assert.equal(doc(inv, 'docs/research/vendors.md').class, 'raw');
  assert.equal(doc(inv, 'docs/NOTES.md').class, 'unclassified');
  assert.equal(doc(inv, 'docs/HANDOFF-DIALER.md').exit, 'The work is merged.');
  assert.equal(inv.backlog, 'docs/BACKLOG.md');
});

test('lists only tracked docs and skips ignored ones', () => {
  const inv = inventory({ root });
  assert.equal(doc(inv, 'docs/DRAFT.md'), undefined);
  assert.equal(doc(inv, 'node_modules/pkg/README.md'), undefined);
  assert.equal(doc(inv, 'docs/generated/api.md'), undefined);
  assert.equal(doc(inv, 'docs/spec.pdf').lines, null);
  assert.equal(doc(inv, 'docs/runs/2026-01-01-run.md').lines, 1);
});

test('finds inbound references from code and from other docs', () => {
  const handoff = doc(inventory({ root }), 'docs/HANDOFF-DIALER.md');
  assert.deepEqual(handoff.inbound, ['docs/adr/0001-pacer.md', 'src/dialer/ring.ts']);
});

test('reports dead references only for paths that meant this repo', () => {
  const handoff = doc(inventory({ root }), 'docs/HANDOFF-DIALER.md');
  assert.deepEqual(handoff.deadRefs, ['src/dialer/session-arm.ts']);
});

test('marks ephemeral docs expired by age and by keepLatest', () => {
  const inv = inventory({ root });
  assert.equal(doc(inv, 'docs/HANDOFF-DIALER.md').expired, true);
  assert.equal(doc(inv, 'docs/runs/2026-01-01-run.md').expired, true);
  assert.equal(doc(inv, 'docs/runs/2026-01-02-run.md').expired, false);
});

test('living docs report cited files changed since they were verified', () => {
  const page = doc(inventory({ root }), 'docs/wiki/dialer.md');
  assert.match(page.verified, /^[0-9a-f]{7,}$/);
  assert.deepEqual(page.changedRefs, ['src/dialer/pacer.ts']);
});

test('--changed-since keeps only living docs citing files in the diff', () => {
  const inv = inventory({ root, changedSince: 'base' });
  assert.deepEqual(inv.docs.map((d) => d.path), ['docs/wiki/dialer.md']);
  assert.deepEqual(inv.docs[0].changedRefs, ['src/dialer/pacer.ts']);
});

test('filters by class and path, and totals follow the filter', () => {
  const inv = inventory({ root, classes: ['ephemeral'], paths: ['docs/runs'] });
  assert.deepEqual(inv.docs.map((d) => d.path), ['docs/runs/2026-01-01-run.md', 'docs/runs/2026-01-02-run.md']);
  assert.deepEqual(inv.totals, { docs: 2, lines: 2, byClass: { ephemeral: { docs: 2, lines: 2 } } });
});

test('summary names classes, folders and expiry counts', () => {
  const text = summarize(inventory({ root }));
  assert.match(text, /ephemeral\s+3 docs/);
  assert.match(text, /docs\/runs\/\s+2 docs\s+2 lines\s+ephemeral\s+1 expired/);
});

test('works without a config: everything outside the wiki is unclassified', () => {
  assert.equal(inventory({ root }).config, 'kb.json');
  rmSync(path.join(root, 'kb.json'));
  try {
    const bare = inventory({ root });
    assert.equal(bare.config, null);
    assert.equal(doc(bare, 'docs/adr/0001-pacer.md').class, 'unclassified');
    assert.equal(doc(bare, 'docs/wiki/dialer.md').class, 'living');
  } finally {
    git(['checkout', '-q', '--', 'kb.json']);
  }
});

test('a page verified after the change is not listed again', () => {
  const sha = git(['rev-parse', '--short', 'HEAD']);
  write('docs/wiki/dialer.md', `# Dialer\nThe pacer is \`src/dialer/pacer.ts\`.\n\n<!-- verified: ${sha} -->\n`);
  commit(0, 'verify');
  assert.deepEqual(inventory({ root, changedSince: 'base' }).docs, []);
  assert.deepEqual(doc(inventory({ root }), 'docs/wiki/dialer.md').changedRefs, []);
});

test('files a verifier edits in the same commit as the stamp are not changes', () => {
  const sha = git(['rev-parse', '--short', 'HEAD']);
  write('src/dialer/pacer.ts', '// see docs/wiki/dialer.md\nexport const pace = 2;\n');
  write('docs/wiki/dialer.md', `# Dialer\nThe pacer is \`src/dialer/pacer.ts\`. Paced.\n\n<!-- verified: ${sha} -->\n`);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'distill'], -1);
  assert.deepEqual(doc(inventory({ root }), 'docs/wiki/dialer.md').changedRefs, []);
});

test('a stamp naming a commit that no longer exists counts from the commit that wrote it', () => {
  write('docs/wiki/dialer.md', '# Dialer\nThe pacer is `src/dialer/pacer.ts`. Squashed.\n\n<!-- verified: deadbee -->\n');
  commit(-2, 'squash merge');
  assert.deepEqual(doc(inventory({ root }), 'docs/wiki/dialer.md').changedRefs, []);
  write('src/dialer/pacer.ts', 'export const pace = 3;\n');
  commit(-3, 'pacer change');
  assert.deepEqual(doc(inventory({ root }), 'docs/wiki/dialer.md').changedRefs, ['src/dialer/pacer.ts']);
});
