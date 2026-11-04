import { INCIDENT_TYPES, esc, analyze, indexPlaces, fmtDur, fmtKm, ordinal, stayOf, toMin } from './ride.js';
import { mountRhythm, rideColor, sunTimes, splitByPeriod } from './rhythm.js';
import { mountMap } from './map.js';
import { loadTrack } from './track.js';
import { mountAeroBackdrop } from './aeroui.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('[data-view]');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

/* ---------- small helpers ---------- */
const ICON = {
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out: '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11l6-6M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-7.9A4.5 4.5 0 0 0 3.5 6.6c0 3.7 4.5 7.9 4.5 7.9z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6.6" r="1.6" fill="currentColor"/></svg>',
};
const incOf = (x) => INCIDENT_TYPES[x.type] || INCIDENT_TYPES.other;
const incLabel = (x) => {
  const t = incOf(x);
  return `${t.icon} ${x.who ? `${esc(x.who)} ` : ''}${t.label}${x.km != null ? ` @${fmtKm(x.km)} km` : ''}${x.minutes ? `（${fmtDur(x.minutes)}）` : ''}${x.note && x.note !== t.label ? `：${esc(x.note)}` : ''}`;
};
const placeLink = (p) => (p.map ? `<a class="pin" href="${esc(p.map)}" target="_blank" rel="noopener" title="在 Google 地圖開啟" aria-label="${esc(p.name)} 的 Google 地圖">${ICON.pin}</a>` : '');
const timeOf = (s) => (s.arrive && s.depart ? `${s.arrive} → ${s.depart}` : s.arrive || s.depart || '');
const dot = (d) => d.replace(/-/g, '.');
const WEEK = '日一二三四五六';
const weekday = (d) => `星期${WEEK[new Date(`${d}T12:00:00+08:00`).getUTCDay()]}`;
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const pad2 = (n) => String(n).padStart(2, '0');
const durHTML = (min) => { if (min == null) return '–'; const h = Math.floor(min / 60); const m = Math.round(min % 60); return h ? `${h}<small>h</small> ${m}<small>m</small>` : `${m}<small>m</small>`; };
const has = (v) => v != null && v !== '';

