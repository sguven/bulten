// Unit tests for assets/lib.js.  Run: node --test tests/unit/*.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../assets/lib.js';

const NY = (iso) => new Date(iso); // the iso string already includes an offset

describe('HTML güvenliği', () => {
  test('escapeHtml tüm özel karakterleri kaçışlar', () => {
    assert.equal(L.escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    assert.equal(L.escapeHtml(null), '');
  });

  test('inlineFormat yalnızca b/strong/i/em/br etiketlerine izin verir', () => {
    assert.equal(L.inlineFormat('<b>Günün hikâyesi:</b> metin'), '<b>Günün hikâyesi:</b> metin');
    assert.equal(L.inlineFormat('a<br>b<br/>c'), 'a<br>b<br>c');
    assert.equal(L.inlineFormat('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
    assert.equal(L.inlineFormat('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  });

  test('inlineFormat öznitelikli izinli etiketi açmaz', () => {
    const out = L.inlineFormat('<strong onclick="x()">a</strong>');
    assert.ok(!out.includes('<strong'), out);
    assert.ok(!/onclick="/.test(out));
  });

  test('inlineFormat kodlanmış varlıkları çözüp yeniden güvenli kaçışlar', () => {
    assert.equal(L.inlineFormat('S&amp;P 500'), 'S&amp;P 500');
    assert.equal(L.inlineFormat('S&P 500'), 'S&amp;P 500');
    assert.equal(L.inlineFormat('&lt;script&gt;'), '&lt;script&gt;');
  });

  test('inlineFormat açık kalan etiketleri kapatır, eşsiz kapanışları atar', () => {
    assert.equal(L.inlineFormat('<b>açık kaldı'), '<b>açık kaldı</b>');
    assert.equal(L.inlineFormat('kapanış</b> yalnız'), 'kapanış yalnız');
    assert.equal(L.inlineFormat('<b><i>x</b> y'), '<b><i>x</i></b> y');
  });

  test('safeUrl yalnızca http(s) kabul eder', () => {
    assert.equal(L.safeUrl('https://www.reuters.com/a'), 'https://www.reuters.com/a');
    assert.equal(L.safeUrl('javascript:alert(1)'), null);
    assert.equal(L.safeUrl('data:text/html,x'), null);
    assert.equal(L.safeUrl('/relative'), null);
    assert.ok(!L.safeUrl('https://e.com/"><script>').includes('"'));
  });

  test('hostOf www önekini atar', () => {
    assert.equal(L.hostOf('https://www.secaucusnj.gov/news'), 'secaucusnj.gov');
    assert.equal(L.hostOf('bozuk'), '');
  });

  test('stripTags', () => {
    assert.equal(L.stripTags('<b>a</b> &amp; b'), 'a & b');
  });
});

describe('piyasa değişim yönü', () => {
  const cases = [
    ['+0,40%', 'up'], ['+3 bp', 'up'], ['0,71%', 'up'],
    ['-0,40%', 'down'], ['−1,2%', 'down'], ['-3 bp', 'down'],
    ['0,00%', 'flat'], ['+0,00%', 'flat'], ['0 bp', 'flat'],
    ['—', 'none'], ['-', 'none'], ['', 'none'], [undefined, 'none'], ['n/a', 'none'],
  ];
  for (const [v, exp] of cases) test(`${JSON.stringify(v)} -> ${exp}`, () => assert.equal(L.changeDirection(v), exp));
});

describe('New York saati', () => {
  test('UTC gece yarısı sonrası hâlâ NY’de önceki gün', () => {
    assert.deepEqual(L.nyParts(NY('2026-10-10T02:30:00Z')), { date: '2026-10-09', time: '22:30', weekday: 5 });
  });
  test('yaz saati (EDT, UTC-4)', () => {
    assert.equal(L.nyParts(NY('2026-10-08T16:45:00Z')).time, '12:45');
  });
  test('kış saati (EST, UTC-5) — 1 Kasım 2026 geçişi', () => {
    assert.equal(L.nyParts(NY('2026-11-02T17:45:00Z')).time, '12:45');
    assert.equal(L.nyParts(NY('2026-11-01T05:30:00Z')).time, '01:30');
  });
  test('gece yarısı 00:xx olarak yazılır (24:xx değil)', () => {
    assert.equal(L.nyParts(NY('2026-10-09T04:05:00Z')).time, '00:05');
  });
  test('hafta günü ve hafta sonu', () => {
    assert.equal(L.weekdayOf('2026-10-10'), 6);
    assert.equal(L.isWeekend('2026-10-10'), true);
    assert.equal(L.isWeekend('2026-10-11'), true);
    assert.equal(L.isWeekend('2026-10-12'), false);
  });
  test('addDays ay/yıl sınırlarında', () => {
    assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(L.addDays('2026-01-01', -1), '2025-12-31');
  });
});

describe('Türkçe tarih biçimleri', () => {
  test('uzun tarih', () => {
    assert.equal(L.formatDateLong('2026-10-10'), '10 Ekim 2026, Cumartesi');
    assert.equal(L.formatDateLong('2026-10-07', { year: false }), '7 Ekim, Çarşamba');
    assert.equal(L.formatDateLong('2026-02-01', { weekday: false }), '1 Şubat 2026');
  });
  test('kısa tarih ve ay etiketi', () => {
    assert.equal(L.formatDateShort('2026-08-03'), '3 Ağustos');
    assert.equal(L.monthLabel('2026-12-31'), 'Aralık 2026');
  });
  test('göreli zaman', () => {
    const now = NY('2026-10-10T18:00:00Z');
    assert.equal(L.relativeTime('2026-10-10T17:59:40Z', now), 'az önce');
    assert.equal(L.relativeTime('2026-10-10T17:48:00Z', now), '12 dk önce');
    assert.equal(L.relativeTime('2026-10-10T15:00:00Z', now), '3 saat önce');
    assert.equal(L.relativeTime('2026-10-09T12:00:00Z', now), 'dün');
    assert.equal(L.relativeTime('2026-10-06T12:00:00Z', now), '4 gün önce');
    assert.equal(L.relativeTime('bozuk', now), '');
  });
});

describe('yayın etiketleri', () => {
  test('tur adı saate göre', () => {
    assert.equal(L.roundLabel('flas', '08:47'), 'Açılış öncesi');
    assert.equal(L.roundLabel('flas', '12:46'), 'Öğle');
    assert.equal(L.roundLabel('flas', '15:49'), 'Kapanışa doğru');
    assert.equal(L.roundLabel('aksam', '19:10'), 'Akşam Bülteni');
  });
  test('(doğrulanmadı) eki ayrılır', () => {
    assert.deepEqual(L.splitUnverified('Ayrılık iddiası (doğrulanmadı)'), { text: 'Ayrılık iddiası', unverified: true });
    assert.deepEqual(L.splitUnverified('Ayrılık iddiası (Doğrulanmadı).'), { text: 'Ayrılık iddiası', unverified: true });
    assert.deepEqual(L.splitUnverified('Normal başlık'), { text: 'Normal başlık', unverified: false });
    assert.deepEqual(L.splitUnverified('(doğrulanmadı) ortada değil'), { text: '(doğrulanmadı) ortada değil', unverified: false });
  });
});

describe('arama', () => {
  test('fold Türkçe harfleri ve büyük İ/I’yı eşler', () => {
    assert.equal(L.fold('İSTANBUL'), 'istanbul');
    assert.equal(L.fold('IŞIK'), 'isik');
    assert.equal(L.fold('Çığ Öğüt Şüphe'), 'cig ogut suphe');
    assert.equal(L.fold('hikâye'), 'hikaye');
  });

  const e = (o) => ({ id: 'flas-0845', type: 'flas', date: '2026-10-08', time: '08:45', title: '', subtitle: '', headlines: [], ...o });
  const list = [
    e({ headlines: ['Fed tutanakları', 'TCMB rezervleri'] }),
    e({ id: 'aksam-1906', type: 'aksam', time: '19:06', headlines: ['Konut kredisi faizleri', 'Secaucus belediye meclisi'] }),
    e({ id: 'flas-1546', time: '15:46', date: '2026-10-07', headlines: ['Lincoln Tunnel kapanışı'] }),
  ];

  test('aksansız ve büyük/küçük harf duyarsız eşleşme', () => {
    assert.equal(L.filterEntries(list, { query: 'tutanaklari' }).length, 1);
    assert.equal(L.filterEntries(list, { query: 'SECAUCUS' }).length, 1);
    assert.equal(L.filterEntries(list, { query: 'tcmb' }).length, 1);
  });
  test('birden çok kelime hepsi eşleşmeli (VE)', () => {
    assert.equal(L.filterEntries(list, { query: 'fed tcmb' }).length, 1);
    assert.equal(L.filterEntries(list, { query: 'fed konut' }).length, 0);
  });
  test('tür filtresi', () => {
    assert.equal(L.filterEntries(list, { type: 'aksam' }).length, 1);
    assert.equal(L.filterEntries(list, { type: 'flas' }).length, 2);
    assert.equal(L.filterEntries(list, { type: 'all', query: '  ' }).length, 3);
  });
  test('highlight eşleşmeyi işaretler ve kaçışlar', () => {
    assert.equal(L.highlight('Fed tutanakları', 'tutanaklari'), 'Fed <mark>tutanakları</mark>');
    assert.equal(L.highlight('<b>ŞOK</b>', 'sok'), '&lt;b&gt;<mark>ŞOK</mark>&lt;/b&gt;');
    assert.equal(L.highlight('a b', ''), 'a b');
    assert.equal(L.highlight('İzmir İzmir', 'izmir'), '<mark>İzmir</mark> <mark>İzmir</mark>');
  });
});

describe('sıralama ve gruplama', () => {
  const list = [
    { id: 'flas-0845', date: '2026-10-08', time: '08:45', type: 'flas' },
    { id: 'aksam-1906', date: '2026-10-07', time: '19:06', type: 'aksam' },
    { id: 'aksam-1908', date: '2026-10-08', time: '19:08', type: 'aksam' },
    { id: 'flas-1246', date: '2026-10-08', time: '12:46', type: 'flas' },
  ];
  test('en yeni önce', () => {
    assert.deepEqual(L.sortEntries(list).map((x) => x.id), ['aksam-1908', 'flas-1246', 'flas-0845', 'aksam-1906']);
    assert.equal(list[0].id, 'flas-0845', 'girdi listesi değiştirilmemeli');
  });
  test('güne göre gruplama', () => {
    const g = L.groupByDate(list);
    assert.deepEqual(g.map((x) => x.date), ['2026-10-08', '2026-10-07']);
    assert.equal(g[0].items.length, 3);
  });
  test('komşular günler arası kronolojik', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(L.neighbors(list, 'flas-0845', '2026-10-08')).map(([k, v]) => [k, v && v.id])), { prev: 'aksam-1906', next: 'flas-1246' });
    assert.equal(L.neighbors(list, 'aksam-1908', '2026-10-08').next, null);
    assert.equal(L.neighbors(list, 'aksam-1906', '2026-10-07').prev, null);
    assert.deepEqual(L.neighbors(list, 'yok', '2026-10-08'), { prev: null, next: null });
  });
  test('aynı id farklı günlerde karışmaz', () => {
    const l2 = [{ id: 'aksam-1906', date: '2026-10-06', time: '19:06' }, ...list];
    assert.equal(L.neighbors(l2, 'aksam-1906', '2026-10-07').prev.date, '2026-10-06');
  });
});

describe('günün durakları (buildStops)', () => {
  const thu = '2026-10-08';
  const at = (hhmm, date = thu) => NY(`${date}T${hhmm}:00-04:00`);
  const pub = (id, time) => ({ id, type: id.split('-')[0], date: thu, time });

  test('sabah, hiç yayın yokken: hepsi bekleniyor', () => {
    const s = L.buildStops([], thu, { now: at('07:00') });
    assert.deepEqual(s.map((x) => [x.time, x.state]), [['08:45', 'upcoming'], ['12:45', 'upcoming'], ['15:45', 'upcoming'], ['18:57', 'upcoming']]);
  });

  test('planlanan saat geçti ama yayın yok: 45 dk boyunca hazırlanıyor, sonra gizlenir', () => {
    assert.equal(L.buildStops([], thu, { now: at('08:50') })[0].state, 'preparing');
    assert.equal(L.buildStops([], thu, { now: at('09:30') })[0].state, 'preparing');
    assert.equal(L.buildStops([], thu, { now: at('09:31') })[0].time, '12:45');
  });

  test('gecikmeli yayın doğru durağa oturur, fazladan durak oluşmaz', () => {
    const s = L.buildStops([pub('flas-0849', '08:49'), pub('flas-1252', '12:52')], thu, { now: at('13:00') });
    assert.deepEqual(s.map((x) => [x.time, x.state]), [['08:49', 'published'], ['12:52', 'published'], ['15:45', 'upcoming'], ['18:57', 'upcoming']]);
    assert.equal(s[0].entry.id, 'flas-0849');
  });

  test('akşam bülteni 14 dk geç gelse de akşam durağına eşleşir', () => {
    const day = [pub('flas-0847', '08:47'), pub('flas-1246', '12:46'), pub('flas-1549', '15:49'), pub('aksam-1911', '19:11')];
    const s = L.buildStops(day, thu, { now: at('19:20') });
    assert.equal(s.length, 4);
    assert.ok(s.every((x) => x.state === 'published'));
  });

  test('programa uymayan elle tetiklenmiş ek yayın da gösterilir', () => {
    const s = L.buildStops([pub('flas-1030', '10:30')], thu, { now: at('11:00') });
    assert.deepEqual(s.map((x) => [x.time, x.state]), [['10:30', 'published'], ['12:45', 'upcoming'], ['15:45', 'upcoming'], ['18:57', 'upcoming']]);
  });

  test('hafta sonu yalnızca akşam bülteni beklenir', () => {
    const s = L.buildStops([], '2026-10-10', { now: at('14:00', '2026-10-10') });
    assert.deepEqual(s.map((x) => [x.type, x.time]), [['aksam', '18:57']]);
  });

  test('geçmiş günlerde yalnızca yayımlananlar', () => {
    const s = L.buildStops([pub('flas-0847', '08:47')], thu, { now: at('10:00', '2026-10-09') });
    assert.deepEqual(s.map((x) => x.state), ['published']);
  });

  test('özel program', () => {
    const schedule = { weekday: [{ type: 'flas', time: '10:00' }], weekend: [] };
    assert.deepEqual(L.buildStops([], thu, { now: at('09:00'), schedule }).map((x) => x.time), ['10:00']);
  });
});

describe('yönlendirme', () => {
  test('parseRoute', () => {
    assert.deepEqual(L.parseRoute(''), { view: 'today' });
    assert.deepEqual(L.parseRoute('#/'), { view: 'today' });
    assert.deepEqual(L.parseRoute('#/bilinmeyen'), { view: 'today' });
    assert.deepEqual(L.parseRoute('#/arsiv'), { view: 'archive', query: '', type: 'all' });
    assert.deepEqual(L.parseRoute('#/arsiv?q=dolar%20tl&t=flas'), { view: 'archive', query: 'dolar tl', type: 'flas' });
    assert.deepEqual(L.parseRoute('#/arsiv?t=hack'), { view: 'archive', query: '', type: 'all' });
    assert.deepEqual(L.parseRoute('#/g/2026-10-08'), { view: 'day', date: '2026-10-08', id: null });
    assert.deepEqual(L.parseRoute('#/g/2026-10-08/flas-1246'), { view: 'day', date: '2026-10-08', id: 'flas-1246' });
    assert.deepEqual(L.parseRoute('#/g/2026-10-08/../../etc'), { view: 'day', date: '2026-10-08', id: null });
    assert.deepEqual(L.parseRoute('#/g/08-10-2026'), { view: 'today' });
  });
  test('href üreticileri parseRoute ile tutarlı', () => {
    const e = { date: '2026-10-08', id: 'aksam-1908' };
    assert.deepEqual(L.parseRoute(L.issueHref(e)), { view: 'day', date: e.date, id: e.id });
    assert.deepEqual(L.parseRoute(L.archiveHref({ query: 'Şeker & çay', type: 'aksam' })), { view: 'archive', query: 'Şeker & çay', type: 'aksam' });
    assert.equal(L.archiveHref(), '#/arsiv');
  });
});
