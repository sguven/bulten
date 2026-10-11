import {
  TYPE_LABEL, TYPE_SHORT, DEFAULT_SCHEDULE,
  escapeHtml, inlineFormat, safeUrl, hostOf, stripTags, changeDirection,
  nyParts, formatDateLong, formatDateShort, monthLabel, relativeTime, roundLabel, splitUnverified,
  filterEntries, highlight, matchesQuery, sortEntries, groupByDate, neighbors, buildStops,
  parseRoute, issueHref, archiveHref, dayHref, fold, normalizeIssue,
} from './lib.js';

const DAYS_PER_PAGE = 10;
const PAGE_SIZE = 300;      // ilk yüklemede ~75 günlük yayın
const COLLECTION = 'issues';

const state = {
  known: new Map(),         // docId -> normalizeIssue çıktısı (canlı pencere + yüklenen eski yayınlar)
  windowIds: new Set(),     // son canlı anlık görüntüdeki belgeler
  olderDone: false,
  schedule: DEFAULT_SCHEDULE,
  route: null,
  archive: { query: '', type: 'all' },
  archiveDays: DAYS_PER_PAGE,
  latestKey: null,
  loaded: false,
  db: null,
};

// Claude sayfa iskeletinde html etiketinin lang özelliği yok; ekran okuyucular ve tireleme için Türkçe olduğunu belirt
document.documentElement.lang = 'tr';

const main = document.getElementById('main');
const toast = document.getElementById('toast');

// ------------------------------------------------------------------ veri

function toEntries(docs) {
  const out = [];
  for (const d of docs) {
    const e = normalizeIssue(d.id, d.data());
    if (e) out.push(e);
  }
  return out;
}

function allEntries() {
  return sortEntries([...state.known.values()]);
}

// Canlı pencere (en yeni PAGE_SIZE yayın) değiştiğinde: penceredeki belgeleri güncelle,
// penceredeyken silinenleri çıkar, pencereden aşağı kayanları (ör. "eski yayınları yükle"
// ile gelmiş olanları) koru.
function applyWindow(list) {
  const ids = new Set(list.map((e) => e.docId));
  const floor = list.length ? list[list.length - 1].key : '';
  for (const [docId, e] of state.known) {
    if (!ids.has(docId) && state.windowIds.has(docId) && (!floor || e.key >= floor || list.length < PAGE_SIZE)) {
      state.known.delete(docId);
    }
  }
  for (const e of list) state.known.set(e.docId, e);
  state.windowIds = ids;
}

let cachedAll = null;
const entries = () => cachedAll || (cachedAll = allEntries());
const entriesOn = (date) => entries().filter((e) => e.date === date);
function invalidate() { cachedAll = null; }

async function loadOlder() {
  const list = entries();
  const oldest = list[list.length - 1];
  if (!oldest || !state.db) { state.olderDone = true; return; }
  const snap = await state.db.collection(COLLECTION).where('key', '<', oldest.key).orderBy('key', 'desc').limit(PAGE_SIZE).get();
  const more = toEntries(snap.docs);
  for (const e of more) if (!state.known.has(e.docId)) state.known.set(e.docId, e);
  if (more.length < PAGE_SIZE) state.olderDone = true;
  invalidate();
}

// ------------------------------------------------------------------ küçük parçalar

