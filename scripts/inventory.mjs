#!/usr/bin/env node
// Deterministic doc inventory: the worklist the kb skills triage.
// No LLM, no dependencies. Reads git and the working tree, writes JSON to stdout.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  wiki: 'docs/wiki',
  docs: ['**/*.md', '**/*.mdx', '**/*.docx', '**/*.pdf'],
  ignore: ['**/node_modules/**', '.claude/**', '.github/**', '**/CHANGELOG*', '**/LICENSE*'],
  rules: [],
};
const TEXT_DOC = /\.mdx?$/i;
const MAX_SCAN_BYTES = 1024 * 1024;
// The stamp verify leaves on a page: <!-- verified: <commit> -->. A comment, so it renders nowhere.
const VERIFIED = /<!--\s*verified:\s*([0-9a-f]{7,40})\s*-->/;

// A path with at least one slash and an extension, or a bare *.md name.
const TOKEN = /[\w@.\-/[\]()+~]*\/[\w@.\-/[\]()+~]*\.\w{1,8}\b|[\w@.-]+\.mdx?\b/g;

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function matcher(globs) {
  const res = [globs].flat().map(globToRegExp);
  return (p) => res.some((re) => re.test(p));
}

function git(root, args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(root, args) {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

// Newest commit time (unix seconds) for every path that ever appeared in history.
function lastCommitTimes(root) {
  const times = new Map();
  let t = 0;
  for (const line of git(root, ['log', '--format=%x01%ct', '--name-only']).split('\n')) {
    if (line.startsWith('\x01')) t = Number(line.slice(1));
    else if (line && !times.has(line)) times.set(line, t);
  }
  return times;
}

function readText(root, rel) {
  try {
    const abs = path.join(root, rel);
    if (statSync(abs).size > MAX_SCAN_BYTES) return null;
    const text = readFileSync(abs, 'utf8');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

// Path-like tokens in a text, with markdown link syntax and stray brackets peeled off.
export function pathTokens(text) {
  const out = new Set();
  for (const m of text.matchAll(TOKEN)) {
    let t = m[0];
    if (text[m.index - 1] === ':' || t.startsWith('//')) continue; // URL
    const link = t.lastIndexOf('](');
    if (link !== -1) t = t.slice(link + 2);
    while (/^[([]/.test(t) && count(t, /[([]/g) > count(t, /[)\]]/g)) t = t.slice(1);
    if (t.startsWith('//')) continue;
    if (t) out.add(t);
  }
  return out;
}

const count = (s, re) => (s.match(re) || []).length;

function loadConfig(root, configPath) {
  const file = configPath ? path.resolve(configPath) : path.join(root, 'kb.json');
  if (!existsSync(file)) {
    if (configPath) throw new Error(`config not found: ${file}`);
    return { ...DEFAULTS, file: null };
  }
  const user = JSON.parse(readFileSync(file, 'utf8'));
  return { ...DEFAULTS, ...user, ignore: [...DEFAULTS.ignore, ...(user.ignore ?? [])], file };
}

export function inventory({ root = process.cwd(), config: configPath, classes, paths, changedSince } = {}) {
  root = tryGit(root, ['rev-parse', '--show-toplevel']);
  if (!root) throw new Error('not inside a git repository');
  const config = loadConfig(root, configPath);
  const wiki = config.wiki.replace(/\/+$/, '');
  const rules = [{ match: `${wiki}/**`, class: 'living' }, ...config.rules].map((r) => ({ ...r, test: matcher(r.match) }));

  // Tracked files only: an untracked doc is work in progress, and deleting it would be unrecoverable.
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter((f) => f && existsSync(path.join(root, f)));
  const trackedSet = new Set(tracked);
  const topLevel = new Set(tracked.map((f) => f.split('/')[0]));
  const extensions = new Set(tracked.map((f) => path.extname(f).toLowerCase()).filter(Boolean));
  const byBasename = new Map();
  for (const f of tracked) {
    const b = path.posix.basename(f);
    if (!byBasename.has(b)) byBasename.set(b, []);
    byBasename.get(b).push(f);
  }

  const isDoc = matcher(config.docs);
  const isIgnored = matcher(config.ignore);
  const docPaths = tracked.filter((f) => isDoc(f) && !isIgnored(f));
  const docSet = new Set(docPaths);

  function resolve(token, from) {
    const bare = token.replace(/^\/+/, '');
    if (!token.startsWith('/')) {
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), token));
      if (trackedSet.has(rel)) return rel;
    }
    const norm = path.posix.normalize(bare);
    if (trackedSet.has(norm)) return norm;
    if (norm.startsWith('..')) return null;
    const hits = (byBasename.get(path.posix.basename(norm)) || []).filter((f) => f.endsWith(`/${norm}`));
    return hits.length === 1 ? hits[0] : null;
  }

  // Only call a reference dead when it plainly meant a path in this repo.
  function looksDead(token, from) {
    if (!token.includes('/') || !extensions.has(path.extname(token).toLowerCase())) return false;
    const explicit = /^\.\.?\//.test(token);
    const norm = path.posix.normalize(token.replace(/^\/+/, ''));
    if (!explicit && !topLevel.has(norm.split('/')[0])) return false;
    const onDisk = explicit ? path.posix.join(path.posix.dirname(from), token) : norm;
    return !existsSync(path.join(root, onDisk));
  }

  const inbound = new Map(docPaths.map((d) => [d, new Set()]));
  const refs = new Map(docPaths.map((d) => [d, new Set()]));
  const dead = new Map(docPaths.map((d) => [d, new Set()]));
  const lines = new Map();
  const verified = new Map();

  for (const file of tracked) {
    const fileIsDoc = docSet.has(file);
    if (fileIsDoc && !TEXT_DOC.test(file)) continue;
    const text = readText(root, file);
    if (text === null) continue;
    if (fileIsDoc) {
      lines.set(file, text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
      const v = VERIFIED.exec(text);
      if (v) verified.set(file, v[1]);
    }
    for (const token of pathTokens(text)) {
      const target = resolve(token, file);
      if (target === file) continue;
      if (target && docSet.has(target)) inbound.get(target).add(file);
      if (!fileIsDoc) continue;
      if (target) refs.get(file).add(target);
      else if (looksDead(token, file)) dead.get(file).add(token);
    }
  }

  const times = lastCommitTimes(root);
  const now = Date.now() / 1000;
  const diff = changedSince
    ? new Set(git(root, ['diff', '--name-only', `${changedSince}...HEAD`]).split('\n').filter(Boolean))
    : null;

  let docs = docPaths.map((p) => {
    const ruleIndex = rules.findIndex((r) => r.test(p));
    const rule = rules[ruleIndex];
    const t = times.get(p) ?? null;
    const doc = {
      path: p,
      class: rule?.class ?? 'unclassified',
      lines: lines.get(p) ?? null,
      lastChanged: t ? new Date(t * 1000).toISOString().slice(0, 10) : null,
      ageDays: t ? Math.floor((now - t) / 86400) : null,
      inbound: [...inbound.get(p)].sort(),
      deadRefs: [...dead.get(p)].sort(),
    };
    if (rule?.exit) doc.exit = rule.exit;
    if (rule?.class === 'ephemeral') {
      doc.expired = rule.maxAgeDays != null && doc.ageDays != null && doc.ageDays > rule.maxAgeDays;
    }
    if (rule?.class === 'living') {
      const sha = verified.get(p);
      const verifiedAt = sha ? Number(tryGit(root, ['show', '-s', '--format=%ct', sha])) || null : null;
      const since = verifiedAt ?? t ?? 0;
      const code = [...refs.get(p)].filter((r) => !docSet.has(r));
      doc.verified = sha ?? null;
      doc.changedRefs = code.filter((r) => (times.get(r) ?? 0) > since && (!diff || diff.has(r))).sort();
    }
    return { doc, ruleIndex };
  });

  // keepLatest: within one rule, everything past the newest N by path (date-prefixed names sort by date).
  rules.forEach((rule, i) => {
    if (rule.class !== 'ephemeral' || rule.keepLatest == null) return;
    docs
      .filter((d) => d.ruleIndex === i)
      .sort((a, b) => (a.doc.path < b.doc.path ? 1 : -1))
      .slice(rule.keepLatest)
      .forEach((d) => (d.doc.expired = true));
  });

  docs = docs.map((d) => d.doc);
  if (classes?.length) docs = docs.filter((d) => classes.includes(d.class));
  if (paths?.length) {
    const inScope = matcher(paths.flatMap((p) => [p, `${p.replace(/\/+$/, '')}/**`]));
    docs = docs.filter((d) => inScope(d.path));
  }
  if (diff) docs = docs.filter((d) => d.changedRefs?.length);

  const byClass = {};
  for (const d of docs) {
    const c = (byClass[d.class] ??= { docs: 0, lines: 0 });
    c.docs++;
    c.lines += d.lines ?? 0;
  }
  return {
    root,
    config: config.file ? path.relative(root, config.file) : null,
    wiki,
    backlog: config.backlog ?? null,
    base: config.base ?? null,
    shallow: tryGit(root, ['rev-parse', '--is-shallow-repository']) === 'true',
    totals: { docs: docs.length, lines: docs.reduce((n, d) => n + (d.lines ?? 0), 0), byClass },
    docs,
  };
}

export function summarize(inv) {
  const n = (x) => x.toLocaleString('en-US');
  const out = [`${n(inv.totals.docs)} docs, ${n(inv.totals.lines)} lines${inv.config ? '' : '  (no kb.json: nothing is classified yet)'}`];
  if (inv.shallow) out.push('WARNING: shallow clone, so ages and changedRefs are unreliable. Fetch full history.');
  out.push('', 'By class:');
  for (const [c, v] of Object.entries(inv.totals.byClass).sort((a, b) => b[1].lines - a[1].lines)) {
    out.push(`  ${c.padEnd(14)}${n(v.docs).padStart(5)} docs ${n(v.lines).padStart(8)} lines`);
  }
  const folders = new Map();
  for (const d of inv.docs) {
    const parts = d.path.split('/');
    const key = parts.length === 1 ? '(root)' : `${parts.slice(0, Math.min(2, parts.length - 1)).join('/')}/`;
    const f = folders.get(key) ?? { docs: 0, lines: 0, classes: new Set(), expired: 0, dead: 0, stale: 0, oldest: 0 };
    f.docs++;
    f.lines += d.lines ?? 0;
    f.classes.add(d.class);
    if (d.expired) f.expired++;
    if (d.deadRefs.length) f.dead++;
    if (d.changedRefs?.length) f.stale++;
    f.oldest = Math.max(f.oldest, d.ageDays ?? 0);
    folders.set(key, f);
  }
  out.push('', 'By folder:');
  for (const [key, f] of [...folders].sort((a, b) => b[1].lines - a[1].lines)) {
    const notes = [
      f.expired && `${f.expired} expired`,
      f.dead && `${f.dead} with dead refs`,
      f.stale && `${f.stale} with changed refs`,
      `oldest ${f.oldest}d`,
    ].filter(Boolean);
    out.push(
      `  ${key.padEnd(34)}${n(f.docs).padStart(4)} docs ${n(f.lines).padStart(7)} lines  ${[...f.classes].join(',').padEnd(13)} ${notes.join(', ')}`,
    );
  }
  return out.join('\n');
}

const USAGE = `Usage: inventory.mjs [paths...] [options]

  paths                  limit output to these files, folders or globs
  --class a,b            limit output to these classes
  --changed-since <ref>  only living docs that cite a file changed since <ref>
  --summary              print a table instead of JSON
  --paths-only           print matching doc paths, one per line
  --config <file>        use this config instead of <repo>/kb.json
  --root <dir>           repository to inventory (default: current directory)`;

function main(argv) {
  const opts = { paths: [] };
  let format = 'json';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--summary') format = 'summary';
    else if (a === '--paths-only') format = 'paths';
    else if (a === '--class') opts.classes = argv[++i].split(',');
    else if (a === '--changed-since') opts.changedSince = argv[++i];
    else if (a === '--config') opts.config = argv[++i];
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '-h' || a === '--help') return console.log(USAGE);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}\n\n${USAGE}`);
    else opts.paths.push(a);
  }
  const inv = inventory(opts);
  if (format === 'summary') console.log(summarize(inv));
  else if (format === 'paths') inv.docs.forEach((d) => console.log(d.path));
  else console.log(JSON.stringify(inv, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`inventory: ${err.message}`);
    process.exit(1);
  }
}
