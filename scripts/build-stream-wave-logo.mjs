// Builds brand/stream-container-wave.svg from brand/stream-container.svg.
// The white middle segment ripples with a downward-travelling wave; each row is shifted,
// never scaled, so its width is preserved and the flat top/bottom seams stay pinned.
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../brand/stream-container.svg', import.meta.url), 'utf8');
const paths = [...source.matchAll(/<path d="([^"]+)" fill="([^"]+)"\/>/g)].map((m) => ({ d: m[1], fill: m[2] }));
const middle = paths.find((p) => p.fill === 'white');

const AMPLITUDE = 4;
const WAVELENGTH = 32;
const FRAMES = 24;
const DURATION = '2.4s';

function sample(d) {
  const tokens = d.match(/[MCLZ]|-?\d*\.?\d+/g);
  const points = [];
  let i = 0;
  let cur = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') { cur = [num(), num()]; points.push(cur); }
    else if (cmd === 'L') {
      const end = [num(), num()];
      for (let s = 1; s <= 4; s++) points.push([cur[0] + (end[0] - cur[0]) * s / 4, cur[1] + (end[1] - cur[1]) * s / 4]);
      cur = end;
    } else if (cmd === 'C') {
      const a = [num(), num()]; const b = [num(), num()]; const end = [num(), num()];
      for (let s = 1; s <= 8; s++) {
        const u = s / 8; const v = 1 - u;
        points.push([0, 1].map((k) => v * v * v * cur[k] + 3 * v * v * u * a[k] + 3 * v * u * u * b[k] + u * u * u * end[k]));
      }
      cur = end;
    } else if (cmd === 'Z') break;
  }
  points.pop();
  return points;
}

const points = sample(middle.d);
const ys = points.map(([, y]) => y);
const top = Math.min(...ys);
const bottom = Math.max(...ys);
const round = (v) => Math.round(v * 100) / 100;

function frame(phase) {
  return `M${points.map(([x, y]) => {
    const envelope = Math.sin(Math.PI * (y - top) / (bottom - top));
    const shift = AMPLITUDE * envelope * Math.sin(2 * Math.PI * ((y - top) / WAVELENGTH - phase));
    return `${round(x + shift)} ${round(y)}`;
  }).join('L')}Z`;
}

const frames = Array.from({ length: FRAMES + 1 }, (_, k) => frame((k % FRAMES) / FRAMES));
const animated = `<path d="${frames[0]}" fill="white">
  <animate attributeName="d" dur="${DURATION}" repeatCount="indefinite" calcMode="linear" values="${frames.join(';')}"/>
</path>`;

const output = source
  .replace('<svg ', '<svg role="img" aria-labelledby="stream-title" ')
  .replace(/(<svg[^>]*>)/, '$1\n<title id="stream-title">Stream logo with flowing mark</title>')
  .replace(`<path d="${middle.d}" fill="white"/>`, animated);

writeFileSync(new URL('../brand/stream-container-wave.svg', import.meta.url), output);
console.log(`wrote ${FRAMES} frames from ${points.length} points`);
