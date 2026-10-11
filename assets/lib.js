// Saf yardımcı fonksiyonlar — DOM'a dokunmaz, Node testlerinden doğrudan içe aktarılır.

export const TZ = 'America/New_York';

export const TYPE_LABEL = { flas: 'Gün İçi Flaş', aksam: 'Akşam Bülteni' };
export const TYPE_SHORT = { flas: 'Flaş', aksam: 'Akşam' };

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz',
  'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// ---------- HTML güvenliği ----------

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITY[e]);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Metni güvenli HTML'e çevirir; yalnızca <b>, <strong>, <i>, <em>, <br> etiketlerine izin verir.
export function inlineFormat(s) {
  const safe = escapeHtml(decodeEntities(s)).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  // İzin verilen etiketleri geri aç; eşi olmayan kapanışları at, açık kalanları kapat.
  const stack = [];
  const out = safe.replace(/&lt;(\/?)(b|strong|i|em)&gt;/gi, (_, slash, raw) => {
    const tag = raw.toLowerCase();
    if (!slash) { stack.push(tag); return `<${tag}>`; }
    const at = stack.lastIndexOf(tag);
    if (at === -1) return '';
    const closing = stack.splice(at).reverse().map((t) => `</${t}>`).join('');
    // iç içe geçmiş açık etiketleri kapatıp yeniden açmak yerine yalnızca kapatırız
    return closing;
  });
  return out + stack.reverse().map((t) => `</${t}>`).join('');
}

export function stripTags(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ''));
}

// Yalnızca http(s) bağlantılarına izin ver.
export function safeUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function hostOf(u) {
  const s = safeUrl(u);
  return s ? new URL(s).hostname.replace(/^www\./, '') : '';
}

// ---------- Piyasa değişimi ----------

// "+0,40%" -> 'up', "-1,2%" / "−1,2%" -> 'down', "0,00%" -> 'flat', "—" -> 'none'
export function changeDirection(v) {
  const s = String(v ?? '').trim();
  if (!s || /^[—–-]+$/.test(s)) return 'none';
  if (/^[-−–]/.test(s)) return 'down';
  const digits = s.replace(/[^0-9]/g, '');
  if (digits && /^0+$/.test(digits)) return 'flat';
  if (/^\+/.test(s)) return 'up';
  return /\d/.test(s) ? 'up' : 'none';
}

// ---------- Tarih / saat (New York) ----------

