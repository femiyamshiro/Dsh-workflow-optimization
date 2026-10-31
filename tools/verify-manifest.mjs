import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'MANIFEST.sha256.json'), 'utf8'));
if (manifest.algorithm !== 'sha256') throw new Error('Unsupported manifest algorithm');
let count = 0;
for (const [name, expected] of Object.entries(manifest.files)) {
  const path = resolve(root, name);
  if (!path.startsWith(root + sep) || lstatSync(path).isSymbolicLink()) throw new Error('Invalid manifest path');
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) throw new Error(`Hash mismatch: ${name}`);
  count++;
}
console.log(`Verified ${count} files. This checks integrity, not Windows compatibility or runtime adoption.`);
