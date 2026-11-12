/**
 * Starts the docs screenshot rig: an HTTPS server for the replica page and a
 * throwaway Chrome for Testing that loads dist_chrome_dev and resolves
 * gemini.google.com to that server. Voyager then runs its Gemini code on the
 * replica, and nothing reaches the real site or the owner's browser profile.
 *
 *   bun scripts/docs-shots/run.ts          # headless; Ctrl+C stops both
 *   bun scripts/docs-shots/run.ts --show   # with a window
 *
 * Drive it with scripts/docs-shots/do.ts. See README.md.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { SESSION_FILE } from './session';

const ROOT = path.resolve(import.meta.dir, '../..');
const REPLICA = path.join(import.meta.dir, 'replica');
const EXTENSION = path.join(ROOT, 'dist_chrome_dev');
const HOST = 'gemini.google.com';

function chromeBinary(): string {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  // Branded Chrome ignores --load-extension; Chrome for Testing honours it.
  const base = path.join(homedir(), '.cache/puppeteer/chrome');
  for (const version of existsSync(base) ? readdirSync(base).sort().reverse() : []) {
    const bin = path.join(
      base,
      version,
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    );
    if (existsSync(bin)) return bin;
  }
  throw new Error(
    'No Chrome for Testing found: run `npx @puppeteer/browsers install chrome@stable` or set CHROME_BIN',
  );
}

if (!existsSync(path.join(EXTENSION, 'manifest.json'))) {
  throw new Error('dist_chrome_dev is missing: build it with `bun run dev:chrome` first');
}

const work = mkdtempSync(path.join(tmpdir(), 'voyager-docs-shots-'));
const key = path.join(work, 'key.pem');
const cert = path.join(work, 'cert.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-keyout',
    key,
    '-out',
    cert,
    '-subj',
    `/CN=${HOST}`,
    '-addext',
    `subjectAltName=DNS:${HOST}`,
  ],
  { stdio: 'ignore' },
);

const types: Record<string, string> = { '.css': 'text/css', '.js': 'text/javascript' };
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  tls: { key: Bun.file(key), cert: Bun.file(cert) },
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/__replica/')) {
      const file = path.join(REPLICA, path.basename(pathname));
      if (!existsSync(file)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(file), {
        headers: { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' },
      });
    }
    // Every other path is the app: the replica routes on the client.
    if (/\.(ico|png|svg|json|js|css|woff2?)$/.test(pathname))
      return new Response('', { status: 404 });
    return new Response(readFileSync(path.join(REPLICA, 'index.html')), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
});

const profile = path.join(work, 'profile');
const show = process.argv.includes('--show');
const chrome = spawn(
  chromeBinary(),
  [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXTENSION}`,
    `--disable-extensions-except=${EXTENSION}`,
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${server.port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
    '--ignore-certificate-errors',
    // The whole browser at 2x: an emulated scale reaches the page but not the panel's frame.
    '--force-device-scale-factor=2',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    // Headless keeps 200px of the window for browser chrome.
    '--window-size=1440,1100',
    ...(show ? [] : ['--headless=new']),
    `https://${HOST}/app`,
  ],
  { stdio: 'ignore' },
);

const portFile = path.join(profile, 'DevToolsActivePort');
const deadline = Date.now() + 20_000;
while (!existsSync(portFile) && Date.now() < deadline) await Bun.sleep(100);
const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
writeFileSync(
  SESSION_FILE,
  JSON.stringify({ ws: `ws://127.0.0.1:${port}${wsPath}`, pid: chrome.pid }),
);
console.log(`ready: https://${HOST}/app -> 127.0.0.1:${server.port}; session in ${SESSION_FILE}`);

const stop = () => {
  chrome.kill();
  server.stop(true);
  rmSync(work, { recursive: true, force: true });
  rmSync(SESSION_FILE, { force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
chrome.on('exit', stop);