// Verilen anın New York'taki tarih ve saatini döndürür: { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 }
export function nyParts(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: wd };
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(dateStr) {
  const wd = weekdayOf(dateStr);
  return wd === 0 || wd === 6;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// "10 Ekim 2026, Cumartesi" gibi
export function formatDateLong(dateStr, { year = true, weekday = true } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let s = `${d} ${MONTHS[m - 1]}`;
  if (year) s += ` ${y}`;
  if (weekday) s += `, ${WEEKDAYS[weekdayOf(dateStr)]}`;
  return s;
}

export function formatDateShort(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function monthLabel(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// "12 dk önce", "3 saat önce", "dün" …
export function relativeTime(iso, now = new Date()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.round((now.getTime() - t) / 60000);
  if (diff < 1) return 'az önce';
  if (diff < 60) return `${diff} dk önce`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h} saat önce`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'dün' : `${d} gün önce`;
}

// ---------- Yayın etiketleri ----------

export function roundLabel(type, time) {
  if (type === 'aksam') return 'Akşam Bülteni';
  const m = toMinutes(time);
  if (m < 11 * 60) return 'Açılış öncesi';
  if (m < 14 * 60 + 30) return 'Öğle';
  return 'Kapanışa doğru';
}

// "(doğrulanmadı)" ekini ayırır
export function splitUnverified(title) {
  const s = String(title ?? '').trim();
  const re = /\s*\((doğrulanmadı|dogrulanmadi|doğrulanmamış)\)\s*\.?$/i;
  return re.test(s) ? { text: s.replace(re, ''), unverified: true } : { text: s, unverified: false };
}

// ---------- Arama ----------

// Türkçe büyük/küçük harf ve aksan farkını yok sayar: "İstanbul" ~ "istanbul" ~ "Istanbul"
export function fold(s) {
  return String(s ?? '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function matchesQuery(entry, query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = fold([entry.title, entry.subtitle, ...(entry.headlines || [])].join(' '));
  return terms.every((t) => hay.includes(t));
}

export function filterEntries(entries, { query = '', type = 'all' } = {}) {
  return entries.filter((e) => (type === 'all' || e.type === type) && matchesQuery(e, query));
}

// Eşleşen kısımları <mark> ile işaretler (metin önce kaçışlanır)
export function highlight(text, query) {
  const raw = String(text ?? '');
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return escapeHtml(raw);
  const folded = fold(raw);
  // fold() karakter sayısını korur mu? Korumadığı durumda işaretlemeden vazgeç.
  if (folded.length !== raw.length) return escapeHtml(raw);
  const marks = new Array(raw.length).fill(false);
  for (const t of terms) {
    let i = folded.indexOf(t);
    while (i !== -1) {
      for (let k = i; k < i + t.length; k++) marks[k] = true;
      i = folded.indexOf(t, i + t.length);
    }
  }
  let out = '';
  let open = false;
  for (let i = 0; i < raw.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += escapeHtml(raw[i]);
  }
  if (open) out += '</mark>';
  return out;
}

// ---------- Sıralama / gruplama ----------

export function sortEntries(entries) {
  return [...entries].sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
}

export function groupByDate(entries) {
  const map = new Map();
  for (const e of sortEntries(entries)) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

// Kronolojik komşular (önceki = daha eski, sonraki = daha yeni)
export function neighbors(entries, id, date) {
  const asc = sortEntries(entries).reverse();
  const i = asc.findIndex((e) => e.id === id && e.date === date);
  if (i === -1) return { prev: null, next: null };
  return { prev: asc[i - 1] || null, next: asc[i + 1] || null };
}

// ---------- Günün rotası (duraklar) ----------

export const DEFAULT_SCHEDULE = {
  weekday: [
    { type: 'flas', time: '08:45' },
    { type: 'flas', time: '12:45' },
    { type: 'flas', time: '15:45' },
    { type: 'aksam', time: '18:57' },
  ],
  weekend: [{ type: 'aksam', time: '18:57' }],
};

// Bir yayın, planlanan saatten en fazla 15 dk önce / 120 dk sonra yayımlandıysa o durağa aittir.
const EARLY = 15;
const LATE = 120;
// Planlanan saatten sonra bu kadar dakika "hazırlanıyor" gösterilir.
const PREPARING_WINDOW = 45;

/**
 * Bir günün durak listesini üretir.
 * Her durak: { type, time, label, state: 'published'|'preparing'|'upcoming', entry? }
 * Geçmiş günlerde yalnızca yayımlanmış duraklar gösterilir.
 */
export function buildStops(dayEntries, dateStr, { schedule = DEFAULT_SCHEDULE, now = new Date() } = {}) {
  const ny = nyParts(now);
  const isToday = dateStr === ny.date;
  const nowMin = toMinutes(ny.time);
  const entries = [...dayEntries].sort((a, b) => a.time.localeCompare(b.time));
  const used = new Set();
  const stops = [];

  if (isToday) {
    const slots = (isWeekend(dateStr) ? schedule.weekend : schedule.weekday) || [];
    for (const slot of slots) {
      const sm = toMinutes(slot.time);
      const match = entries.find((e) => !used.has(e) && e.type === slot.type
        && toMinutes(e.time) >= sm - EARLY && toMinutes(e.time) <= sm + LATE);
      if (match) {
        used.add(match);
        continue; // yayımlananlar aşağıda eklenecek
      }
      if (nowMin < sm) stops.push({ type: slot.type, time: slot.time, label: roundLabel(slot.type, slot.time), state: 'upcoming' });
      else if (nowMin <= sm + PREPARING_WINDOW) stops.push({ type: slot.type, time: slot.time, label: roundLabel(slot.type, slot.time), state: 'preparing' });
      // süresi geçmiş ve yayımlanmamış duraklar gösterilmez
    }
  }
  for (const e of entries) {
    stops.push({ type: e.type, time: e.time, label: roundLabel(e.type, e.time), state: 'published', entry: e });
  }
  return stops.sort((a, b) => a.time.localeCompare(b.time));
}

// ---------- Yönlendirme ----------
// Claude sayfalarında yalnızca sade #çapa (harf, rakam, . _ ~ -) çalışır:
// '#bugun' (ya da boş), '#arsiv', '#g-2026-10-10', '#g-2026-10-10-flas-1245'
export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (h === 'arsiv') return { view: 'archive' };
  const m = h.match(/^g-(\d{4}-\d{2}-\d{2})(?:-((?:flas|aksam)-\d{4}))?$/);
  if (m) return { view: 'day', date: m[1], id: m[2] || null };
  return { view: 'today' };
}

export function issueHref(entry) {
  return `#g-${entry.date}-${entry.id}`;
}

export function dayHref(date) {
  return `#g-${date}`;
}

export function archiveHref() {
  return '#arsiv';
}

// ---------- Veri deposundan gelen belgeyi temizleme ----------
// Zamanlanmış görevler belgeleri doğrudan yazar; sayfa bozuk alanlara karşı dayanıklı olmalı.
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function docIdFor(date, id) {
  return `${date}_${id}`;
}

export function normalizeIssue(docId, raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const m = String(docId || '').match(/^(\d{4}-\d{2}-\d{2})_((flas|aksam)-(\d{2})(\d{2}))$/);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(d.date)) ? str(d.date) : (m ? m[1] : '');
  const type = ['flas', 'aksam'].includes(str(d.type)) ? str(d.type) : (m ? m[3] : '');
  const time = /^\d{2}:\d{2}$/.test(str(d.time)) ? str(d.time) : (m ? `${m[4]}:${m[5]}` : '');
  if (!date || !type || !time) return null;
  const id = `${type}-${time.replace(':', '')}`;
  const markets = (Array.isArray(d.markets) ? d.markets : [])
    .filter((x) => x && typeof x === 'object' && str(x.name))
    .map((x) => ({ name: str(x.name), level: str(x.level) || '—', chg: str(x.chg) || '—', note: str(x.note) }));
  const sections = (Array.isArray(d.sections) ? d.sections : [])
    .filter((s) => s && typeof s === 'object' && str(s.heading))
    .map((s) => ({
      heading: str(s.heading),
      items: (Array.isArray(s.items) ? s.items : [])
        .map((it) => (typeof it === 'string' ? { title: '', text: it.trim() } : { title: str(it && it.title), text: str(it && it.text) }))
        .filter((it) => it.title || it.text),
    }))
    .filter((s) => s.items.length);
  const sources = (Array.isArray(d.sources) ? d.sources : [])
    .filter((s) => s && typeof s === 'object' && safeUrl(s.url))
    .map((s) => ({ title: str(s.title), url: safeUrl(s.url) }));
  if (!markets.length && !sections.length) return null;  // içeriksiz belge gösterilmez
  const headlines = [];
  for (const s of sections) for (const it of s.items) headlines.push(it.title || it.text.slice(0, 90));
  return {
    docId, id, type, date, time,
    key: `${date}T${time}`,
    title: str(d.title), subtitle: str(d.subtitle),
    market_note: str(d.market_note), footer: str(d.footer),
    published_at: str(d.published_at),
    markets, sections, sources,
    headlines: headlines.slice(0, 12),
  };
}
