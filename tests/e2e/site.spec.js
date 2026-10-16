// End-to-end tests: in a real browser (desktop + phone), with data produced by publish.py.
import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const at = (iso) => new Date(iso);
const FRI_1300 = at('2026-10-09T13:00:00-04:00');
const SAT_1400 = at('2026-10-10T14:00:00-04:00');

// Collect console errors in every test.
const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await use(errors);
  },
  page: async ({ page }, use) => { await use(page); },
});

async function open(page, hash, now) {
  await page.clock.setFixedTime(now);
  await page.goto(`/${hash}`);
  await expect(page.locator('.loading')).toHaveCount(0);
}

const stops = (page) => page.locator('.route .stop');

test.afterEach(async ({ consoleErrors }, info) => {
  if (!info.annotations.some((a) => a.type === 'allow-errors')) expect(consoleErrors, 'konsol hatası olmamalı').toEqual([]);
});

// ---------------------------------------------------------------- Today

test.describe('Bugün sayfası', () => {
  test('gün ortası: yayımlananlar, hazırlanan ve bekleyen duraklar', async ({ page }) => {
    await open(page, '#/', FRI_1300);
    await expect(page.locator('.dayhead h1')).toHaveText('Bugün');
    await expect(page.locator('.dayhead__meta')).toContainText('9 Ekim 2026, Cuma');
    await expect(stops(page)).toHaveCount(4);
    const states = await stops(page).evaluateAll((els) => els.map((e) => [e.querySelector('.stop__time').textContent, e.dataset.state]));
    expect(states).toEqual([['08:46', 'published'], ['12:45', 'preparing'], ['15:45', 'upcoming'], ['18:57', 'upcoming']]);
    await expect(stops(page).nth(1)).toContainText('Hazırlanıyor');
    await expect(stops(page).nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.issue .kicker')).toContainText('08:46 ET');
    await expect(page.locator('.issue .kicker')).toContainText('Açılış öncesi');
    await expect(page.locator('.tab[data-tab="today"]')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Gün İçi Flaş 08:46, 9 Ekim — Gündem');
  });

  test('bekleyen durak tıklanamaz, yayımlanan durak bağlantıdır', async ({ page }) => {
    await open(page, '#/', FRI_1300);
    await expect(stops(page).nth(0).locator('a')).toHaveAttribute('href', '#/g/2026-10-09/flas-0846');
    await expect(stops(page).nth(2).locator('a')).toHaveCount(0);
  });

  test('bugün henüz yayın yoksa sıradaki saat ve son yayın gösterilir', async ({ page }) => {
    await open(page, '#/', SAT_1400);
    await expect(page.locator('.callout')).toContainText('Bugün henüz yayın yok');
    await expect(page.locator('.callout')).toContainText('Sıradaki: Akşam Bülteni, 18:57');
    await expect(stops(page)).toHaveCount(1);
    await expect(stops(page).first()).toHaveAttribute('data-state', 'upcoming');
    // latest issue: Friday 08:46 flash
    await expect(page.locator('.issue .kicker')).toContainText('08:46 ET');
    await expect(page.locator('.issue .kicker')).toContainText('9 Ekim, Cuma');
  });

  test('marka bağlantısı Bugün’e döner', async ({ page }) => {
    await open(page, '#/arsiv', FRI_1300);
    await page.locator('.brand').click();
    await expect(page.locator('.dayhead h1')).toHaveText('Bugün');
  });
});

// ---------------------------------------------------------------- Day and issue

test.describe('Gün görünümü ve yayın', () => {
  test('tam gün: dört durak, varsayılan olarak en son yayın açılır', async ({ page }) => {
    await open(page, '#/g/2026-10-08', FRI_1300);
    await expect(page.locator('.dayhead h1')).toHaveText('8 Ekim, Perşembe');
    await expect(stops(page)).toHaveCount(4);
    await expect(page.locator('.route .stop[data-state="published"]')).toHaveCount(4);
    await expect(stops(page).nth(3)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.issue__title')).toHaveText('Akşam Bülteni');
  });

  test('durağa tıklayınca o yayın açılır ve adres güncellenir', async ({ page }) => {
    await open(page, '#/g/2026-10-08', FRI_1300);
    await stops(page).nth(1).locator('a').click();
    await expect(page).toHaveURL(/#\/g\/2026-10-08\/flas-1246$/);
    await expect(page.locator('.issue__title')).toHaveText('Gün İçi Flaş');
    await expect(page.locator('.issue .kicker')).toContainText('Öğle');
    await expect(page.locator('.issue')).toContainText('İşsizlik başvuruları');
    await expect(stops(page).nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(stops(page).nth(3)).not.toHaveAttribute('aria-current', 'true');
  });

  test('piyasa tablosu: tüm satırlar, renk yönleri ve erişilebilir metin', async ({ page }) => {
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    const rows = page.locator('.markets tbody tr');
    await expect(rows).toHaveCount(9);
    await expect(rows.nth(0).locator('.asset')).toContainText('S&P 500');
    await expect(rows.nth(0).locator('.note')).toHaveText('12:30 ET');
    await expect(rows.nth(0).locator('.chg')).toHaveClass(/chg--up/);
    await expect(rows.nth(3).locator('.chg')).toHaveClass(/chg--down/);
    await expect(rows.nth(6).locator('.chg')).toHaveClass(/chg--flat/);
    await expect(rows.nth(7).locator('.chg')).toHaveClass(/chg--none/);
    await expect(rows.nth(3).locator('.visually-hidden')).toHaveText(' düşüş');
    const upColor = await rows.nth(0).locator('.chg').evaluate((e) => getComputedStyle(e).color);
    const downColor = await rows.nth(3).locator('.chg').evaluate((e) => getComputedStyle(e).color);
    expect(upColor).not.toEqual(downColor);
    // the <b> tag is rendered as bold, not shown as text
    await expect(page.locator('.market-note b')).toHaveText('Ne hareket ettiriyor:');
    await expect(page.locator('.market-note')).not.toContainText('<b>');
  });

  test('bölümler, "doğrulanmadı" etiketi, kaynaklar ve dipnot', async ({ page }) => {
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    await expect(page.locator('.issue section h3')).toHaveText(['Piyasalar', 'Son dakika', 'Magazin & sosyal medya']);
    const gossip = page.locator('.item').filter({ hasText: 'Ünlü çiftin ayrılık iddiası' });
    await expect(gossip.locator('.tag')).toHaveText('doğrulanmadı');
    await expect(gossip.locator('.item__title')).not.toContainText('(doğrulanmadı)');
    await expect(page.locator('.item .tag')).toHaveCount(1);

    const src = page.locator('details.sources');
    await expect(src).not.toHaveAttribute('open', '');
    await expect(src.locator('summary')).toContainText('Kaynaklar');
    await expect(src.locator('.count')).toHaveText('2');
    await src.locator('summary').click();
    const links = src.locator('li a');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toBeVisible();
    await expect(links.first()).toHaveAttribute('target', '_blank');
    await expect(links.first()).toHaveAttribute('rel', /noopener/);
    await expect(src.locator('.host').nth(1)).toHaveText('pagesix.com');
    await expect(page.locator('.issue__foot')).toContainText('Yatırım tavsiyesi değildir');
  });

  test('boş bölümler gösterilmez, başlıksız madde düzgün görünür', async ({ page }) => {
    await open(page, '#/g/2026-10-05', FRI_1300);
    await expect(page.locator('.issue section h3')).toHaveText(['Dünya — bilmen gerekenler']);
    await expect(page.locator('.item__title')).toHaveCount(0);
    await expect(page.locator('.item__text')).toHaveText('Tek maddelik başlıksız haber.');
    await expect(page.locator('.issue h3', { hasText: 'Piyasalar' })).toHaveCount(0);
  });

  test('önceki/sonraki gezinme günler arasında kronolojik çalışır', async ({ page }) => {
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    await expect(page.locator('.pager__prev .what')).toHaveText('Flaş 08:47, 8 Ekim');
    await expect(page.locator('.pager__next .what')).toHaveText('Flaş 15:49, 8 Ekim');
    await page.locator('.pager__prev').click();
    await expect(page).toHaveURL(/flas-0847$/);
    await page.locator('.pager__prev').click();
    await expect(page).toHaveURL(/#\/g\/2026-10-07\/aksam-1906$/);
    await expect(page.locator('.dayhead h1')).toHaveText('7 Ekim, Çarşamba');
  });

  test('klavye okları ile önceki/sonraki', async ({ page, isMobile }) => {
    test.skip(isMobile, 'klavye yalnızca masaüstünde');
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/flas-1549$/);
    await expect(page.locator('.pager__prev')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/flas-1246$/);
    await expect(page.locator('.pager__prev .what')).toHaveText('Flaş 08:47, 8 Ekim');
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/flas-0847$/);
  });

  test('en yeni yayında "sonraki" yok, en eskisinde "önceki" yok', async ({ page }) => {
    await open(page, '#/g/2026-10-09/flas-0846', FRI_1300);
    await expect(page.locator('.pager__next')).toHaveCount(0);
    await expect(page.locator('.pager__prev')).toHaveCount(1);
    await open(page, '#/g/2026-09-15/aksam-1902', FRI_1300);
    await expect(page.locator('.pager__prev')).toHaveCount(0);
  });

  test('tarayıcı geri tuşu önceki görünüme döner', async ({ page }) => {
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    await page.locator('.tab[data-tab="archive"]').click();
    await expect(page.locator('.dayhead h1')).toHaveText('Arşiv');
    await page.goBack();
    await expect(page).toHaveURL(/flas-1246$/);
    await expect(page.locator('.issue .kicker')).toContainText('12:46 ET');
  });

  test('bulunamayan yayın: açıklama ve günün yayınları', async ({ page }) => {
    await open(page, '#/g/2026-10-08/flas-0000', FRI_1300);
    await expect(page.locator('.callout')).toContainText('Bu yayın bulunamadı');
    await expect(page.locator('.issue__title')).toHaveText('Akşam Bülteni');
    await expect(page.locator('.route .stop[aria-current="true"] .stop__time')).toHaveText('19:08');
  });

  test('yayın olmayan gün: arşive yönlendirir', async ({ page }) => {
    await open(page, '#/g/2026-09-01', FRI_1300);
    await expect(page.locator('.empty')).toContainText('1 Eylül 2026, Salı tarihinde yayın yok');
    await page.locator('.empty a', { hasText: 'Arşive git' }).click();
    await expect(page).toHaveURL(/#\/arsiv$/);
  });
});

// ---------------------------------------------------------------- Archive

test.describe('Arşiv', () => {
  test('gün gün listeler, ay başlıkları ve sayfalama', async ({ page }) => {
    await open(page, '#/arsiv', FRI_1300);
    await expect(page.locator('.tab[data-tab="archive"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.dayhead__meta')).toContainText('28 yayın');
    await expect(page.locator('.result-count')).toHaveText('28 yayın, 25 gün');
    await expect(page.locator('section.day')).toHaveCount(10);
    await expect(page.locator('section.day h3').first()).toHaveText('9 Ekim, Cuma');
    // first 10 days: 9 October … 30 September
    await expect(page.locator('h2.month')).toHaveText(['Ekim 2026', 'Eylül 2026']);
    // 8 October rows from newest to oldest
    const thu = page.locator('section.day').nth(1);
    await expect(thu.locator('.row .t')).toHaveText(['19:08', '15:49', '12:46', '08:47']);
    await expect(thu.locator('.row').first().locator('.pill')).toHaveText('Akşam');
    await expect(thu.locator('.row').first().locator('.h')).toHaveText('Fed\'den güvercin sinyal');

    await page.getByRole('button', { name: 'Daha eski günleri göster' }).click();
    await expect(page.locator('section.day')).toHaveCount(20);
    await expect(page.locator('h2.month')).toHaveText(['Ekim 2026', 'Eylül 2026']);
    await page.getByRole('button', { name: 'Daha eski günleri göster' }).click();
    await expect(page.locator('section.day')).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Daha eski günleri göster' })).toHaveCount(0);
  });

  test('satıra tıklayınca yayın açılır', async ({ page }) => {
    await open(page, '#/arsiv', FRI_1300);
    await page.locator('section.day').nth(1).locator('.row a').nth(2).click();
    await expect(page).toHaveURL(/#\/g\/2026-10-08\/flas-1246$/);
    await expect(page.locator('.issue')).toContainText('İşsizlik başvuruları');
  });

  test('gün başlığına tıklayınca gün görünümü açılır', async ({ page }) => {
    await open(page, '#/arsiv', FRI_1300);
    await page.locator('section.day h3 a', { hasText: '7 Ekim' }).click();
    await expect(page).toHaveURL(/#\/g\/2026-10-07$/);
  });

  test('arama: Türkçe karakter duyarsız, vurgulu, adrese yazılır', async ({ page }) => {
    await open(page, '#/arsiv', FRI_1300);
    const q = page.getByRole('searchbox', { name: 'Başlıklarda ara' });
    await q.fill('tutanaklari');
    await expect(page.locator('.result-count')).toHaveText('2 yayın, 2 gün');
    await expect(page.locator('.row mark').first()).toHaveText('tutanakları');
    await expect(page).toHaveURL(/#\/arsiv\?q=tutanaklari$/);
    // focus stays in the search box
    await expect(q).toBeFocused();
    await q.fill('SECAUCUS');
    await expect(page.locator('.result-count')).toHaveText('2 yayın, 2 gün');
    await expect(page.locator('.row .h').first()).toContainText('Secaucus belediye meclisi');
  });

  test('arama yenilemeden sonra korunur', async ({ page }) => {
    await open(page, '#/arsiv?q=lincoln&t=flas', FRI_1300);
    await expect(page.getByRole('searchbox')).toHaveValue('lincoln');
    await expect(page.getByRole('radio', { name: 'Flaş' })).toBeChecked();
    await expect(page.locator('.result-count')).toHaveText('2 yayın, 2 gün');
  });

  test('tür filtresi', async ({ page }) => {
    await open(page, '#/arsiv', FRI_1300);
    await page.locator('label', { hasText: 'Flaş' }).click();
    await expect(page.locator('.result-count')).toHaveText('5 yayın, 3 gün');
    await expect(page).toHaveURL(/t=flas/);
    await page.locator('label', { hasText: 'Akşam Bülteni' }).click();
    await expect(page.locator('.result-count')).toHaveText('23 yayın, 23 gün');
    await page.locator('label', { hasText: 'Tümü' }).click();
    await expect(page.locator('.result-count')).toHaveText('28 yayın, 25 gün');
  });

  test('sonuç yoksa yol gösterir; temizle ve Esc çalışır', async ({ page }) => {
    await open(page, '#/arsiv?t=aksam', FRI_1300);
    const q = page.getByRole('searchbox');
    await q.fill('işsizlik');
    await expect(page.locator('.empty')).toContainText('“işsizlik” için sonuç yok.');
    await expect(page.locator('.empty')).toContainText('Filtreyi “Tümü” yapın');
    await page.getByRole('button', { name: 'Aramayı temizle' }).click();
    await expect(q).toHaveValue('');
    await expect(page.locator('.result-count')).toHaveText('23 yayın, 23 gün');
    await q.fill('xyz');
    await q.press('Escape');
    await expect(q).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Aramayı temizle' })).toBeHidden();
  });
});

// ---------------------------------------------------------------- Security

test.describe('Güvenlik', () => {
  test('yayın içeriğindeki HTML/JS çalıştırılmaz', async ({ page }) => {
    await open(page, '#/g/2026-10-06/flas-1245', FRI_1300);
    await page.locator('details.sources summary').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    const issue = page.locator('.issue');
    await expect(issue.locator('script, img, iframe, svg[onload], [onerror], [onclick], [onload]')).toHaveCount(0);
    await expect(issue.locator('a[href^="javascript"]')).toHaveCount(0);
    // the asset name is plain text: tags show up as literal text
    await expect(issue.locator('.asset').first()).toContainText('<b>Kalın</b><img src=x');
    await expect(issue.locator('.market-note')).toContainText('<a href="javascript:window.__xss=3">tıkla</a>');
    await expect(issue.locator('.item__text em')).toHaveText('vurgu');
    const href = await issue.locator('.sources a').getAttribute('href');
    expect(href.startsWith('https://example.com/')).toBe(true);
    expect(href).not.toContain('"');
  });

  test('arşivde kötü niyetli başlık metin olarak görünür', async ({ page }) => {
    await open(page, '#/arsiv?q=kalin', FRI_1300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('.rows strong, .rows b')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- Errors and empty states

test.describe('Hata ve boş durumlar', () => {
  test('dizin yüklenemezse hata ve "Yeniden dene"', async ({ page }) => {
    test.info().annotations.push({ type: 'allow-errors' });
    await page.route('**/data/index.json*', (r) => r.abort());
    await page.clock.setFixedTime(FRI_1300);
    await page.goto('/#/');
    await expect(page.locator('.callout--error')).toContainText('Yayınlar yüklenemedi');
    await page.unroute('**/data/index.json*');
    await page.getByRole('button', { name: 'Yeniden dene' }).click();
    await expect(page.locator('.dayhead h1')).toHaveText('Bugün');
    await expect(page.locator('.issue')).toBeVisible();
  });

  test('tek yayın yüklenemezse yalnızca o alan hata verir', async ({ page }) => {
    test.info().annotations.push({ type: 'allow-errors' });
    await page.route('**/data/issues/2026-10-08/flas-1246.json*', (r) => r.abort());
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    await expect(page.locator('.callout--error')).toContainText('Bu yayın yüklenemedi');
    await expect(stops(page)).toHaveCount(4);
    await page.unroute('**/data/issues/2026-10-08/flas-1246.json*');
    await page.getByRole('button', { name: 'Yeniden dene' }).click();
    await expect(page.locator('.issue')).toContainText('İşsizlik başvuruları');
  });

  test('site boşken (ilk gün) anlaşılır mesajlar', async ({ page }) => {
    await page.route('**/data/index.json*', (r) => r.fulfill({ json: { version: 1, generated_at: '2026-10-09T17:00:00+00:00', count: 0, latest: null, entries: [] } }));
    await open(page, '#/', FRI_1300);
    await expect(page.locator('.empty')).toContainText('Henüz yayın yok');
    // at 13:00 the 08:45 stop has passed and is empty -> hidden; 12:45 is preparing
    await expect(stops(page)).toHaveCount(3);
    await expect(stops(page).first()).toHaveAttribute('data-state', 'preparing');
    await page.locator('.tab[data-tab="archive"]').click();
    await expect(page.locator('.empty')).toContainText('Arşiv boş');
  });

  test('site.json yoksa varsayılan program kullanılır', async ({ page }) => {
    await page.route('**/data/site.json*', (r) => r.fulfill({ status: 404, body: '' }));
    test.info().annotations.push({ type: 'allow-errors' });
    await open(page, '#/', FRI_1300);
    await expect(stops(page)).toHaveCount(4);
  });
});

// ---------------------------------------------------------------- Otomatik yenileme

test('yeni yayın gelince bildirim çıkar ve tek dokunuşla açılır', async ({ page }) => {
  let calls = 0;
  const newEntry = { id: 'flas-1251', type: 'flas', date: '2026-10-09', time: '12:51', title: 'Gün İçi Flaş', subtitle: 'Öğle', headlines: ['Yeni başlık'], published_at: '2026-10-09T16:51:00+00:00', path: 'data/issues/2026-10-09/flas-1251.json' };
  await page.route('**/data/index.json*', async (route) => {
    const res = await route.fetch();
    const idx = await res.json();
    if (++calls > 1) { idx.entries.unshift(newEntry); idx.latest = '2026-10-09/flas-1251'; idx.count++; }
    await route.fulfill({ json: idx });
  });
  await page.route('**/data/issues/2026-10-09/flas-1251.json*', (r) => r.fulfill({ json: { ...newEntry, markets: [], sections: [{ heading: 'Son dakika', items: [{ title: 'Yeni başlık', text: 'Yeni gelişme.' }] }], sources: [] } }));
  await page.clock.install({ time: at('2026-10-09T12:55:00-04:00') });
  await page.goto('/#/');
  await expect(page.locator('.issue .kicker')).toContainText('08:46 ET');
  await expect(page.locator('#toast')).toBeHidden();
  await page.clock.runFor('05:01');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Yeni yayın: Gün İçi Flaş, 12:51');
  // the issue being read didn't change, but the route shows the new stop
  await expect(page.locator('.issue .kicker')).toContainText('08:46 ET');
  await expect(page.locator('.route .stop[data-state="published"]')).toHaveCount(2);
  await page.locator('#toast .toast__action').click();
  await expect(page).toHaveURL(/flas-1251$/);
  await expect(page.locator('.issue')).toContainText('Yeni gelişme.');
  await expect(page.locator('#toast')).toBeHidden();
});

// ---------------------------------------------------------------- Layout and accessibility

test.describe('Yerleşim ve erişilebilirlik', () => {
  for (const [name, hash, now] of [
    ['Bugün', '#/', FRI_1300],
    ['Yayın', '#/g/2026-10-08/flas-1246', FRI_1300],
    ['Arşiv', '#/arsiv', FRI_1300],
  ]) {
    test(`${name}: yatay taşma yok`, async ({ page }) => {
      await open(page, hash, now);
      await expect(page.locator('main')).not.toBeEmpty();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    for (const scheme of ['light', 'dark']) {
      test(`${name}: erişilebilirlik denetimi (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await open(page, hash, now);
        const summary = page.locator('details.sources summary');
        if (await summary.count()) await summary.first().click();
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }

  test('site dış kaynak yüklemez, yazı tipleri yüklenir', async ({ page }) => {
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
    await open(page, '#/g/2026-10-08/flas-1246', FRI_1300);
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => document.fonts.check('600 24px Newsreader'))).toBe(true);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
    expect(loaded).toEqual(expect.arrayContaining(['Newsreader', 'Archivo']));
  });

  test('koyu tema uygulanır', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '#/', FRI_1300);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(13, 19, 25)');
  });

  test('dokunma hedefleri en az 40px', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'telefon için');
    await open(page, '#/g/2026-10-08', FRI_1300);
    for (const sel of ['.tab', '.route .stop__link', '.pager a']) {
      const heights = await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.min(...heights), sel).toBeGreaterThanOrEqual(40);
    }
  });

  test('üst bant kaydırırken sabit kalır', async ({ page }) => {
    await open(page, '#/g/2026-10-08/aksam-1908', FRI_1300);
    await page.mouse.wheel(0, 1500);
    await page.waitForFunction(() => window.scrollY > 300);
    const top = await page.locator('.masthead').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBe(0);
  });

  test('klavye ile gezinme: atlama bağlantısı ve görünür odak', async ({ page, isMobile }) => {
    test.skip(isMobile, 'klavye yalnızca masaüstünde');
    await open(page, '#/', FRI_1300);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.brand')).toBeFocused();
    const outline = await page.locator('.brand').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).toBe('solid');
  });
});
