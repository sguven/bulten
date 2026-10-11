// E2E testleri için tests/.site altında, Claude sayfasının birebir derlenmiş halini sahte veri deposuyla kurar.
// Belgeler zamanlanmış görevlerin yazdığı biçimdedir: veri.json içeriği + date/time/type/key/published_at.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE = join(ROOT, 'tests', '.site');
const FIX = join(ROOT, 'tests', 'fixtures');

function issueDoc(fixture, type, date, time) {
  const d = JSON.parse(readFileSync(join(FIX, fixture), 'utf8'));
  const id = `${type}-${time.replace(':', '')}`;
  return [`${date}_${id}`, { ...d, type, date, time, key: `${date}T${time}`, published_at: `${date}T${time}:00-04:00` }];
}

export function seedDocs() {
  const out = [];
  for (let d = 15; d <= 35; d++) {
    const date = d <= 30 ? `2026-09-${String(d).padStart(2, '0')}` : `2026-10-${String(d - 30).padStart(2, '0')}`;
    out.push(issueDoc('minimal.json', 'aksam', date, '19:02'));
  }
  out.push(issueDoc('xss.json', 'flas', '2026-10-06', '12:45'));
  out.push(issueDoc('aksam.json', 'aksam', '2026-10-07', '19:06'));
  out.push(issueDoc('flas_sabah.json', 'flas', '2026-10-08', '08:47'));
  out.push(issueDoc('flas_ogle.json', 'flas', '2026-10-08', '12:46'));
  out.push(issueDoc('flas_kapanis.json', 'flas', '2026-10-08', '15:49'));
  out.push(issueDoc('aksam.json', 'aksam', '2026-10-08', '19:08'));
  out.push(issueDoc('flas_sabah.json', 'flas', '2026-10-09', '08:46'));
  return Object.fromEntries(out);
}

const SKELETON_HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

export default function buildSite() {
  execFileSync('python3', [join(ROOT, 'scripts', 'build_artifact.py')], { stdio: 'pipe' });
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(SITE, { recursive: true });
  const page = readFileSync(join(ROOT, 'dist', 'gundem.html'), 'utf8')
    // testler ağdan bağımsız olsun: Google Fonts yerine sistem yazı tipi
    .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\n?/g, '');
  const fake = readFileSync(join(ROOT, 'tests', 'e2e', 'fake-db.js'), 'utf8');
  writeFileSync(join(SITE, 'seed.js'), `window.__SEED_DOCS = window.__SEED_DOCS || ${JSON.stringify(seedDocs())};\n`);
  writeFileSync(join(SITE, 'fake-db.js'), fake);
  writeFileSync(join(SITE, 'index.html'), `${SKELETON_HEAD}<script src="seed.js"></script><script src="fake-db.js"></script>\n${page}</body></html>`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildSite();
