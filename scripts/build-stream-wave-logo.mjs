// Usage: node scripts/build-stream-wave-logo.mjs [settings.json]
// Settings JSON comes from "Copy settings" in brand/stream-wave-playground.html; omitted keys use the defaults.
import { readFileSync, writeFileSync } from 'node:fs';

await import('../brand/stream-wave.js');
const { build, normalize } = globalThis.StreamWave;

const source = readFileSync(new URL('../brand/stream-container.svg', import.meta.url), 'utf8');
const settingsFile = process.argv[2];
const settings = normalize(settingsFile ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {});

writeFileSync(new URL('../brand/stream-container-wave.svg', import.meta.url), build(source, settings));
console.log(`wrote brand/stream-container-wave.svg (${settings.frames} frames, ${settings.duration}s, ${settings.pieces === 'all' ? 'whole S' : 'middle only'})`);
