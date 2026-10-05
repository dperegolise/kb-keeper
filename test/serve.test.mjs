import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { add } from '../scripts/review.mjs';

const SERVE = fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url));
let root;
let info;
let id;

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const kb = (f) => path.join(root, '.git', 'kb', f);
const post = (body, headers = {}) =>
  fetch(`http://127.0.0.1:${info.port}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

before(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kb-serve-')));
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(root, 'a.md'), 'a');
  id = add(root, { doc: 'a.md', question: 'Keep a.md?' }).item.id;
  execFileSync('node', [SERVE, 'start'], { cwd: root });
  info = JSON.parse(readFileSync(kb('server.json'), 'utf8'));
});

after(() => {
  execFileSync('node', [SERVE, 'stop'], { cwd: root });
});

test('a reply without the token is refused', async () => {
  assert.equal((await post({ id, text: 'x' })).status, 403);
});

test('a request for another host name is refused, and refusals are logged with the reason', async () => {
  const { request } = await import('node:http');
  const status = await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: info.port, path: '/', headers: { Host: 'attacker.example' } }, (res) => resolve(res.statusCode));
    req.end();
  });
  assert.equal(status, 403);
  assert.ok(!existsSync(kb('replies.json')));
  assert.match(readFileSync(kb('server.log'), 'utf8'), /403 GET \/ .*host=attacker\.example: host is not 127\.0\.0\.1/);
});

test('another origin never gets to read the page, so it cannot learn the token', async () => {
  const res = await fetch(`http://127.0.0.1:${info.port}/`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('an IDE preview with its own origin can post a reply with the token', async () => {
  const res = await post({ id, text: 'from the preview' }, { 'X-KB-Token': info.token, Origin: 'vscode-webview://abc123' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'vscode-webview://abc123');
});

test('a page opened from disk saves a reply, which is logged and baked into the page', async () => {
  const res = await post({ id, text: 'delete it' }, { 'X-KB-Token': info.token, Origin: 'null' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'null');
  assert.equal(JSON.parse(readFileSync(kb('replies.json'), 'utf8'))[id].text, 'delete it');
  assert.match(readFileSync(kb('log'), 'utf8'), /\| review \| reply \| a\.md \| repo \| .* \| delete it \|/);
  assert.match(readFileSync(kb('log.html'), 'utf8'), /delete it/);
});

test('a reply to an unknown item is a 404, and the live page is served', async () => {
  assert.equal((await post({ id: 'r-000000', text: 'x' }, { 'X-KB-Token': info.token })).status, 404);
  const page = await (await fetch(`http://127.0.0.1:${info.port}/`)).text();
  assert.match(page, /"live":true/);
  assert.match(page, new RegExp(info.token));
});
