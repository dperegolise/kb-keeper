#!/usr/bin/env node
// Builds kb's activity page, `log.html` in kb's local folder, from the log and the viewer template.
//
//   node view.mjs           rebuild the page and print its path
//   node view.mjs --open    rebuild it and open it in the default browser
//
// The log is baked into the page, so it works opened straight from disk with no server. log.mjs
// rebuilds it after every entry, so the page is always current.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kbDir, logPath } from './log.mjs';

const TEMPLATE = fileURLToPath(new URL('../viewer/log.html', import.meta.url));

export const pagePath = (cwd = process.cwd()) => path.join(kbDir(cwd), 'log.html');

// `<common git dir>/kb` -> the repository's folder name (`.git`'s parent, or a bare repo's own name).
function repoName(dir) {
  const common = path.dirname(dir);
  return path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(common, '.git');
}

export function render(cwd = process.cwd()) {
  const dir = kbDir(cwd);
  mkdirSync(dir, { recursive: true });
  const log = logPath(cwd);
  const data = {
    repo: repoName(dir),
    generated: new Date().toISOString(),
    path: log,
    log: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
  // `<` escaped so nothing in the log can close the script tag that holds it.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = readFileSync(TEMPLATE, 'utf8').replace('__KB_DATA__', () => json);
  const out = pagePath(cwd);
  // Write then rename, so two runs rebuilding at once never leave a half-written page.
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, html);
  renameSync(tmp, out);
  return out;
}

function isWsl() {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

export function open(file) {
  let cmd = 'xdg-open';
  let args = [file];
  if (process.platform === 'darwin') cmd = 'open';
  else if (process.platform === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '', file]];
  else if (isWsl()) {
    // explorer.exe opens a Windows path in the Windows default browser.
    cmd = 'explorer.exe';
    try {
      args = [execFileSync('wslpath', ['-w', file], { encoding: 'utf8' }).trim()];
    } catch {}
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function main() {
  const file = render();
  if (process.argv.includes('--open')) open(file);
  console.log(file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
