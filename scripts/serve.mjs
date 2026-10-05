#!/usr/bin/env node
// A small listener on 127.0.0.1 that lets the activity page save replies to review items.
//
//   node serve.mjs start [--open]   start it in the background if it is not running; prints its URL
//   node serve.mjs status   print its URL, or "stopped"
//   node serve.mjs stop
//
// A page opened from disk cannot write files, so the page posts each reply here and this writes
// it to `replies.json` in kb's local folder. Every request needs the token written to
// `server.json` (and baked into the page), so no other site open in the browser can post to it.
// It stops itself after IDLE_HOURS without a request.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterWrite, append, kbDir } from './log.mjs';
import { reply } from './review.mjs';
import { open, renderHtml } from './view.mjs';

const IDLE_HOURS = 8;
export const serverPath = (cwd = process.cwd()) => path.join(kbDir(cwd), 'server.json');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The running listener's { port, token, pid }, or null.
export function running(cwd = process.cwd()) {
  try {
    const info = JSON.parse(readFileSync(serverPath(cwd), 'utf8'));
    return info.pid && alive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

const url = (info) => `http://127.0.0.1:${info.port}/`;

// Pages opened from disk send `Origin: null`; pages served here send this listener's own origin.
function allowedOrigin(origin, port) {
  return !origin || origin === 'null' || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function run(cwd) {
  const token = randomBytes(16).toString('hex');
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => server.close(() => process.exit(0)), IDLE_HOURS * 3600e3);
  };
  const server = http.createServer((req, res) => {
    touch();
    const origin = req.headers.origin;
    const port = server.address().port;
    if (!allowedOrigin(origin, port)) {
      res.writeHead(403).end();
      return;
    }
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-KB-Token', 'Access-Control-Max-Age': '600' }).end();
      return;
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderHtml(cwd, { live: true }));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method === 'POST' && req.url === '/reply') {
      if (req.headers['x-kb-token'] !== token) {
        res.writeHead(403, cors).end();
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 20000) req.destroy();
      });
      req.on('end', async () => {
        try {
          const { id, text } = JSON.parse(body);
          const r = reply(cwd, String(id), String(text ?? ''));
          if (!r) {
            res.writeHead(404, { ...cors, 'Content-Type': 'application/json' }).end('{"error":"no open item"}');
            return;
          }
          append({ skill: 'review', action: 'reply', target: r.item.doc, where: 'repo', why: r.text || '(reply withdrawn)', evidence: r.item.id }, cwd);
          await afterWrite();
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, id: r.item.id, text: r.text }));
        } catch {
          res.writeHead(400, cors).end();
        }
      });
      return;
    }
    res.writeHead(404, cors).end();
  });
  server.listen(0, '127.0.0.1', async () => {
    writeFileSync(serverPath(cwd), JSON.stringify({ port: server.address().port, token, pid: process.pid, started: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    // Rebuild the page on disk so it carries this listener's address and token.
    await afterWrite();
    touch();
  });
  const cleanup = () => {
    try {
      const info = JSON.parse(readFileSync(serverPath(cwd), 'utf8'));
      if (info.pid === process.pid) rmSync(serverPath(cwd), { force: true });
    } catch {}
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
}

async function start(cwd) {
  const now = running(cwd);
  if (now) return now;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run'], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const info = running(cwd);
    if (info && info.pid === child.pid) return info;
  }
  throw new Error('the listener did not start');
}

async function main() {
  const cmd = process.argv[2];
  const cwd = process.cwd();
  if (cmd === 'run') return run(cwd);
  if (cmd === 'start') {
    const u = url(await start(cwd));
    if (process.argv.includes('--open')) open(u);
    return console.log(u);
  }
  if (cmd === 'status') {
    const info = running(cwd);
    return console.log(info ? url(info) : 'stopped');
  }
  if (cmd === 'stop') {
    const info = running(cwd);
    if (info) process.kill(info.pid, 'SIGTERM');
    return console.log('stopped');
  }
  console.error('usage: serve.mjs start | status | stop');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
