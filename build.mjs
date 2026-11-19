#!/usr/bin/env node
// Gera dist/chrome e dist/firefox (pastas prontas para carregar) e os .zip para as lojas.
// Uso: `node build.mjs` (ou `npm run build`).
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const INCLUDE = ['background.js', 'content', 'popup', 'reader', 'shared', 'icons', 'vendor', 'README.md'];
const base = JSON.parse(readFileSync(join(root, 'manifest.base.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (pkg.version !== base.version) {
  console.error(`✖ version mismatch: package.json=${pkg.version} manifest.base.json=${base.version}`);
  process.exit(1);
}

// Limites das lojas (a Chrome Web Store recusa o upload se passar).
const LIMITS = { name: 75, short_name: 12, description: 132 };
for (const [k, max] of Object.entries(LIMITS)) {
  if (base[k] && base[k].length > max) {
    console.error(`✖ manifest "${k}" tem ${base[k].length} caracteres (máximo ${max})`);
    process.exit(1);
  }
}

// ID da extensão no Firefox. Troque por algo seu e único ou defina GECKO_ID ao gerar o build.
const GECKO_ID = process.env.GECKO_ID || 'hiraku-judges-translator@icaroplira';

function manifestFor(target) {
  const m = structuredClone(base);
  if (target === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '120';
  } else {
    // Firefox (MV3) usa "event page" em vez de service worker.
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 128: scripting world MAIN; 140: data_collection_permissions
        strict_min_version: '140.0',
        // O texto do enunciado é enviado ao serviço de tradução escolhido (Google/DeepL)
        // somente quando o usuário pede a tradução.
        data_collection_permissions: { required: ['websiteContent'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}

rmSync(dist, { recursive: true, force: true });
for (const target of ['chrome', 'firefox']) {
  const out = join(dist, target);
  mkdirSync(out, { recursive: true });
  for (const f of INCLUDE) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f), { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifestFor(target), null, 2) + '\n');
  console.log(`✔ dist/${target}`);
  const zip = join(dist, `hiraku-judges-translator-${pkg.version}-${target}.zip`);
  try {
    execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
    console.log(`✔ ${zip.replace(root + '/', '')}`);
  } catch {
    console.log('  (comando "zip" não encontrado — compacte o conteúdo da pasta manualmente)');
  }
}
