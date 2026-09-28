// Usage: node scripts/build-stream-wave-logo.mjs [settings.json] [output.svg] [--mark-only] [--still]
// Settings JSON comes from "Copy settings" in brand/stream-wave-playground.html; omitted keys use the defaults.
// The platform logo is built with: node scripts/build-stream-wave-logo.mjs brand/stream-container-animated.settings.json brand/stream-container-animated.svg
// The login background: node scripts/build-stream-wave-logo.mjs brand/stream-mark-bg.settings.json brand/stream-mark-bg.svg --mark-only (add --still for brand/stream-mark-bg-still.svg)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

await import('../brand/stream-wave.js');
const { build, normalize } = globalThis.StreamWave;

const source = readFileSync(new URL('../brand/stream-container.svg', import.meta.url), 'utf8');
const args = process.argv.slice(2);
const [settingsFile, outputFile] = args.filter((arg) => !arg.startsWith('--'));
const variant = { markOnly: args.includes('--mark-only'), still: args.includes('--still') };
const settings = normalize(settingsFile ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {});
const output = outputFile ? resolve(outputFile) : new URL('../brand/stream-container-wave.svg', import.meta.url);

writeFileSync(output, build(source, settings, variant));
console.log(`wrote ${outputFile || 'brand/stream-container-wave.svg'} (${settings.frames} frames, ${settings.duration}s, ${settings.pieces === 'all' ? 'whole S' : 'middle only'})`);
