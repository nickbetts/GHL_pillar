// Tiny Chrome DevTools driver for visual QA: node tools/shot.mjs jobs.json
// Each job: { url, w, h, mobile, steps: [{ js, wait, shot, full }] }. Needs Node 22+ (built-in WebSocket).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-shot', '--hide-scrollbars', '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 50; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(200); }
}
if (!ver) { chrome.kill(); throw new Error('Chrome did not start'); }

async function session() {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, (d) => (d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => { ws.close(); fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } };
}

try {
  for (const job of jobs) {
    const s = await session();
    await s.send('Page.enable');
    await s.send('Emulation.setDeviceMetricsOverride', { width: job.w || 1440, height: job.h || 900, deviceScaleFactor: job.dpr || 1, mobile: !!job.mobile });
    await s.send('Page.navigate', { url: job.url });
    await sleep(job.load || 2500);
    for (const st of job.steps || []) {
      if (st.js) {
        const r = await s.send('Runtime.evaluate', { expression: st.js, awaitPromise: true, returnByValue: true });
        if (st.log) console.log(job.url, '=>', JSON.stringify(r.result?.value ?? r.exceptionDetails?.text));
      }
      await sleep(st.wait ?? 500);
      if (st.shot) {
        let params = { format: 'png' };
        if (st.full) {
          const m = await s.send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
          params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: job.w || 1440, height: Math.min(m.result.value, st.maxH || 9000), scale: 1 } };
        }
        const img = await s.send('Page.captureScreenshot', params);
        fs.writeFileSync(st.shot, Buffer.from(img.data, 'base64'));
        console.log('saved', st.shot);
      }
    }
    s.close();
  }
} finally {
  chrome.kill();
  process.exit(0);
}