const icon = {
  chevL: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevR: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevD: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

function pill(type) {
  return `<span class="pill pill--${type}">${TYPE_SHORT[type] || escapeHtml(type)}</span>`;
}

function setTitle(t) {
  document.title = t ? `${t} — Gündem` : 'Gündem';
}

function setTab(view) {
  document.querySelectorAll('.tab').forEach((a) => {
    const on = (view === 'archive' && a.dataset.tab === 'archive') || (view !== 'archive' && a.dataset.tab === 'today' && view === 'today');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function lastPublished() {
  const e = entries()[0];
  return e && e.published_at ? e.published_at : '';
}

function updatedLine() {
  const t = lastPublished();
  if (!t) return '';
  return `<span data-updated>Son yayın ${escapeHtml(relativeTime(t))}</span>`;
}

// ------------------------------------------------------------------ rota (günün durakları)

function routeHtml(date, selected) {
  const stops = buildStops(entriesOn(date), date, { schedule: state.schedule });
  if (!stops.length) return '';
  const lis = stops.map((s, i) => {
    const next = stops[i + 1];
    const cur = selected && s.entry && s.entry.id === selected.id;
    const stateText = s.state === 'upcoming' ? 'bekleniyor' : s.state === 'preparing' ? 'hazırlanıyor' : '';
    const label = s.state === 'preparing' ? 'Hazırlanıyor' : s.label;
    const inner = `<span class="stop__dot" aria-hidden="true"></span>
        <span class="stop__time">${escapeHtml(s.time)}</span>
        <span class="stop__label">${escapeHtml(label)}</span>`;
    const body = s.entry
      ? `<a class="stop__link" href="${issueHref(s.entry)}" aria-label="${escapeHtml(`${TYPE_LABEL[s.type]}, ${s.time}`)}${cur ? ' (açık)' : ''}">${inner}</a>`
      : `<div class="stop__link" aria-label="${escapeHtml(`${TYPE_LABEL[s.type]}, ${s.time}, ${stateText}`)}">${inner}</div>`;
    return `<li class="stop" data-state="${s.state}" data-type="${s.type}"${next ? ` data-next="${next.state}"` : ''}${cur ? ' aria-current="true"' : ''}>${body}</li>`;
  }).join('');
  return `<nav class="route" aria-label="Günün yayınları"><ol>${lis}</ol></nav>`;
}

// ------------------------------------------------------------------ yayın

function marketsHtml(markets) {
  if (!markets || !markets.length) return '';
  const rows = markets.map((m) => {
    const dir = changeDirection(m.chg);
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
    const dirText = dir === 'up' ? 'yükseliş' : dir === 'down' ? 'düşüş' : dir === 'flat' ? 'değişim yok' : 'veri yok';
    return `<tr>
      <td class="asset">${escapeHtml(m.name)}${m.note ? `<span class="note">${inlineFormat(m.note)}</span>` : ''}</td>
      <td class="num">${escapeHtml(m.level || '—')}</td>
      <td class="num"><span class="chg chg--${dir}"><span class="chg__arrow" aria-hidden="true">${arrow}</span>${escapeHtml(m.chg || '—')}<span class="visually-hidden"> ${dirText}</span></span></td>
    </tr>`;
  }).join('');
  return `<table class="markets">
      <thead><tr><th scope="col">Varlık</th><th scope="col" class="num">Seviye</th><th scope="col" class="num">Değişim</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function itemHtml(it) {
  const { text: title, unverified } = splitUnverified(it.title);
  const tag = unverified ? '<span class="tag" title="Bu iddia teyit edilmedi">doğrulanmadı</span>' : '';
  const t = title ? `<p class="item__title">${inlineFormat(title)}${tag}</p>` : '';
  const body = it.text ? `<p class="item__text">${inlineFormat(it.text)}${!title && tag ? tag : ''}</p>` : '';
  return `<li class="item">${t}${body}</li>`;
}

function sourcesHtml(sources) {
  const list = (sources || []).filter((s) => safeUrl(s.url));
  if (!list.length) return '';
  const lis = list.map((s) => `<li><a href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(stripTags(s.title) || hostOf(s.url))}</a><span class="host">${escapeHtml(hostOf(s.url))}</span></li>`).join('');
  return `<details class="block sources"><summary>Kaynaklar <span class="count">${list.length}</span>${icon.chevD}</summary><ul>${lis}</ul></details>`;
}

function issueHtml(entry, doc) {
  const round = entry.type === 'flas' ? `<span>${escapeHtml(roundLabel(entry.type, entry.time))}</span>` : '';
  const sections = (doc.sections || []).filter((s) => s.items && s.items.length).map((s) => `
    <section class="block" aria-label="${escapeHtml(stripTags(s.heading))}">
      <h3>${inlineFormat(s.heading)}</h3>
      <ul class="items">${s.items.map(itemHtml).join('')}</ul>
    </section>`).join('');
  const marketsBlock = (doc.markets && doc.markets.length) || doc.market_note ? `
    <section class="block" aria-label="Piyasalar">
      <h3>Piyasalar</h3>
      ${marketsHtml(doc.markets)}
      ${doc.market_note ? `<p class="market-note">${inlineFormat(doc.market_note)}</p>` : ''}
    </section>` : '';
  return `<article class="issue" data-issue="${escapeHtml(entry.id)}">
    <div class="kicker"><strong><time datetime="${escapeHtml(`${entry.date}T${entry.time}`)}">${escapeHtml(entry.time)} ET</time></strong>${round}<span>${escapeHtml(formatDateLong(entry.date, { year: false }))}</span></div>
    <h2 class="issue__title">${TYPE_LABEL[entry.type]}</h2>
    ${doc.subtitle ? `<p class="issue__sub">${inlineFormat(doc.subtitle)}</p>` : ''}
    ${marketsBlock}
    ${sections}
    ${sourcesHtml(doc.sources)}
    ${doc.footer ? `<p class="issue__foot">${inlineFormat(doc.footer)}</p>` : ''}
  </article>`;
}

function pagerHtml(entry) {
  const { prev, next } = neighbors(entries(), entry.id, entry.date);
  if (!prev && !next) return '';
  const desc = (e) => `${TYPE_SHORT[e.type]} ${e.time}, ${formatDateShort(e.date)}`;
  return `<nav class="pager" aria-label="Diğer yayınlar">
    ${prev ? `<a class="pager__prev" href="${issueHref(prev)}" rel="prev"><span class="dir">${icon.chevL}Önceki</span><span class="what">${escapeHtml(desc(prev))}</span></a>` : ''}
    ${next ? `<a class="pager__next" href="${issueHref(next)}" rel="next"><span class="dir">Sonraki${icon.chevR}</span><span class="what">${escapeHtml(desc(next))}</span></a>` : ''}
  </nav>`;
}

function fillIssue(slot, entry) {
  slot.innerHTML = issueHtml(entry, entry) + pagerHtml(entry);
}

// ------------------------------------------------------------------ görünümler

let renderToken = 0;

function renderDay(date, id, { isToday }) {
  ++renderToken;
  const day = entriesOn(date);
  const notFound = Boolean(id) && !day.some((e) => e.id === id);
  // day[0] = günün en son yayını; istenen yayın yoksa ona düşülür
  const selected = (id && day.find((e) => e.id === id)) || day[0];

  const heading = isToday
    ? `<h1>Bugün</h1><div class="dayhead__meta"><span>${escapeHtml(formatDateLong(date))}</span>${updatedLine()}</div>`
    : `<h1>${escapeHtml(formatDateLong(date, { year: false }))}</h1><div class="dayhead__meta"><span>${date.slice(0, 4)}</span><a href="#bugun">Bugüne dön</a><a href="${archiveHref()}">Arşiv</a></div>`;

  let notice = '';
  let shown = selected;
  if (notFound) {
    notice = `<div class="callout" role="status"><p><strong>Bu yayın bulunamadı.</strong> ${day.length ? 'Bu günün diğer yayınları aşağıda.' : ''}</p></div>`;
  }
  if (!day.length) {
    const latest = entries()[0];
    if (isToday) {
      const upcoming = buildStops([], date, { schedule: state.schedule }).find((s) => s.state !== 'published');
      notice += `<div class="callout"><p><strong>Bugün henüz yayın yok.</strong>${upcoming ? ` Sıradaki: ${escapeHtml(TYPE_LABEL[upcoming.type])}, ${escapeHtml(upcoming.time)}.` : ''}</p>${latest ? '<p>En son yayın aşağıda.</p>' : ''}</div>`;
      shown = latest || null;
    } else {
      notice += `<div class="empty"><strong>${escapeHtml(formatDateLong(date))} tarihinde yayın yok.</strong>Arşivden başka bir gün seçebilirsiniz.<p><a class="button button--quiet" href="${archiveHref()}">Arşive git</a></p></div>`;
      shown = null;
    }
  }
  if (!entries().length) {
    notice = `<div class="empty"><strong>Henüz yayın yok.</strong>İlk Gün İçi Flaş ya da Akşam Bülteni yayımlandığında burada görünecek.</div>`;
    shown = null;
  }

  main.innerHTML = `<div class="dayhead">${heading}</div>
    <div data-route>${routeHtml(date, selected)}</div>
    ${notice}
    <div data-issue-slot></div>`;

  if (shown) fillIssue(main.querySelector('[data-issue-slot]'), shown);
  setTitle(shown && day.length ? `${TYPE_LABEL[shown.type]} ${shown.time}, ${formatDateShort(shown.date)}` : isToday ? 'Bugün' : formatDateLong(date, { weekday: false }));
}

function archiveListHtml(route) {
  const list = filterEntries(entries(), { query: route.query, type: route.type });
  const olderBtn = state.olderDone ? '' : `<div class="more"><button class="button button--quiet" type="button" data-older>Daha eski yayınları yükle</button></div>`;
  if (!entries().length) {
    return '<div class="empty"><strong>Arşiv boş.</strong>Yayınlar geldikçe burada gün gün listelenecek.</div>';
  }
  if (!list.length) {
    if (!state.olderDone && route.query) {
      return `<div class="empty"><strong>“${escapeHtml(route.query)}” için yüklü yayınlarda sonuç yok.</strong>Daha eski yayınlarda da aramak için onları yükleyin.</div>${olderBtn}`;
    }
    const q = route.query ? `“${escapeHtml(route.query)}” için sonuç yok.` : 'Bu filtrede yayın yok.';
    return `<div class="empty"><strong>${q}</strong>${route.type !== 'all' ? 'Filtreyi “Tümü” yapın ya da farklı bir kelime deneyin.' : 'Farklı bir kelime deneyin.'}</div>`;
  }
  const groups = groupByDate(list);
  const visible = groups.slice(0, state.archiveDays);
  let html = `<p class="result-count" aria-live="polite">${list.length} yayın, ${groups.length} gün</p>`;
  let month = '';
  for (const g of visible) {
    const m = monthLabel(g.date);
    if (m !== month) { html += `<h2 class="month">${escapeHtml(m)}</h2>`; month = m; }
    const dots = entriesOn(g.date).slice().reverse().map((e) => `<i class="${e.type === 'aksam' ? 'sq' : ''}"></i>`).join('');
    html += `<section class="day" aria-label="${escapeHtml(formatDateLong(g.date))}">
      <div class="day__head"><h3><a href="${dayHref(g.date)}">${escapeHtml(formatDateLong(g.date, { year: false }))}</a></h3><span class="dots" aria-hidden="true">${dots}</span></div>
      <ul class="rows">${g.items.map((e) => rowHtml(e, route.query)).join('')}</ul>
    </section>`;
  }
  if (groups.length > visible.length) {
    html += `<div class="more"><button class="button button--quiet" type="button" data-more>Daha eski günleri göster</button></div>`;
  } else {
    html += olderBtn;
  }
  return html;
}

function rowHtml(e, query) {
  const heads = e.headlines || [];
  let lead = heads[0] || e.subtitle || TYPE_LABEL[e.type];
  if (query) {
    const hit = heads.find((h) => matchesQuery({ headlines: [h] }, query));
    if (hit) lead = hit;
  }
  const leadText = splitUnverified(stripTags(lead)).text;
  const extra = heads.length > 1 ? `<span>+${heads.length - 1} başlık</span>` : '';
  return `<li class="row"><a href="${issueHref(e)}">
    <span class="t">${escapeHtml(e.time)}</span>
    <span class="h">${highlight(leadText, query)}</span>
    <span class="m">${pill(e.type)}${extra}</span>
  </a></li>`;
}

function renderArchive({ keepTools = false } = {}) {
  ++renderToken;
  setTitle('Arşiv');
  const route = state.archive;
  const tools = main.querySelector('.archive-tools');
  if (!keepTools || !tools) {
    state.archiveDays = DAYS_PER_PAGE;
    main.innerHTML = `<div class="dayhead"><h1>Arşiv</h1><div class="dayhead__meta"><span data-count>${entries().length} yayın</span>${updatedLine()}</div></div>
      <form class="archive-tools" role="search">
        <div class="search">
          ${icon.search}
          <label class="visually-hidden" for="q">Başlıklarda ara</label>
          <input id="q" type="search" placeholder="Ara: dolar, Fed, Secaucus…" autocomplete="off" enterkeyhint="search" value="${escapeHtml(route.query)}">
          <button class="clear" type="button" aria-label="Aramayı temizle"${route.query ? '' : ' hidden'}>${icon.x}</button>
        </div>
        <fieldset class="segmented">
          <legend class="visually-hidden">Yayın türü</legend>
          ${[['all', 'Tümü', 't-all'], ['flas', 'Flaş', 't-flas'], ['aksam', 'Akşam Bülteni', 't-aksam']].map(([v, l, id]) => `<label><input type="radio" id="${id}" name="t" value="${v}"${route.type === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}
        </fieldset>
      </form>
      <div data-list></div>`;
    bindArchiveTools();
  } else {
    const c = main.querySelector('[data-count]');
    if (c) c.textContent = `${entries().length} yayın`;
  }
  main.querySelector('[data-list]').innerHTML = archiveListHtml(route);
  const more = main.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { state.archiveDays += DAYS_PER_PAGE; renderArchive({ keepTools: true }); });
  const older = main.querySelector('[data-older]');
  if (older) older.addEventListener('click', async () => {
    older.disabled = true; older.textContent = 'Yükleniyor…';
    try { await loadOlder(); } catch { older.disabled = false; older.textContent = 'Yüklenemedi, yeniden dene'; return; }
    state.archiveDays += DAYS_PER_PAGE;
    renderArchive({ keepTools: true });
  });
}

function bindArchiveTools() {
  const form = main.querySelector('.archive-tools');
  const input = main.querySelector('#q');
  const clear = main.querySelector('.clear');
  let timer;
  const apply = () => {
    const type = (main.querySelector('input[name="t"]:checked') || {}).value || 'all';
    state.archive = { query: input.value.trim(), type };
    clear.hidden = !input.value;
    state.archiveDays = DAYS_PER_PAGE;
    renderArchive({ keepTools: true });
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 120); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { input.value = ''; apply(); } });
  clear.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
  main.querySelectorAll('input[name="t"]').forEach((r) => r.addEventListener('change', apply));
}

function renderError(kind) {
  ++renderToken;
  const msg = kind === 'nodb'
    ? '<p><strong>Yayınlar bu görünümde açılamıyor.</strong></p><p>Sayfayı claude.ai\'de, hesabınızla giriş yapmışken açın.</p>'
    : '<p><strong>Yayınlar yüklenemedi.</strong></p><p>Bağlantınızı kontrol edip yeniden deneyin.</p><button class="button" type="button" data-retry>Yeniden dene</button>';
  main.innerHTML = `<div class="callout callout--error" role="alert">${msg}</div>`;
  const r = main.querySelector('[data-retry]');
  if (r) r.addEventListener('click', () => boot());
}

// ------------------------------------------------------------------ yönlendirme

function render({ scroll = true } = {}) {
  const route = parseRoute(location.hash);
  const prev = state.route;
  state.route = route;
  setTab(route.view);
  const today = nyParts().date;
  if (!state.loaded) return;
  if (route.view === 'archive') {
    renderArchive({ keepTools: prev && prev.view === 'archive' });
  } else if (route.view === 'day') {
    renderDay(route.date, route.id, { isToday: route.date === today });
    setTab(route.date === today ? 'today' : 'day');
  } else {
    renderDay(today, null, { isToday: true });
  }
  if (scroll && !(prev && prev.view === 'archive' && route.view === 'archive')) {
    window.scrollTo(0, 0);
  }
}

window.addEventListener('hashchange', () => {
  hideToast();
  render();
  if (state.route.view !== 'archive') main.focus({ preventScroll: true });
});

// Yayın sayfasında ← → ile önceki/sonraki yayın
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  const link = e.key === 'ArrowLeft' ? main.querySelector('a[rel="prev"]') : e.key === 'ArrowRight' ? main.querySelector('a[rel="next"]') : null;
  if (link) { e.preventDefault(); location.hash = link.getAttribute('href'); }
});

