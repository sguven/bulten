import {
  TYPE_LABEL, TYPE_SHORT, DEFAULT_SCHEDULE,
  escapeHtml, inlineFormat, safeUrl, hostOf, stripTags, changeDirection,
  nyParts, formatDateLong, formatDateShort, monthLabel, relativeTime, roundLabel, splitUnverified,
  filterEntries, highlight, matchesQuery, sortEntries, groupByDate, neighbors, buildStops,
  parseRoute, issueHref, archiveHref, fold,
} from './lib.js';

const REFRESH_MS = 5 * 60 * 1000;
const DAYS_PER_PAGE = 10;

const state = {
  index: null,          // data/index.json
  schedule: DEFAULT_SCHEDULE,
  issues: new Map(),    // path -> issue JSON
  route: null,
  archiveDays: DAYS_PER_PAGE,
  seenLatest: null,
};

const main = document.getElementById('main');
const toast = document.getElementById('toast');

// ------------------------------------------------------------------ veri

async function fetchJson(url, { fresh = false } = {}) {
  const res = await fetch(url, { cache: fresh ? 'no-store' : 'default' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function loadIndex() {
  const idx = await fetchJson(`data/index.json?t=${Date.now()}`, { fresh: true });
  if (!idx || !Array.isArray(idx.entries)) throw new Error('index.json bozuk');
  idx.entries = sortEntries(idx.entries);
  return idx;
}

async function loadSchedule() {
  try {
    const site = await fetchJson(`data/site.json?t=${Date.now()}`, { fresh: true });
    if (site && site.schedule && Array.isArray(site.schedule.weekday)) state.schedule = site.schedule;
  } catch { /* the default schedule is used */ }
}

async function loadIssue(entry) {
  const key = `${entry.path}?v=${entry.published_at}`;
  if (!state.issues.has(key)) {
    state.issues.set(key, fetchJson(`${entry.path}?v=${encodeURIComponent(entry.published_at || '')}`)
      .catch((e) => { state.issues.delete(key); throw e; }));
  }
  return state.issues.get(key);
}

const entries = () => (state.index ? state.index.entries : []);
const entriesOn = (date) => entries().filter((e) => e.date === date);

// ------------------------------------------------------------------ small pieces

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

function updatedLine() {
  if (!state.index || !state.index.generated_at) return '';
  return `<span data-updated>Son güncelleme ${escapeHtml(relativeTime(state.index.generated_at))}</span>`;
}

// ------------------------------------------------------------------ route (the day's stops)

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

// ------------------------------------------------------------------ issue

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

async function fillIssue(slot, entry, token) {
  slot.innerHTML = '<p class="loading">Yayın yükleniyor…</p>';
  try {
    const doc = await loadIssue(entry);
    if (token !== renderToken) return;
    slot.innerHTML = issueHtml(entry, doc) + pagerHtml(entry);
  } catch (e) {
    if (token !== renderToken) return;
    slot.innerHTML = `<div class="callout callout--error" role="alert"><p><strong>Bu yayın yüklenemedi.</strong></p><p>Bağlantınızı kontrol edip yeniden deneyin.</p><button class="button" type="button" data-retry>Yeniden dene</button></div>`;
    slot.querySelector('[data-retry]').addEventListener('click', () => fillIssue(slot, entry, renderToken));
  }
}

// ------------------------------------------------------------------ views

let renderToken = 0;

function renderDay(date, id, { isToday }) {
  const token = ++renderToken;
  const day = entriesOn(date);
  const notFound = Boolean(id) && !day.some((e) => e.id === id);
  // day[0] = the day's latest issue; falls back to it if the requested issue doesn't exist
  const selected = (id && day.find((e) => e.id === id)) || day[0];

  const heading = isToday
    ? `<h1>Bugün</h1><div class="dayhead__meta"><span>${escapeHtml(formatDateLong(date))}</span>${updatedLine()}</div>`
    : `<h1>${escapeHtml(formatDateLong(date, { year: false }))}</h1><div class="dayhead__meta"><span>${date.slice(0, 4)}</span><a href="#/">Bugüne dön</a><a href="${archiveHref()}">Arşiv</a></div>`;

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

  if (shown) fillIssue(main.querySelector('[data-issue-slot]'), shown, token);
  setTitle(shown && day.length ? `${TYPE_LABEL[shown.type]} ${shown.time}, ${formatDateShort(shown.date)}` : isToday ? 'Bugün' : formatDateLong(date, { weekday: false }));
}

function archiveListHtml(route) {
  const list = filterEntries(entries(), { query: route.query, type: route.type });
  if (!entries().length) {
    return '<div class="empty"><strong>Arşiv boş.</strong>Yayınlar geldikçe burada gün gün listelenecek.</div>';
  }
  if (!list.length) {
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
      <div class="day__head"><h3><a href="#/g/${g.date}">${escapeHtml(formatDateLong(g.date, { year: false }))}</a></h3><span class="dots" aria-hidden="true">${dots}</span></div>
      <ul class="rows">${g.items.map((e) => rowHtml(e, route.query)).join('')}</ul>
    </section>`;
  }
  if (groups.length > visible.length) {
    html += `<div class="more"><button class="button button--quiet" type="button" data-more>Daha eski günleri göster</button></div>`;
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

function renderArchive(route, { keepTools = false } = {}) {
  ++renderToken;
  setTitle('Arşiv');
  const tools = main.querySelector('.archive-tools');
  if (!keepTools || !tools) {
    state.archiveDays = DAYS_PER_PAGE;
    main.innerHTML = `<div class="dayhead"><h1>Arşiv</h1><div class="dayhead__meta"><span>${entries().length} yayın</span>${updatedLine()}</div></div>
      <form class="archive-tools" role="search" onsubmit="return false">
        <div class="search">
          ${icon.search}
          <label class="visually-hidden" for="q">Başlıklarda ara</label>
          <input id="q" type="search" placeholder="Ara: dolar, Fed, Secaucus…" autocomplete="off" enterkeyhint="search" value="${escapeHtml(route.query)}">
          <button class="clear" type="button" aria-label="Aramayı temizle"${route.query ? '' : ' hidden'}>${icon.x}</button>
        </div>
        <fieldset class="segmented">
          <legend class="visually-hidden">Yayın türü</legend>
          ${[['all', 'Tümü'], ['flas', 'Flaş'], ['aksam', 'Akşam Bülteni']].map(([v, l]) => `<label><input type="radio" name="t" value="${v}"${route.type === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}
        </fieldset>
      </form>
      <div data-list></div>`;
    bindArchiveTools();
  }
  main.querySelector('[data-list]').innerHTML = archiveListHtml(route);
  const more = main.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { state.archiveDays += DAYS_PER_PAGE; renderArchive(parseRoute(location.hash), { keepTools: true }); });
}

function bindArchiveTools() {
  const input = main.querySelector('#q');
  const clear = main.querySelector('.clear');
  let timer;
  const apply = () => {
    const type = (main.querySelector('input[name="t"]:checked') || {}).value || 'all';
    const href = archiveHref({ query: input.value.trim(), type });
    history.replaceState(null, '', href);
    clear.hidden = !input.value;
    state.archiveDays = DAYS_PER_PAGE;
    renderArchive(parseRoute(href), { keepTools: true });
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 120); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { input.value = ''; apply(); } });
  clear.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
  main.querySelectorAll('input[name="t"]').forEach((r) => r.addEventListener('change', apply));
}

function renderError(err) {
  ++renderToken;
  console.error(err);
  main.innerHTML = `<div class="callout callout--error" role="alert">
    <p><strong>Yayınlar yüklenemedi.</strong></p>
    <p>Bağlantınızı kontrol edip yeniden deneyin.</p>
    <button class="button" type="button" data-retry>Yeniden dene</button>
  </div>`;
  main.querySelector('[data-retry]').addEventListener('click', () => boot());
}

// ------------------------------------------------------------------ routing

function render({ scroll = true } = {}) {
  const route = parseRoute(location.hash);
  const prev = state.route;
  state.route = route;
  setTab(route.view);
  const today = nyParts().date;
  if (route.view === 'archive') {
    renderArchive(route, { keepTools: prev && prev.view === 'archive' });
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

// On an issue page, ← → go to the previous/next issue
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

async function refresh() {
  try {
    const idx = await loadIndex();
    state.index = idx;
    const latest = idx.entries[0];
    if (latest && idx.latest !== state.seenLatest) {
      state.seenLatest = idx.latest;
      showToast(latest);
    }
    // Refresh the route and the "last updated" line in place; leave the issue being read alone.
    const r = state.route;
    if (r && r.view !== 'archive') {
      const date = r.view === 'day' ? r.date : nyParts().date;
      const slot = main.querySelector('[data-route]');
      const day = entriesOn(date);
      const shownId = main.querySelector('[data-issue]')?.dataset.issue;
      const sel = day.find((e) => e.id === (r.id || shownId));
      if (slot) slot.innerHTML = routeHtml(date, sel);
    }
    const upd = main.querySelector('[data-updated]');
    if (upd) upd.textContent = `Son güncelleme ${relativeTime(idx.generated_at)}`;
  } catch { /* quietly wait for the next attempt */ }
}

let timer;
function startRefresh() {
  clearInterval(timer);
  timer = setInterval(refresh, REFRESH_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.index) { refresh(); startRefresh(); }
});

// ------------------------------------------------------------------ start

async function boot() {
  main.innerHTML = '<p class="loading">Yükleniyor…</p>';
  try {
    const [idx] = await Promise.all([loadIndex(), loadSchedule()]);
    state.index = idx;
    state.seenLatest = idx.latest;
    render({ scroll: false });
    startRefresh();
  } catch (e) {
    renderError(e);
  }
}

// for tests and debugging
window.__gundem = { state, refresh, fold };

boot();
