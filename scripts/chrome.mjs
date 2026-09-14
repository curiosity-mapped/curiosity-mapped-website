/*
 * One headless Chrome, driven over the DevTools protocol with Node's built-in
 * WebSocket. Shared by build-og.mjs and build-brand.mjs so the launch, the port
 * polling and the message plumbing exist once.
 *
 * WHY NOT `chrome --headless --screenshot`: headless Chrome does not reliably exit
 * after writing a screenshot, so a shell loop renders the first file and then
 * hangs on the second. One browser driven over CDP does everything and is told
 * when to stop.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    try { accessSync(c, constants.X_OK); return c; } catch { /* keep looking */ }
  }
  return null;
}

/*
 * Resolves to { send, evaluate, close }. `port` is a parameter so two scripts run
 * back to back (or side by side) never fight over one debugging port.
 */
export async function launchChrome({ port, width, height }) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('no Chrome or Chromium found; cannot rasterise');

  const profile = mkdtempSync(join(tmpdir(), 'cm-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
  const close = () => {
    try { ws && ws.close(); } catch { /* already gone */ }
    try { chrome.kill('SIGTERM'); } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* nothing to clean */ }
  };
  process.on('exit', close);
  process.on('SIGINT', () => { close(); process.exit(130); });

  /* Chrome takes a moment to open the port. Poll rather than guess at a delay. */
  let page = null;
  for (let attempt = 0; attempt < 60 && !page; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page') || null;
    } catch { /* not listening yet */ }
    if (!page) await sleep(250);
  }
  if (!page) { close(); throw new Error('Chrome did not open its debugging port'); }

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  /* Runs an expression in the page and returns its value, awaiting promises.
     A thrown error in the page surfaces here rather than as an undefined value. */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (r.error) throw new Error(r.error.message);
    if (r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text);
    }
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false });

  return { send, evaluate, close };
}