// ------------------------------------------------------------------ otomatik yenileme

function showToast(entry) {
  toast.querySelector('.toast__text').textContent = `Yeni yayın: ${TYPE_LABEL[entry.type]}, ${entry.time}`;
  toast.querySelector('.toast__action').setAttribute('href', issueHref(entry));
  toast.hidden = false;
}
function hideToast() { toast.hidden = true; }
toast.querySelector('.toast__close').addEventListener('click', hideToast);

// Yeni yayın geldiğinde: okunan yayına dokunmadan rotayı ve sayaçları tazele, bildirim göster.
function onData() {
  const latest = entries()[0];
  const key = latest ? latest.key : null;
  const first = !state.loaded;
  state.loaded = true;
  if (first) {
    state.latestKey = key;
    render({ scroll: false });
    return;
  }
  if (key && key !== state.latestKey && (!state.latestKey || key > state.latestKey)) {
    state.latestKey = key;
    showToast(latest);
  }
  const r = state.route;
  if (r && r.view === 'archive') { renderArchive({ keepTools: true }); return; }
  if (r) {
    const shown = main.querySelector('[data-issue]');
    if (!shown || (r.view === 'day' && r.id && !shown)) { render({ scroll: false }); return; }
    const date = r.view === 'day' ? r.date : nyParts().date;
    const slot = main.querySelector('[data-route]');
    const day = entriesOn(date);
    const sel = day.find((e) => e.id === (r.id || shown.dataset.issue));
    if (slot) slot.innerHTML = routeHtml(date, sel);
    const upd = main.querySelector('[data-updated]');
    if (upd) upd.textContent = `Son yayın ${relativeTime(lastPublished())}`;
  }
}

let unsubscribe = null;

async function boot() {
  main.innerHTML = '<p class="loading">Yükleniyor…</p>';
  state.loaded = false;
  const db = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('db') : null;
  if (!db) { renderError('nodb'); return; }
  state.db = db;
  if (unsubscribe) unsubscribe();
  state.known = new Map(); state.windowIds = new Set(); state.olderDone = false;
  unsubscribe = db.collection(COLLECTION).orderBy('key', 'desc').limit(PAGE_SIZE).onSnapshot((snap) => {
    applyWindow(toEntries(snap.docs));
    if (snap.size < PAGE_SIZE) state.olderDone = true;
    invalidate();
    onData();
  }, (err) => {
    console.error('db', err && err.code);
    renderError('load');
  });
}

// "Son yayın … önce" ifadesini dakikada bir tazele
setInterval(() => {
  const upd = main.querySelector('[data-updated]');
  if (upd && lastPublished()) upd.textContent = `Son yayın ${relativeTime(lastPublished())}`;
}, 60000);

// test ve hata ayıklama için
window.__gundem = { state, fold };

boot();
