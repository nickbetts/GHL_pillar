// Builds dist/stream-theme.zip (WordPress "Upload Theme" ready): node tools/build-zip.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(dist, 'stream-theme.zip');
fs.mkdirSync(dist, { recursive: true });
fs.rmSync(out, { force: true });

// zip from the theme's parent so the archive has a single top-level "stream/" folder
execFileSync('zip', ['-rq', out, 'stream', '-x', '*.DS_Store', '-x', '*/.git/*'], { cwd: path.join(root, 'theme') });

const kb = Math.round(fs.statSync(out).size / 1024);
const list = execFileSync('unzip', ['-l', out]).toString().trim().split('\n');
console.log(`built ${path.relative(process.cwd(), out)} (${kb} KB, ${list[list.length - 1].trim().split(/\s+/)[1]} files)`);
