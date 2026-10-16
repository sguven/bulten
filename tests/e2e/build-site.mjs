// Builds a fake site under tests/.site for the E2E tests.
// The data is produced with scripts/publish.py, the same script the scheduled tasks used — so the whole pipeline is tested.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE = join(ROOT, 'tests', '.site');
const FIX = join(ROOT, 'tests', 'fixtures');

function publish(fixture, type, date, time) {
  execFileSync('python3', [join(ROOT, 'scripts', 'publish.py'), join(FIX, fixture), '--type', type, '--date', date, '--time', time, '--root', SITE], { stdio: 'pipe' });
}

export default function buildSite() {
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(join(SITE, 'data'), { recursive: true });
  for (const f of ['index.html', 'manifest.webmanifest', 'assets']) cpSync(join(ROOT, f), join(SITE, f), { recursive: true });
  cpSync(join(ROOT, 'data', 'site.json'), join(SITE, 'data', 'site.json'));

  // Older days: one evening brief per day from 15 September to 5 October, for the pagination test
  for (let d = 15; d <= 35; d++) {
    const date = d <= 30 ? `2026-09-${String(d).padStart(2, '0')}` : `2026-10-${String(d - 30).padStart(2, '0')}`;
    publish('minimal.json', 'aksam', date, '19:02');
  }
  publish('xss.json', 'flas', '2026-10-06', '12:45');
  publish('aksam.json', 'aksam', '2026-10-07', '19:06');
  // Thursday 8 October: a full day
  publish('flas_sabah.json', 'flas', '2026-10-08', '08:47');
  publish('flas_ogle.json', 'flas', '2026-10-08', '12:46');
  publish('flas_kapanis.json', 'flas', '2026-10-08', '15:49');
  publish('aksam.json', 'aksam', '2026-10-08', '19:08');
  // Friday 9 October: only the morning flash
  publish('flas_sabah.json', 'flas', '2026-10-09', '08:46');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildSite();