/* 進場動畫：.rv 元素捲到畫面內加 .is-in */
let io;
function reveal(root = view) {
  const els = root.querySelectorAll('.rv:not(.is-in), [data-reveal]:not(.is-in)');
  if (REDUCED || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  els.forEach((e) => io.observe(e));
}

/* 數字從 0 跑到目標值 */
function countUp(root = view) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count); const kind = el.dataset.kind;
    const fmt = (v) => (kind === 'dur' ? durHTML(v) : Math.round(v).toLocaleString());
    if (REDUCED) { el.innerHTML = fmt(to); return; }
    const t0 = performance.now(); const D = 1400 + Math.min(600, to / 4);
    const step = (t) => { const k = Math.min(1, (t - t0) / D); const e = 1 - (1 - k) ** 4; el.innerHTML = fmt(to * e); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function rhythmAndMap(items, extraTick, extraState) {
  const player = {};
  const map = mountMap($('[data-mapbox]', view), items, PLACES, { player });
  Object.assign(player, mountRhythm($('[data-rhythm]', view), items, {
    onTick: (pos) => { map.update(pos); if (extraTick) extraTick(pos); },
    onState: (st) => { map.setPlayState(st); if (extraState) extraState(st); },
  }));
  return player;
}

/* 單次頁面：播放時，「沿途」標出目前所在的休息站或區段，並捲動到看得到的位置 */
function followList(pos) {
  const list = $('.tl', view); if (!list) return;
  const p = pos && pos[0];
  let key = null;
  if (p) key = p.state === 'ride' ? `seg-${p.idx}` : p.state === 'wait' ? 'stop-0' : `stop-${p.idx}`;
  list.querySelectorAll('.is-now').forEach((el) => { if (el.dataset.key !== key) el.classList.remove('is-now'); });
  list.querySelectorAll('[data-live]').forEach((el) => { if (el.closest('[data-key]').dataset.key !== key) el.hidden = true; });
  if (!key) return;
  const cur = list.querySelector(`[data-key="${key}"]`); if (!cur) return;
  // 手機版：地圖在上方，不自動捲動，改在畫面底部的播放列顯示目前位置（點了才捲過去）
  const narrow = matchMedia('(max-width: 960px)').matches;
  const bar = $('body > [data-nowbar]');
  if (bar) {
    const { ride, a } = p; const st = ride.stops;
    const where = p.state === 'ride' ? `${a.place(st[p.idx].place).name} → ${a.place(st[p.idx + 1].place).name}` : p.state === 'rest' ? `${a.place(st[p.idx].place).name} 休息中` : p.state === 'done' ? '抵達終點' : '準備出發';
    $('[data-now-txt]', bar).innerHTML = `<b>${esc(where)}</b><span>${fmtKm(p.km)} km${p.state === 'ride' && p.kmh != null ? ` · ${Math.round(p.kmh)} km/h` : ''}</span>`;
    bar.dataset.key = key;
  }
  if (!cur.classList.contains('is-now')) {
    cur.classList.add('is-now');
    if (narrow) { /* 不捲動 */ } else {
    const r = cur.getBoundingClientRect();
    const strip = $('.ride-rhythm', view); const topEdge = strip && getComputedStyle(strip).position === 'sticky' ? strip.getBoundingClientRect().bottom : 70;
    if (r.top < topEdge || r.bottom > innerHeight) scrollBy({ top: r.top - (topEdge + innerHeight) / 2 + r.height / 2, behavior: REDUCED ? 'auto' : 'smooth' });
    }
  }
  const live = cur.querySelector('[data-live]');
  if (live) { live.hidden = false; live.textContent = `🚴 ${fmtKm(p.km)} km · ${p.kmh != null ? Math.round(p.kmh) : '–'} km/h`; }
}

/* 一趟在 00–24 時的騎乘／休息分布（HTML 百分比，文字不會被縮放） */
function miniDay({ ride, a }) {
  const sun = sunTimes(ride.date); const pct = (m) => `${((m / 1440) * 100).toFixed(3)}%`;
  let bars = '';
  a.segments.forEach((s) => {
    const t0 = toMin(s.from.depart ?? s.from.arrive); const t1 = toMin(s.to.arrive ?? s.to.depart);
    if (t0 == null || t1 == null) return;
    splitByPeriod(sun, t0, t1).forEach((p) => { bars += `<i class="km-${p.p}" style="left:${pct(p.t0)};width:${pct(p.t1 - p.t0)}"></i>`; });
  });
  ride.stops.slice(1, -1).forEach((s) => { const t0 = toMin(s.arrive); const t1 = toMin(s.depart); if (t0 != null && t1 != null) bars += `<i class="rest" style="left:${pct(t0)};width:${pct(t1 - t0)}"></i>`; });
  const lbl = a.start != null && a.end != null ? `<span class="mini__t" style="left:${pct(a.start)}">${hhmm(a.start)}</span><span class="mini__t mini__t--end" style="left:${pct(a.end)}">${hhmm(a.end)}</span>` : '';
  return `<span class="mini" aria-label="${a.start != null ? `${hhmm(a.start)} 出發，${hhmm(a.end)} 抵達` : ''}">
    <span class="mini__sky" style="--dawn:${pct(sun.dawn)};--rise:${pct(sun.sunrise)};--set:${pct(sun.sunset)};--dusk:${pct(sun.dusk)}"><span class="mini__fill">${bars}</span></span>
    <span class="mini__tk">${lbl}</span></span>`;
}

/* 首頁主視覺：最近一次的真實軌跡（已去掉出發點 200 m），依容器實際像素繪製，文字維持 13px 以上 */
function heroRoute(fig, item) {
  const { ride, a } = item;
  loadTrack(ride.date).then((tr) => {
    if (!fig.isConnected) return;
    const stops = ride.stops.map((s, k) => ({ s, k, p: a.place(s.place) })).filter(({ p }) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !p.private);
    const pts = tr ? tr.pts.map((q) => [q[0], q[1]]) : stops.map(({ p }) => [p.lat, p.lon]);
    if (pts.length < 2) { fig.hidden = true; return; }
    const draw = (animate) => {
      const W = fig.clientWidth; const H = fig.clientHeight; if (!W || !H) return;
      const lat0 = pts.reduce((s, q) => s + q[0], 0) / pts.length; const kx = Math.cos((lat0 * Math.PI) / 180);
      const xs = pts.map((q) => q[1] * kx); const ys = pts.map((q) => -q[0]);
      const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
      const padL = Math.min(150, W * 0.36); const padR = 48; const padT = 44; const padB = 56;
      const sc = Math.min((W - padL - padR) / (maxX - minX), (H - padT - padB) / (maxY - minY));
      const ox = padL + ((W - padL - padR) - (maxX - minX) * sc) / 2; const oy = padT + ((H - padT - padB) - (maxY - minY) * sc) / 2;
      const P = (lat, lon) => [ox + (lon * kx - minX) * sc, oy + (-lat - minY) * sc];
      const d = pts.map((q, i) => { const [x, y] = P(q[0], q[1]); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
      // 標籤：避免上下太擠
      let lastY = -99; const labels = [];
      const startXY = P(pts[0][0], pts[0][1]); const endXY = P(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      labels.push({ x: startXY[0], y: startXY[1], name: '桃園出發', end: true, first: true, t: hhmm(a.start) }); lastY = startXY[1];
      const mids = stops.filter(({ k }) => k > 0 && k < ride.stops.length - 1);
      const endStop = stops.find(({ k }) => k === ride.stops.length - 1);
      mids.forEach(({ s, p }) => {
        const [x, y] = P(p.lat, p.lon);
        const show = y - lastY > 30 && endXY[1] - y > 30;
        labels.push({ x, y, name: p.name, show, t: s.arrive }); if (show) lastY = y;
      });
      labels.push({ x: endXY[0], y: endXY[1], name: endStop ? endStop.p.name : '高雄', end: true, last: true, t: hhmm(a.end) });
      const lab = labels.map((l, i) => `<g class="route__stop${l.end ? ' is-end' : ''}${l.last ? ' is-last' : ''}" style="--d:${(0.3 + (i / labels.length) * 2.6).toFixed(2)}s">
        <circle cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="${l.end ? 5.5 : 3.5}"/>
        ${l.show !== false ? `<text x="${(l.first ? l.x + 6 : l.x - 14).toFixed(1)}" y="${(l.first ? l.y - 16 : l.y + 4.5).toFixed(1)}" text-anchor="end">${esc(l.name)}${l.end ? `<tspan class="route__t" dx="8">${l.t || ''}</tspan>` : ''}</text>` : ''}</g>`).join('');
      fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${ordinal(ride.no)} 的實際路線：桃園到高雄">
        <text class="route__north" x="${W - 8}" y="16" text-anchor="end">N ↑</text>
        <path class="route__glow" d="${d}"/><path class="route__line" d="${d}"/>${lab}
        <circle class="route__halo" r="8" cx="${endXY[0]}" cy="${endXY[1]}" ${animate ? 'style="opacity:0"' : ''}/><circle class="route__dot" r="5" cx="${startXY[0]}" cy="${startXY[1]}"/>
      </svg><figcaption>${ordinal(ride.no)} · ${dot(ride.date)}<br>${fmtKm(a.km)} km 實際軌跡</figcaption>`;
      const line = fig.querySelector('.route__line'); const len = line.getTotalLength();
      fig.querySelectorAll('.route__line, .route__glow').forEach((el) => { el.style.strokeDasharray = `${len}`; el.style.setProperty('--len', `${len}`); });
      const dotEl = fig.querySelector('.route__dot'); const halo = fig.querySelector('.route__halo');
      if (!animate || REDUCED) { dotEl.setAttribute('cx', endXY[0]); dotEl.setAttribute('cy', endXY[1]); halo.style.opacity = ''; return; }
      fig.classList.add('is-drawing');
      const t0 = performance.now() + 200; const D = 2800;
      const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
      const step = (t) => {
        if (!dotEl.isConnected) return;
        const k = Math.max(0, Math.min(1, (t - t0) / D)); const pt = line.getPointAtLength(ease(k) * len);
        dotEl.setAttribute('cx', pt.x); dotEl.setAttribute('cy', pt.y);
        if (k < 1) requestAnimationFrame(step); else halo.style.opacity = '';
      };
      requestAnimationFrame(step);
    };
    draw(true);
    let w = fig.clientWidth; let tm;
    const ro = new ResizeObserver(() => { if (!fig.isConnected) { ro.disconnect(); return; } if (fig.clientWidth === w) return; w = fig.clientWidth; clearTimeout(tm); tm = setTimeout(() => { fig.classList.remove('is-drawing'); draw(false); }, 120); });
    ro.observe(fig);
  });
}

/* 從天黑到天黑：每一趟在一天 24 小時裡的位置 */
function dayBand() {
  const rs = [...RIDES].reverse().filter(({ a }) => a.start != null && a.end != null);
  if (!rs.length) return '';
  const sun = sunTimes(RIDES[0].ride.date); const pct = (m) => `${((m / 1440) * 100).toFixed(3)}%`;
  const avg = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
  const s0 = avg((r) => r.a.start); const e0 = avg((r) => r.a.end);
  let dark = 0; let ridden = 0;
  rs.forEach(({ ride, a }) => {
    const st = sunTimes(ride.date);
    a.segments.forEach((s) => { const t0 = toMin(s.from.depart ?? s.from.arrive); const t1 = toMin(s.to.arrive ?? s.to.depart); if (t0 == null || t1 == null) return; splitByPeriod(st, t0, t1).forEach((p) => { ridden += p.t1 - p.t0; if (p.p !== 'day') dark += p.t1 - p.t0; }); });
  });
  const sky = `linear-gradient(90deg, #D6DBF7 0 ${pct(sun.dawn)}, #FFD3B8 ${pct(sun.sunrise)}, #FFEAA8 calc(${pct(sun.sunrise)} + 3%) calc(${pct(sun.sunset)} - 3%), #FFD3B8 ${pct(sun.sunset)}, #D6DBF7 ${pct(sun.dusk)} 100%)`;
  return `<div class="dayband" data-reveal>
    <div class="dayband__copy"><h3>從天黑騎到天黑</h3>
      <p>平均 <b>${hhmm(s0)}</b> 出發、<b>${hhmm(e0)}</b> 抵達。騎車的時間裡有 <b>${Math.round((dark / ridden) * 100)}%</b> 在日出前或日落後。</p></div>
    <div class="dayband__track">
      <span class="dayband__mark" style="left:${pct(s0)}">出發 <span>${hhmm(s0)}</span></span>
      <span class="dayband__mark dayband__mark--end" style="left:${pct(e0)}">抵達 <span>${hhmm(e0)}</span></span>
      <div class="dayband__sky" style="background:${sky}" role="img" aria-label="各次騎乘在一天中的時段">
        <div class="dayband__rides">${rs.map(({ ride, a }, i) => `<div class="dayband__ride" title="${ordinal(ride.no)}：${hhmm(a.start)}–${hhmm(a.end)}"><span style="left:${pct(a.start)};width:${pct(a.end - a.start)};--d:${(0.15 + i * 0.09).toFixed(2)}s"></span></div>`).join('')}</div>
      </div>
      <div class="dayband__ticks">${[0, 12, 24].map((h) => `<span style="left:${pct(h * 60)}">${pad2(h)}:00</span>`).join('')}
        <span class="dayband__sun" style="left:${pct(sun.sunrise)}">日出 ${hhmm(sun.sunrise)}</span><span class="dayband__sun" style="left:${pct(sun.sunset)}">日落 ${hhmm(sun.sunset)}</span></div>
    </div>
  </div>`;
}

/* ---------- views ---------- */
function home() {
  const n = RIDES.length;
  const best = RIDES.reduce((b, r) => (r.a.total != null && (!b || r.a.total < b.a.total) ? r : b), null);
  const sumMin = RIDES.reduce((s, r) => s + (r.a.total || 0), 0);
  const sumKm = RIDES.reduce((s, r) => s + (r.a.km || 0), 0);
  const avgKm = n ? sumKm / n : 0;
  const yrs = n ? `${RIDES[n - 1].ride.date.slice(0, 4)}–${RIDES[0].ride.date.slice(0, 4)}` : '';
  const heroItem = RIDES[0];
  view.innerHTML = `
    <section class="hero">
      <div class="hero__text">
        <p class="eyebrow rv">Taoyuan <i></i> Kaohsiung<span>·</span>${yrs}</p>
        <h1 class="hero__title rv" style="--d:.08s"><span>一日</span><span class="hl">桃高</span></h1>
        <p class="hero__lede rv" style="--d:.18s">${esc(DATA.subtitle || '桃園 → 高雄，一天騎完')}。沿著西部海線往南約 <b>${Math.round(avgKm)} 公里</b>，天亮前出發，天黑後在左營搭高鐵回家。這裡記下每一次在哪裡停、停多久、路上發生什麼事。</p>
        <dl class="hero__stats rv" style="--d:.28s">
          <div><dd data-count="${n}">0</dd><dt>次完成</dt></div>
          <div><dd><span data-count="${Math.round(sumKm)}">0</span><small>km</small></dd><dt>累計距離</dt></div>
          <div><dd data-count="${sumMin}" data-kind="dur">–</dd><dt>總計時間</dt></div>
        </dl>
      </div>
      <figure class="route" data-route></figure>
      ${dayBand()}
    </section>

    <section class="sec">
      <header class="sec__head rv"><span class="sec__no">01</span><h2>一天的節奏</h2><p>每一列是一趟。顏色是當時的天色，圓點是休息站。按 ▶ 讓小人照 GPS 的實際速度重騎一遍，可以同時播放幾趟來比較。</p></header>
      <div class="rv" data-rhythm></div>
    </section>

    <section class="sec">
      <header class="sec__head rv"><span class="sec__no">02</span><h2>路線</h2><p>大致相同的海線，每次在細節上不太一樣。播放時地圖上的小人也會跟著移動。</p></header>
      <div class="rv" data-mapbox></div>
    </section>

    <section class="sec">
      <header class="sec__head rv"><span class="sec__no">03</span><h2>每一次</h2><p>橫條是那一天的 24 小時：深藍是夜裡、橘色是晨昏、金色是白天，中間的細線是休息。</p></header>
      <ol class="rides">${RIDES.map((it, i) => {
    const { ride, a } = it;
    const tags = a.incidents.map((x) => `<span class="chip">${incOf(x).icon} ${x.who ? esc(x.who) : ''}${incOf(x).label}</span>`).join('');
    return `<li><a class="ride-row rv" style="--c:${rideColor(ride.no)};--d:${(i * 0.05).toFixed(2)}s" href="#/ride/${ride.no}">
        <span class="ride-row__no">${pad2(ride.no)}<sup>${ordinal(ride.no).slice(-2).toUpperCase()}</sup></span>
        <span class="ride-row__when"><b>${dot(ride.date)}</b><span>${esc((ride.riders || []).join('、'))}</span><span class="wx">${esc(ride.weather || '')}${has(ride.temp) ? `・${esc(ride.temp)}°C` : ''}</span></span>
        <span class="ride-row__day">${miniDay(it)}</span>
        <span class="ride-row__nums"><b>${fmtDur(a.total)}</b><span>${fmtKm(a.km)} km・休息 ${fmtDur(a.rest)}</span></span>
        <span class="ride-row__go" aria-hidden="true">${ICON.arrow}</span>
        ${tags || it === best ? `<span class="ride-row__tags">${it === best ? '<span class="chip chip--best">最快</span>' : ''}${tags}</span>` : ''}
      </a></li>`;
  }).join('')}</ol>
    </section>`;
  if (heroItem) heroRoute($('[data-route]', view), heroItem);
  rhythmAndMap(RIDES);
  countUp();
}

function rideView(no) {
  const i = RIDES.findIndex((r) => String(r.ride.no) === String(no));
  if (i < 0) { view.innerHTML = '<section class="page-head"><div><h1>找不到</h1><p>沒有這一次的紀錄。<a href="#/">回總覽</a></p></div></section>'; return; }
  const { ride, a } = RIDES[i];
  const stops = ride.stops;
  const maxSpeed = 34;
  const items = [];
  stops.forEach((s, k) => {
    const p = a.place(s.place); const first = k === 0; const last = k === stops.length - 1;
    const info = [];
    if (!first && !last) info.push(`<span><span class="k">停留</span> ${stayOf(s)} 分</span>`);
    info.push(`<span><span class="k">里程</span> ${fmtKm(s.km)} km</span>`);
    if (last && ride.train) info.push(`<span>🚄 <span class="k">回程高鐵</span> ${esc(ride.train)}</span>`);
    const tm = first ? `<b>${s.depart || ''}</b><span>出發</span>` : last ? `<b>${s.arrive || ''}</b><span>抵達</span>` : `<b>${s.arrive || ''}</b><span>${s.depart || ''}</span>`;
    items.push(`<li class="tl-stop${first || last ? ' is-end' : ''}${last ? ' is-last' : ''}" data-key="stop-${k}">
      <div class="tl-time">${tm}</div><div class="tl-node"></div>
      <div class="tl-card">
        <div class="tl-card__row"><h3 class="tl-card__name">${esc(p.name)}${placeLink(p)}</h3>${p.sub ? `<span class="tl-card__sub">${esc(p.sub)}${p.closed ? '（已歇業）' : ''}</span>` : ''}</div>
        <div class="tl-card__info">${s.tag ? `<span class="badge">${esc(s.tag)}</span>` : ''}${info.join('')}${s.note ? `<span>💬 ${esc(s.note)}</span>` : ''}</div>
        ${a.stopIncidents[k].map((x) => `<div class="tl-inc">${incLabel(x)}</div>`).join('')}
      </div></li>`);
    const seg = a.segments[k];
    if (seg) {
      const slow = seg.speed != null && seg.speed < 18;
      const w = seg.speed ? Math.min(100, (seg.speed / maxSpeed) * 100).toFixed(1) : 0;
      items.push(`<li class="tl-seg${slow ? ' is-slow' : ''}" data-key="seg-${k}"><div></div><div class="tl-node"></div>
        <div class="tl-seg__body"><div class="tl-seg__line"><span class="tl-speed" title="區段均速"><i style="--w:${w}%"></i></span><span>${fmtKm(seg.km)} km · ${fmtDur(seg.min)} · ${seg.speed ? seg.speed.toFixed(1) : '–'} km/h</span><span class="tl-live" data-live hidden></span></div>
        ${seg.incidents.map((x) => `<div class="tl-inc">${incLabel(x)}</div>`).join('')}</div></li>`);
    }
  });
  const prev = RIDES[i + 1]; const next = RIDES[i - 1];
  const links = ride.links || {};
  const facts = [['騎士', esc((ride.riders || []).join('、'))], ['天氣', esc(ride.weather || '')], has(ride.temp) ? ['氣溫', `${esc(ride.temp)}°C`] : null, ride.train ? ['回程', `高鐵 ${esc(ride.train)}`] : null].filter(Boolean);
  view.innerHTML = `
    <section class="ride-hero" style="--c:${rideColor(ride.no)}">
      <a class="back" href="#/"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>全部紀錄</a>
      <div class="ride-hero__top">
        <h1 class="rv"><span class="ride-hero__no">第 <em>${ride.no}</em> 次</span><span class="ride-hero__date">${dot(ride.date)}<small>${weekday(ride.date)}・${ordinal(ride.no)} ride</small></span></h1>
        <div class="ride-hero__links rv" style="--d:.1s">${links.strava ? `<a class="btn" href="${esc(links.strava)}" target="_blank" rel="noopener">Strava ${ICON.out}</a>` : ''}${links.gear ? `<a class="btn" href="${esc(links.gear)}" target="_blank" rel="noopener">裝備清單 ${ICON.out}</a>` : ''}</div>
      </div>
      <dl class="facts rv" style="--d:.14s">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <dl class="figs rv" style="--d:.2s">
        <div class="figs__lead"><dd>${durHTML(a.total)}</dd><dt>總時間（${a.start != null ? `${hhmm(a.start)}–${hhmm(a.end)}` : ''}）</dt></div>
        <div><dd>${durHTML(a.moving)}</dd><dt>騎乘（含路上狀況）</dt></div>
        <div><dd>${durHTML(a.rest)}</dd><dt>休息 ${stops.length - 2} 站</dt></div>
        <div><dd>${fmtKm(a.km)}<small>km</small></dd><dt>距離</dt></div>
        <div><dd>${a.avg ? a.avg.toFixed(1) : '–'}<small>km/h</small></dd><dt>平均速度</dt></div>
      </dl>
    </section>
    <div class="ride-rhythm" data-rhythm></div>
    <div class="ride-cols">
      <section><h2><span>01</span>沿途</h2><ol class="tl">${items.join('')}</ol></section>
      <section class="ride-cols__map"><h2><span>02</span>地圖</h2><div data-mapbox></div></section>
    </div>
    <nav class="pager" aria-label="其他場次">${prev ? `<a href="#/ride/${prev.ride.no}"><span>← 上一次</span><b>第 ${prev.ride.no} 次</b><span>${dot(prev.ride.date)}</span></a>` : ''}${next ? `<a class="next" href="#/ride/${next.ride.no}"><span>下一次 →</span><b>第 ${next.ride.no} 次</b><span>${dot(next.ride.date)}</span></a>` : ''}</nav>`;
  // 掛在 body 上：view 有進場動畫的 transform，fixed 會失效
  document.body.insertAdjacentHTML('beforeend', `<div class="nowbar" data-nowbar hidden role="status">
      <button type="button" class="nowbar__txt" data-now-txt title="捲到沿途的這一段"></button>
      <button type="button" class="nowbar__btn" data-now-pause aria-label="暫停">❚❚</button>
      <button type="button" class="nowbar__btn nowbar__btn--ghost" data-now-stop aria-label="停止">■</button></div>`);
  const bar = $('body > [data-nowbar]');
  const player = rhythmAndMap([RIDES[i]], followList, (st) => {
    bar.hidden = !st.playing && !st.finished;
    const b = $('[data-now-pause]', bar); b.textContent = st.paused ? '▶' : '❚❚'; b.setAttribute('aria-label', st.paused ? '繼續' : '暫停'); b.hidden = st.finished;
  });
  $('[data-now-pause]', bar).addEventListener('click', () => player.togglePause());
  $('[data-now-stop]', bar).addEventListener('click', () => player.stop());
  $('[data-now-txt]', bar).addEventListener('click', () => { const t = $(`.tl [data-key="${bar.dataset.key}"]`, view); if (t) t.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' }); });
}

let selected = null;
function compare(again) {
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
      g[r] = { html: `<span class="t">${timeOf(s)}</span>${stay}<span class="s">${fmtKm(s.km)} km</span>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}${s.note ? `<span class="note">💬 ${esc(s.note)}</span>` : ''}${k === ride.stops.length - 1 && ride.train ? `<span class="s">🚄 ${esc(ride.train)}</span>` : ''}${a.stopIncidents[k].map((x) => `<span class="note">${incLabel(x)}</span>`).join('')}` };
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
  body += `<tr class="sum"><th class="loc">總計</th>${cols.map(({ a }) => `<td>⏱ ${fmtDur(a.total)}<br>☕ ${fmtDur(a.rest)}<br>${fmtKm(a.km)} km</td>`).join('')}</tr>`;
  const scrollKeep = again ? $('.table-wrap', view)?.scrollLeft : 0;
  view.innerHTML = `
    <header class="page-head"><div><p class="eyebrow rv">Stop by stop</p><h1 class="rv" style="--d:.06s"><span class="skew">比較表</span></h1>
      <p class="rv" style="--d:.12s">每一站的到達與出發時間並排對照。灰色列是兩站之間的距離、時間與均速；沒停的站會併在區段裡。</p></div></header>
    <div class="toggles rv" style="--d:.18s" role="group" aria-label="要比較的場次">${RIDES.map(({ ride }) => `<button class="key" type="button" data-no="${ride.no}" aria-pressed="${selected.has(ride.no)}"><i style="background:${rideColor(ride.no)}"></i>${ordinal(ride.no)} ${ride.date.slice(0, 4)}</button>`).join('')}
      <span class="toggles__sp"></span><button class="btn btn--sm" type="button" data-print>列印</button></div>
    ${cols.length ? `<div class="table-wrap rv" style="--d:.24s"><table class="cmp"><thead><tr><th class="loc">地點</th>${cols.map(({ ride }) => `<th><i style="background:${rideColor(ride.no)}"></i><a href="#/ride/${ride.no}">${ordinal(ride.no)}</a><span class="s num">${dot(ride.date)}</span></th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="muted">請至少選一次。</p>'}`;
  if (again) { view.querySelectorAll('.rv').forEach((e) => e.classList.add('is-in')); const tw = $('.table-wrap', view); if (tw) tw.scrollLeft = scrollKeep; }
  $('[data-print]', view).addEventListener('click', () => window.print());
  view.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.no); if (selected.has(n)) selected.delete(n); else selected.add(n);
    try { localStorage.setItem('tyc:cmp', JSON.stringify([...selected])); } catch (e) { /* noop */ }
    compare(true);
  }));
}

/* 導覽列的滑動底色 */
function navInk() {
  const ink = $('[data-nav-ink]'); const on = document.querySelector('.nav a[aria-current="page"]');
  if (!ink) return;
  if (!on) { ink.style.opacity = '0'; return; }
  ink.style.opacity = '1'; ink.style.width = `${on.offsetWidth}px`; ink.style.transform = `translateX(${on.offsetLeft}px)`;
}

function route() {
  document.querySelectorAll('body > .nowbar').forEach((x) => x.remove());
  const [, page, arg] = (location.hash || '#/').split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.removeAttribute('aria-current'));
  const nav = page === 'compare' ? 'compare' : page ? '' : 'home';
  if (nav) document.querySelector(`[data-nav="${nav}"]`).setAttribute('aria-current', 'page');
  navInk();
  view.classList.remove('is-entering'); void view.offsetWidth; view.classList.add('is-entering');
  if (page === 'ride') rideView(arg); else if (page === 'compare') compare(); else home();
  document.title = `${DATA.title || '一日桃高'}${page === 'ride' ? ` · 第 ${arg} 次` : page === 'compare' ? ' · 比較表' : ''}`;
  window.scrollTo(0, 0);
  reveal();
}

addEventListener('scroll', () => { $('[data-top]').classList.toggle('is-scrolled', scrollY > 8); }, { passive: true });
addEventListener('resize', navInk);
if (document.fonts) document.fonts.ready.then(navInk);

load().then((d) => {
  mountAeroBackdrop(d.aero);
  DATA = d; PLACES = indexPlaces(d);
  RIDES = [...(d.rides || [])].filter((r) => !r.hidden).sort((x, y) => y.no - x.no).map((ride) => ({ ride, a: analyze(ride, PLACES) }));
  $('[data-title]').textContent = d.title || '一日桃高';
  addEventListener('hashchange', route); route();
}).catch((err) => { mountAeroBackdrop(); view.innerHTML = `<section class="page-head"><div><h1>載入失敗</h1><p>${esc(err.message)}</p><p class="muted">在本機預覽要先啟動伺服器，例如在資料夾執行 <code>python3 -m http.server</code>。</p></div></section>`; });
