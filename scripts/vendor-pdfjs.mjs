// Copies pdf.js from node_modules into vendor/pdfjs (MV3 extensions cannot load remote code).
// Usage: npm install && npm run vendor
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/pdfjs-dist');
const dst = path.resolve('vendor/pdfjs');
const version = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs', 'LICENSE']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, path.basename(f)));
}
for (const d of ['cmaps', 'standard_fonts']) fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true });
fs.writeFileSync(path.join(dst, 'README.txt'), `pdf.js ${version} (pdfjs-dist), Apache-2.0. Vendored because Manifest V3 forbids remote code.\n`);
console.log('vendored pdf.js', version);
