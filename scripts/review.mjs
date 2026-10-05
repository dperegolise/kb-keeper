#!/usr/bin/env node
// The review list: everything kb flagged for a person, with enough context to decide, kept in
// `review.json` in kb's local folder until it is answered.
//
//   node review.mjs add --doc <path> --question "<q>" --would "<what kb would do>" --why-not "<why it did not>"
//                       [--kind flag|decide] [--evidence "<proof>"] [--backlog "<entry title>"] [--pr <url>] [--branch <name>]
//       prints the item's id. Exit 4: the person already answered this doc and it has not changed
//       since, so do not flag it again. An open item for the same doc and kind is updated, not duplicated.
//   node review.mjs list [--open] [--json]
//   node review.mjs show <id>
//   node review.mjs answer <id> --answer "<the person's decision>" [--outcome "<what was done>"]
//   node review.mjs link-pr --branch <name> --pr <url>   attach a sweep's pull request to its items

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterWrite, append, kbDir } from './log.mjs';

export const reviewPath = (cwd = process.cwd()) => path.join(kbDir(cwd), 'review.json');

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The doc's content hash as it is on disk now, or '' when it is gone.
export function fingerprint(cwd, doc) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']) || cwd;
  return git(top, ['hash-object', '--', doc]);
}

export function load(cwd = process.cwd()) {
  try {
    return JSON.parse(readFileSync(reviewPath(cwd), 'utf8'));
  } catch {
    return [];
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Read, change and write the list under a short lock, so a sweep and a review session never lose
// each other's changes. A lock older than 30 seconds belongs to a process that died.
export function update(cwd, change) {
  const file = reviewPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30000) rmSync(lock, { force: true });
      } catch {}
      if (i > 200) throw new Error('review list is locked');
      sleep(25);
    }
  }
  try {
    const items = load(cwd);
    const result = change(items);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(items, null, 2) + '\n');
    renameSync(tmp, file);
    return result;
  } finally {
    rmSync(lock, { force: true });
  }
}

export function add(cwd, { doc, question, would = '', whyNot = '', kind = 'flag', evidence = '', backlog = '', pr = '', branch = '' }) {
  branch ||= git(cwd, ['branch', '--show-current']);
  const blob = fingerprint(cwd, doc);
  return update(cwd, (items) => {
    const same = items.filter((it) => it.doc === doc && it.kind === kind && (kind !== 'decide' || it.backlog === backlog));
    const answered = same.find((it) => it.status === 'answered' && it.docBlob && it.docBlob === blob);
    if (answered) return { skipped: true, item: answered };
    const open = same.find((it) => it.status === 'open');
    const now = new Date().toISOString();
    if (open) {
      Object.assign(open, { question, would, whyNot, evidence, docBlob: blob, updated: now });
      if (pr) open.pr = pr;
      return { updated: true, item: open };
    }
    const item = {
      id: 'r-' + randomBytes(3).toString('hex'),
      kind, doc, question, would, whyNot, evidence, backlog, pr, branch,
      docBlob: blob, created: now, status: 'open',
    };
    items.push(item);
    return { added: true, item };
  });
}

export function answer(cwd, id, text, outcome = '') {
  return update(cwd, (items) => {
    const it = items.find((x) => x.id === id);
    if (!it) return null;
    Object.assign(it, { status: 'answered', answer: text, outcome, answeredAt: new Date().toISOString(), docBlob: fingerprint(cwd, it.doc) });
    return it;
  });
}

export function linkPr(cwd, branch, pr) {
  return update(cwd, (items) => {
    let n = 0;
    for (const it of items) if (it.branch === branch && !it.pr) { it.pr = pr; n++; }
    return n;
  });
}

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else out[a.slice(2)] = argv[++i];
    } else out.positional.push(a);
  }
  return out;
}

const line = (it) => `${it.id}  ${it.status.padEnd(8)} ${it.kind.padEnd(6)} ${it.doc}${it.backlog ? ` (${it.backlog})` : ''}\n    ${it.question}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, id] = args.positional;
  const cwd = process.cwd();
  if (cmd === 'add') {
    if (!args.doc || typeof args.question !== 'string') {
      console.error('usage: review.mjs add --doc <path> --question "<q>" --would "<w>" --why-not "<n>" [--kind flag|decide]');
      process.exit(2);
    }
    const r = add(cwd, {
      doc: args.doc, question: args.question, would: str(args.would), whyNot: str(args['why-not']),
      kind: args.kind === 'decide' ? 'decide' : 'flag', evidence: str(args.evidence), backlog: str(args.backlog), pr: str(args.pr), branch: str(args.branch),
    });
    if (r.skipped) {
      console.log(`${r.item.id} already answered: ${r.item.answer}`);
      process.exit(4);
    }
    append({ skill: 'review', action: r.added ? 'flag' : 'reflag', target: args.doc, why: args.question, evidence: r.item.id });
    await afterWrite();
    return console.log(r.item.id);
  }
  if (cmd === 'list') {
    const items = load(cwd).filter((it) => !args.open || it.status === 'open');
    if (args.json) return console.log(JSON.stringify(items, null, 2));
    return console.log(items.length ? items.map(line).join('\n') : 'nothing to review');
  }
  if (cmd === 'show') {
    const it = load(cwd).find((x) => x.id === id);
    if (!it) { console.error(`no item ${id}`); process.exit(1); }
    return console.log(JSON.stringify(it, null, 2));
  }
  if (cmd === 'answer') {
    if (!id || typeof args.answer !== 'string') {
      console.error('usage: review.mjs answer <id> --answer "<decision>" [--outcome "<what was done>"]');
      process.exit(2);
    }
    const it = answer(cwd, id, args.answer, str(args.outcome));
    if (!it) { console.error(`no item ${id}`); process.exit(1); }
    append({ skill: 'review', action: 'answer', target: it.doc, why: args.answer, evidence: [it.id, str(args.outcome)].filter(Boolean).join(': ') });
    await afterWrite();
    return console.log(`${it.id} answered`);
  }
  if (cmd === 'link-pr') {
    const n = linkPr(cwd, str(args.branch), str(args.pr));
    await afterWrite();
    return console.log(`${n} item${n === 1 ? '' : 's'} linked`);
  }
  console.error('usage: review.mjs add | list [--open] [--json] | show <id> | answer <id> --answer "<d>" | link-pr --branch <b> --pr <url>');
  process.exit(2);
}

const str = (v) => (typeof v === 'string' ? v : '');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
