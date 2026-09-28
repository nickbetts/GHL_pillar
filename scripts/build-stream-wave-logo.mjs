// Usage: node scripts/build-stream-wave-logo.mjs [settings.json] [output.svg]
// Settings JSON comes from "Copy settings" in brand/stream-wave-playground.html; omitted keys use the defaults.
// The platform logo is built with: node scripts/build-stream-wave-logo.mjs brand/stream-container-animated.settings.json brand/stream-container-animated.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

await import('../brand/stream-wave.js');
const { build, normalize } = globalThis.StreamWave;

const source = readFileSync(new URL('../brand/stream-container.svg', import.meta.url), 'utf8');
const [settingsFile, outputFile] = process.argv.slice(2);
const settings = normalize(settingsFile ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {});
const output = outputFile ? resolve(outputFile) : new URL('../brand/stream-container-wave.svg', import.meta.url);

writeFileSync(output, build(source, settings));
console.log(`wrote ${outputFile || 'brand/stream-container-wave.svg'} (${settings.frames} frames, ${settings.duration}s, ${settings.pieces === 'all' ? 'whole S' : 'middle only'})`);
