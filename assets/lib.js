// Pure helper functions — don't touch the DOM, imported directly by the Node tests.

export const TZ = 'America/New_York';

export const TYPE_LABEL = { flas: 'Gün İçi Flaş', aksam: 'Akşam Bülteni' };
export const TYPE_SHORT = { flas: 'Flaş', aksam: 'Akşam' };

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz',
  'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// ---------- HTML safety ----------

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITY[e]);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Turns text into safe HTML; only allows the <b>, <strong>, <i>, <em>, <br> tags.
export function inlineFormat(s) {
  const safe = escapeHtml(decodeEntities(s)).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  // Reopen the allowed tags; drop closing tags without a match, close any left open.
  const stack = [];
  const out = safe.replace(/&lt;(\/?)(b|strong|i|em)&gt;/gi, (_, slash, raw) => {
    const tag = raw.toLowerCase();
    if (!slash) { stack.push(tag); return `<${tag}>`; }
    const at = stack.lastIndexOf(tag);
    if (at === -1) return '';
    const closing = stack.splice(at).reverse().map((t) => `</${t}>`).join('');
    // instead of closing and reopening nested open tags we only close them
    return closing;
  });
  return out + stack.reverse().map((t) => `</${t}>`).join('');
}

export function stripTags(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ''));
}

// Only allow http(s) links.
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

// ---------- Market change ----------

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

// ---------- Date / time (New York) ----------

// Returns the date and time in New York for the given moment: { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 }
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

// like "10 Ekim 2026, Cumartesi"
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

// "12 dk önce", "3 saat önce", "dün" … (12 min ago, 3 hours ago, yesterday)
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

// ---------- Issue labels ----------

export function roundLabel(type, time) {
  if (type === 'aksam') return 'Akşam Bülteni';
  const m = toMinutes(time);
  if (m < 11 * 60) return 'Açılış öncesi';
  if (m < 14 * 60 + 30) return 'Öğle';
  return 'Kapanışa doğru';
}

// splits off the "(doğrulanmadı)" (unverified) suffix
export function splitUnverified(title) {
  const s = String(title ?? '').trim();
  const re = /\s*\((doğrulanmadı|dogrulanmadi|doğrulanmamış)\)\s*\.?$/i;
  return re.test(s) ? { text: s.replace(re, ''), unverified: true } : { text: s, unverified: false };
}

// ---------- Arama ----------

// Ignores Turkish upper/lower case and diacritic differences: "İstanbul" ~ "istanbul" ~ "Istanbul"
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

// Marks matching parts with <mark> (the text is escaped first)
export function highlight(text, query) {
  const raw = String(text ?? '');
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return escapeHtml(raw);
  const folded = fold(raw);
  // Does fold() keep the number of characters? If it doesn't, skip highlighting.
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

// ---------- Sorting / grouping ----------

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

// Chronological neighbours (previous = older, next = newer)
export function neighbors(entries, id, date) {
  const asc = sortEntries(entries).reverse();
  const i = asc.findIndex((e) => e.id === id && e.date === date);
  if (i === -1) return { prev: null, next: null };
  return { prev: asc[i - 1] || null, next: asc[i + 1] || null };
}

// ---------- The day's route (stops) ----------

export const DEFAULT_SCHEDULE = {
  weekday: [
    { type: 'flas', time: '08:45' },
    { type: 'flas', time: '12:45' },
    { type: 'flas', time: '15:45' },
    { type: 'aksam', time: '18:57' },
  ],
  weekend: [{ type: 'aksam', time: '18:57' }],
};

// An issue belongs to a stop if it was published at most 15 min before / 120 min after the planned time.
const EARLY = 15;
const LATE = 120;
// For this many minutes after the planned time the stop shows "preparing".
const PREPARING_WINDOW = 45;

/**
 * Builds the list of stops for a day.
 * Each stop: { type, time, label, state: 'published'|'preparing'|'upcoming', entry? }
 * On past days only published stops are shown.
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
        continue; // published ones are added below
      }
      if (nowMin < sm) stops.push({ type: slot.type, time: slot.time, label: roundLabel(slot.type, slot.time), state: 'upcoming' });
      else if (nowMin <= sm + PREPARING_WINDOW) stops.push({ type: slot.type, time: slot.time, label: roundLabel(slot.type, slot.time), state: 'preparing' });
      // stops whose time has passed without an issue are not shown
    }
  }
  for (const e of entries) {
    stops.push({ type: e.type, time: e.time, label: roundLabel(e.type, e.time), state: 'published', entry: e });
  }
  return stops.sort((a, b) => a.time.localeCompare(b.time));
}

// ---------- Routing ----------

// '#/', '#/arsiv?q=dolar&t=flas', '#/g/2026-10-10', '#/g/2026-10-10/flas-1245'
export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const [path, qs = ''] = h.split('?');
  const params = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'arsiv') {
    return { view: 'archive', query: params.get('q') || '', type: ['flas', 'aksam'].includes(params.get('t')) ? params.get('t') : 'all' };
  }
  if (parts[0] === 'g' && /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '')) {
    const id = parts[2] && /^(flas|aksam)-\d{4}$/.test(parts[2]) ? parts[2] : null;
    return { view: 'day', date: parts[1], id };
  }
  return { view: 'today' };
}

export function issueHref(entry) {
  return `#/g/${entry.date}/${entry.id}`;
}

export function archiveHref({ query = '', type = 'all' } = {}) {
  const p = new URLSearchParams();
  if (query) p.set('q', query);
  if (type && type !== 'all') p.set('t', type);
  const s = p.toString();
  return `#/arsiv${s ? `?${s}` : ''}`;
}
