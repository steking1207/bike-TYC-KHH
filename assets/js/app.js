import { INCIDENT_TYPES, esc, analyze, indexPlaces, fmtDur, fmtKm, ordinal, stayOf } from './ride.js';
import { mountRhythm } from './rhythm.js';
import { mountMap } from './map.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('[data-view]');
let DATA; let PLACES; let RIDES; // RIDES: newest first, each { ride, a }

async function load() {
  if (new URLSearchParams(location.search).has('preview')) {
    try {
      const d = JSON.parse(localStorage.getItem('tyc:draft') || 'null');
      if (d) { $('[data-preview-bar]').hidden = false; return d; }
    } catch (e) { /* fall through */ }
  }
  const res = await fetch(`data/rides.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`讀不到 data/rides.json（${res.status}）`);
  return res.json();
}

const incLabel = (x) => {
  const t = INCIDENT_TYPES[x.type] || INCIDENT_TYPES.other;
  return `${t.icon} ${x.who ? `${esc(x.who)} ` : ''}${t.label}${x.km != null ? ` @${fmtKm(x.km)}K` : ''}${x.minutes ? `（${fmtDur(x.minutes)}）` : ''}${x.note && x.note !== t.label ? `：${esc(x.note)}` : ''}`;
};
const placeLink = (p) => (p.map ? `<a class="pin" href="${esc(p.map)}" target="_blank" rel="noopener" title="Google 地圖">📍</a>` : '');
const timeOf = (s) => (s.arrive && s.depart ? `${s.arrive} → ${s.depart}` : s.arrive || s.depart || '');

function rhythmAndMap(items, extraTick) {
  const map = mountMap($('[data-mapbox]', view), items, PLACES);
  mountRhythm($('[data-rhythm]', view), items, { onTick: (pos) => { map.update(pos); if (extraTick) extraTick(pos); } });
}

/* 單次頁面：播放時，左側「沿途」標出目前所在的休息站或區段，並捲動到看得到的位置 */
function followList(pos) {
  const list = $('.tl', view); if (!list) return;
  const p = pos && pos[0];
  let key = null;
  if (p) key = p.state === 'ride' ? `seg-${p.idx}` : p.state === 'wait' ? 'stop-0' : `stop-${p.idx}`;
  list.querySelectorAll('.is-now').forEach((el) => { if (el.dataset.key !== key) el.classList.remove('is-now'); });
  list.querySelectorAll('[data-live]').forEach((el) => { if (el.closest('[data-key]').dataset.key !== key) el.hidden = true; });
  if (!key) return;
  const cur = list.querySelector(`[data-key="${key}"]`); if (!cur) return;
  if (!cur.classList.contains('is-now')) {
    cur.classList.add('is-now');
    const r = cur.getBoundingClientRect();
    const strip = $('.ride-rhythm', view); const topEdge = strip && getComputedStyle(strip).position === 'sticky' ? strip.getBoundingClientRect().bottom : 60;
    if (r.top < topEdge || r.bottom > innerHeight) scrollBy({ top: r.top - (topEdge + innerHeight) / 2 + r.height / 2, behavior: 'smooth' });
  }
  const live = cur.querySelector('[data-live]');
  if (live) { live.hidden = false; live.textContent = `🚴 ${fmtKm(p.km)} km · ${p.kmh != null ? Math.round(p.kmh) : '–'} km/h`; }
}

/* ---------- views ---------- */
function home() {
  const n = RIDES.length;
  const best = RIDES.reduce((b, r) => (r.a.total != null && (!b || r.a.total < b.a.total) ? r : b), null);
  const flats = RIDES.reduce((s, r) => s + r.a.incidents.filter((x) => x.type === 'flat').length, 0);
  const sumKm = RIDES.reduce((s, r) => s + (r.a.km || 0), 0);
  view.innerHTML = `
    <h1>${esc(DATA.title || '一日桃高')}</h1>
    <p class="lead">${esc(DATA.subtitle || '')}${n ? `　${RIDES[n - 1].ride.date.slice(0, 4)}–${RIDES[0].ride.date.slice(0, 4)}` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${n}</b><span>次完成</span></div>
      <div class="stat"><b>${best ? fmtDur(best.a.total) : '–'}</b><span>最快（${best ? ordinal(best.ride.no) : ''}）</span></div>
      <div class="stat"><b>${Math.round(sumKm).toLocaleString()}</b><span>累計公里</span></div>
      <div class="stat"><b>${flats}</b><span>次爆胎</span></div>
    </div>
    <h2>一天的節奏</h2>
    <div data-rhythm></div>
    <h2>路線地圖</h2>
    <div data-mapbox></div>
    <h2>每一次</h2>
    <div class="cards">${RIDES.map(({ ride, a }) => `
      <a class="card" href="#/ride/${ride.no}">
        <div class="card__head"><span class="card__no">${ordinal(ride.no)}</span><span class="card__date">${esc(ride.date)}</span></div>
        <div class="card__meta">👥 ${esc((ride.riders || []).join('、'))}<br>☀️ ${esc(ride.weather || '')}${ride.temp != null && ride.temp !== '' ? `　🌡️ ${esc(ride.temp)}°C` : ''}</div>
        <div class="card__nums">
          <div><b>${fmtDur(a.total)}</b>總時間</div>
          <div><b>${fmtDur(a.rest)}</b>休息</div>
          <div><b>${fmtKm(a.km)}</b>公里</div>
        </div>
        ${a.incidents.length ? `<div class="chips">${a.incidents.map((x) => `<span class="chip">${(INCIDENT_TYPES[x.type] || INCIDENT_TYPES.other).icon} ${x.who ? esc(x.who) : ''}${(INCIDENT_TYPES[x.type] || INCIDENT_TYPES.other).label}</span>`).join('')}</div>` : ''}
      </a>`).join('')}</div>`;
  rhythmAndMap(RIDES);
}

function rideView(no) {
  const i = RIDES.findIndex((r) => String(r.ride.no) === String(no));
  if (i < 0) { view.innerHTML = '<p>找不到這一次的紀錄。<a href="#/">回總覽</a></p>'; return; }
  const { ride, a } = RIDES[i];
  const stops = ride.stops;
  const items = [];
  stops.forEach((s, k) => {
    const p = a.place(s.place); const end = k === 0 || k === stops.length - 1;
    const info = [];
    if (k > 0 && k < stops.length - 1) info.push(`停留 ${stayOf(s)} 分`);
    info.push(`📍 ${fmtKm(s.km)} K`);
    if (k === stops.length - 1 && ride.train) info.push(`🚄 高鐵 ${esc(ride.train)}`);
    items.push(`<li class="tl-stop ${end ? 'is-end' : ''}" data-key="stop-${k}"><div class="tl-card">
      <div class="tl-card__row"><span class="tl-card__name">${esc(p.name)} ${placeLink(p)}</span>${p.sub ? `<span class="tl-card__sub">${esc(p.sub)}${p.closed ? '（已歇業）' : ''}</span>` : ''}<span class="tl-card__time">${timeOf(s)}</span></div>
      <div class="tl-card__info">${s.tag ? `<span class="badge">${esc(s.tag)}</span>` : ''}${info.map((t) => `<span>${t}</span>`).join('')}${s.note ? `<span>💬 ${esc(s.note)}</span>` : ''}</div>
      ${a.stopIncidents[k].map((x) => `<div class="tl-inc">${incLabel(x)}</div>`).join('')}
    </div></li>`);
    const seg = a.segments[k];
    if (seg) {
      const slow = seg.speed != null && seg.speed < 18;
      items.push(`<li class="tl-seg" data-key="seg-${k}"><span class="${slow ? 'slow' : ''}">${fmtKm(seg.km)} km · ${fmtDur(seg.min)} · ${seg.speed ? seg.speed.toFixed(1) : '–'} km/h</span><span class="tl-live" data-live hidden></span>${seg.incidents.map((x) => `<div class="tl-inc">${incLabel(x)}</div>`).join('')}</li>`);
    }
  });
  const prev = RIDES[i + 1]; const next = RIDES[i - 1];
  const links = ride.links || {};
  view.innerHTML = `
    <div class="ride-head"><h1>${ordinal(ride.no)}　<span class="num">${esc(ride.date)}</span></h1>
      <div class="links">${links.strava ? `<a class="btn" href="${esc(links.strava)}" target="_blank" rel="noopener">Strava ↗</a>` : ''}${links.gear ? `<a class="btn" href="${esc(links.gear)}" target="_blank" rel="noopener">裝備 ↗</a>` : ''}</div></div>
    <p class="lead">👥 ${esc((ride.riders || []).join('、'))}　☀️ ${esc(ride.weather || '')}${ride.temp != null && ride.temp !== '' ? `　🌡️ ${esc(ride.temp)}°C` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${fmtDur(a.total)}</b><span>總時間</span></div>
      <div class="stat"><b>${fmtDur(a.moving)}</b><span>騎乘（含路上狀況）</span></div>
      <div class="stat"><b>${fmtDur(a.rest)}</b><span>休息 ${stops.length - 2} 站</span></div>
      <div class="stat"><b>${fmtKm(a.km)}</b><span>公里</span></div>
      <div class="stat"><b>${a.avg ? a.avg.toFixed(1) : '–'}</b><span>km/h 平均</span></div>
    </div>
    <div class="ride-rhythm" data-rhythm></div>
    <div class="ride-cols"><div><h2>沿途</h2>
    <ol class="tl">${items.join('')}</ol></div>
    <div class="ride-cols__map"><h2>地圖</h2><div data-mapbox></div></div></div>
    <div class="pager">${prev ? `<a class="btn" href="#/ride/${prev.ride.no}">← ${ordinal(prev.ride.no)}</a>` : '<span></span>'}${next ? `<a class="btn" href="#/ride/${next.ride.no}">${ordinal(next.ride.no)} →</a>` : ''}</div>`;
  rhythmAndMap([RIDES[i]], followList);
}

let selected = null;
function compare() {
  if (!selected) {
    try { selected = new Set(JSON.parse(localStorage.getItem('tyc:cmp') || 'null')); } catch (e) { selected = null; }
    if (!selected || !selected.size || ![...selected].some((n) => RIDES.some((r) => r.ride.no === n))) selected = new Set(RIDES.map((r) => r.ride.no));
  }
  const cols = RIDES.filter((r) => selected.has(r.ride.no));
  const used = new Set(cols.flatMap((r) => r.ride.stops.map((s) => s.place)));
  const places = (DATA.places || []).filter((p) => used.has(p.id));
  const pos = Object.fromEntries(places.map((p, i) => [p.id, i]));
  const nRows = places.length * 2 - 1;
  // grid[c][row] = html | 'x' (covered by rowspan) | null (empty)
  const grid = cols.map(({ ride, a }) => {
    const g = Array(nRows).fill(null);
    ride.stops.forEach((s, k) => {
      const r = pos[s.place] * 2;
      const stay = k > 0 && k < ride.stops.length - 1 ? `<span class="s">停留 ${stayOf(s)} 分</span>` : '';
      g[r] = { html: `<span class="t">${timeOf(s)}</span>${stay}<span class="s">📍 ${fmtKm(s.km)} K</span>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}${s.note ? `<span class="note">💬 ${esc(s.note)}</span>` : ''}${k === ride.stops.length - 1 && ride.train ? `<span class="s">🚄 ${esc(ride.train)}</span>` : ''}${a.stopIncidents[k].map((x) => `<span class="note">${incLabel(x)}</span>`).join('')}` };
      const seg = a.segments[k];
      if (seg) {
        const r0 = r + 1; const span = (pos[seg.to.place] - pos[s.place]) * 2 - 1;
        g[r0] = { html: `${fmtKm(seg.km)} km · ${fmtDur(seg.min)}<br>${seg.speed ? seg.speed.toFixed(1) : '–'} km/h${seg.incidents.map((x) => `<span class="note">${incLabel(x)}</span>`).join('')}`, span };
        for (let j = 1; j < span; j += 1) g[r0 + j] = 'x';
      }
    });
    return g;
  });
  let body = '';
  for (let r = 0; r < nRows; r += 1) {
    const isSeg = r % 2 === 1; const p = places[Math.floor(r / 2)];
    const head = isSeg ? '<th class="loc segh">區段</th>' : `<th class="loc">${esc(p.name)} ${placeLink(p)}${p.sub ? `<small>${esc(p.sub)}${p.closed ? '（已歇業）' : ''}</small>` : ''}</th>`;
    const cells = grid.map((g) => { const c = g[r]; if (c === 'x') return ''; if (!c) return '<td></td>'; return `<td${c.span > 1 ? ` rowspan="${c.span}"` : ''}>${c.html}</td>`; }).join('');
    body += `<tr class="${isSeg ? 'seg' : ''}">${head}${cells}</tr>`;
  }
  body += `<tr class="sum"><th class="loc">總計</th>${cols.map(({ a }) => `<td>⏱ ${fmtDur(a.total)}<br>☕ ${fmtDur(a.rest)}<br>📍 ${fmtKm(a.km)} K</td>`).join('')}</tr>`;
  view.innerHTML = `
    <h1>比較表</h1>
    <p class="lead">點選要比較的場次。灰色列是兩站之間的距離、時間與均速；沒停的站會併在區段裡。</p>
    <div class="toggles">${RIDES.map(({ ride }) => `<button class="toggle" type="button" data-no="${ride.no}" aria-pressed="${selected.has(ride.no)}">${ordinal(ride.no)} ${ride.date.slice(0, 4)}</button>`).join('')}
      <button class="toggle" type="button" onclick="window.print()">🖨️ 列印</button></div>
    ${cols.length ? `<div class="table-wrap"><table class="cmp"><thead><tr><th class="loc">地點</th>${cols.map(({ ride }) => `<th><a href="#/ride/${ride.no}">${ordinal(ride.no)}</a><br><span class="s num">${esc(ride.date)}</span></th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="muted">請至少選一次。</p>'}`;
  view.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.no); if (selected.has(n)) selected.delete(n); else selected.add(n);
    try { localStorage.setItem('tyc:cmp', JSON.stringify([...selected])); } catch (e) { /* noop */ }
    compare();
  }));
}

function route() {
  const [, page, arg] = (location.hash || '#/').split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', false));
  const nav = page === 'compare' ? 'compare' : page ? '' : 'home';
  if (nav) document.querySelector(`[data-nav="${nav}"]`).setAttribute('aria-current', 'page');
  if (page === 'ride') rideView(arg); else if (page === 'compare') compare(); else home();
  document.title = `${DATA.title || '一日桃高'}${page === 'ride' ? ` · ${ordinal(Number(arg))}` : page === 'compare' ? ' · 比較表' : ''}`;
  window.scrollTo(0, 0);
}

load().then((d) => {
  DATA = d; PLACES = indexPlaces(d);
  RIDES = [...(d.rides || [])].filter((r) => !r.hidden).sort((x, y) => y.no - x.no).map((ride) => ({ ride, a: analyze(ride, PLACES) }));
  $('[data-title]').textContent = d.title || '一日桃高';
  addEventListener('hashchange', route); route();
}).catch((err) => { view.innerHTML = `<p>${esc(err.message)}</p><p class="muted">在本機預覽要先啟動伺服器，例如在資料夾執行 <code>python3 -m http.server</code>。</p>`; });
