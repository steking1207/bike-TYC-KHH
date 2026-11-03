/* 一天的節奏：時刻軸／距離軸切換、日夜時段、騎車小人播放動畫。 */
import { INCIDENT_TYPES, esc, fmtDur, fmtKm, ordinal, stayOf, toMin } from './ride.js';

export const RIDE_COLORS = ['#0E7C5A', '#2563EB', '#EA580C', '#7C3AED', '#DB2777', '#0891B2', '#CA8A04', '#4B5563'];
export const rideColor = (no) => RIDE_COLORS[(no - 1) % RIDE_COLORS.length];

/* 日出日落（NOAA 簡化公式），回傳當地（UTC+8）分鐘。zenith 90.833 = 日出日落，96 = 民用曙暮光 */
function sunEvent(date, zenith, lat = 23.8, lon = 120.5) {
  const d = new Date(`${date}T12:00:00+08:00`);
  const n = Math.round((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 864e5) + 1;
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const r = Math.PI / 180;
  const ha = Math.acos(Math.cos(zenith * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl)) / r;
  return { rise: 720 - 4 * (lon + ha) - eq + 480, set: 720 - 4 * (lon - ha) - eq + 480 };
}
export function sunTimes(date) {
  const s = sunEvent(date, 90.833); const c = sunEvent(date, 96);
  return { dawn: c.rise, sunrise: s.rise, sunset: s.set, dusk: c.set };
}
const PERIODS = [['night', '夜間'], ['twilight', '晨昏'], ['day', '白天']];
function periodAt(sun, m) {
  if (m < sun.dawn || m >= sun.dusk) return 'night';
  if (m < sun.sunrise || m >= sun.sunset) return 'twilight';
  return 'day';
}
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/* 某個時刻（分鐘）人在哪：km 與狀態 */
export function positionAt(ride, a, m) {
  const st = ride.stops;
  if (a.start == null || m <= a.start) return { km: 0, state: 'wait', idx: 0, f: 0 };
  for (let i = 0; i < st.length - 1; i += 1) {
    const s = st[i]; const n = st[i + 1];
    const arr = toMin(s.arrive); const dep = toMin(s.depart);
    if (i > 0 && arr != null && dep != null && m >= arr && m < dep) return { km: s.km, state: 'rest', idx: i, f: 0, place: s.place };
    const t0 = toMin(s.depart ?? s.arrive); const t1 = toMin(n.arrive ?? n.depart);
    if (t0 != null && t1 != null && m >= t0 && m < t1) {
      const f = (m - t0) / (t1 - t0 || 1);
      return { km: s.km + (n.km - s.km) * f, state: 'ride', idx: i, f };
    }
  }
  return { km: a.km ?? 0, state: 'done', idx: st.length - 1, f: 0 };
}

/* 把 [t0,t1] 依時段切開 */
function splitByPeriod(sun, t0, t1) {
  const cuts = [sun.dawn, sun.sunrise, sun.sunset, sun.dusk].filter((c) => c > t0 && c < t1);
  const pts = [t0, ...cuts, t1]; const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) out.push({ t0: pts[i], t1: pts[i + 1], p: periodAt(sun, (pts[i] + pts[i + 1]) / 2) });
  return out;
}

const W = 1200; const L = 92; const R = 96; const ROW = 40; const TOP = 30; const BH = 14;

function buildSvg(items, mode) {
  const starts = items.map(({ a }) => a.start).filter((v) => v != null);
  const ends = items.map(({ a }) => a.end).filter((v) => v != null);
  const maxKm = Math.max(...items.map(({ a }) => a.km || 0));
  const h0 = Math.floor(Math.min(...starts) / 60); const h1 = Math.ceil(Math.max(...ends) / 60);
  const kmMax = Math.ceil(maxKm / 50) * 50;
  const xT = (m) => L + ((m - h0 * 60) / ((h1 - h0) * 60)) * (W - L - R);
  const xK = (km) => L + (km / kmMax) * (W - L - R);
  const H = TOP + items.length * ROW + 6;
  let axis = '';
  if (mode === 'time') {
    for (let h = h0; h <= h1; h += 1) {
      const major = h % 3 === 0;
      axis += `<line x1="${xT(h * 60)}" x2="${xT(h * 60)}" y1="${TOP - 8}" y2="${H}" stroke-dasharray="${major ? '' : '2 3'}"/>`;
      if (major || h1 - h0 <= 10) axis += `<text x="${xT(h * 60)}" y="${TOP - 13}" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`;
    }
  } else {
    for (let k = 0; k <= kmMax; k += 25) {
      const major = k % 50 === 0;
      axis += `<line x1="${xK(k)}" x2="${xK(k)}" y1="${TOP - 8}" y2="${H}" stroke-dasharray="${major ? '' : '2 3'}"/>`;
      if (major) axis += `<text x="${xK(k)}" y="${TOP - 13}" text-anchor="middle">${k} km</text>`;
    }
  }
  const incIcon = (inc) => (INCIDENT_TYPES[inc.type] || INCIDENT_TYPES.other).icon;
  const incTitle = (inc) => { const t = INCIDENT_TYPES[inc.type] || INCIDENT_TYPES.other; return `${inc.who ? `${inc.who} ` : ''}${t.label} @${fmtKm(inc.km)}K${inc.note ? `：${inc.note}` : ''}`; };

  const rows = items.map(({ ride, a }, i) => {
    const y = TOP + i * ROW + 16; const sun = sunTimes(ride.date);
    let bg = ''; let bars = '';
    if (mode === 'time') {
      // 背景淡淡標出夜間與晨昏；騎乘段依時段上色（和距離軸同一套配色）
      splitByPeriod(sun, h0 * 60, h1 * 60).forEach((p) => { if (p.p !== 'day') bg += `<rect class="bg-${p.p}" x="${xT(p.t0)}" y="${y - 6}" width="${xT(p.t1) - xT(p.t0)}" height="${BH + 12}"/>`; });
      a.segments.forEach((s) => {
        const t0 = toMin(s.from.depart ?? s.from.arrive); const t1 = toMin(s.to.arrive ?? s.to.depart);
        if (t0 == null || t1 == null) return;
        splitByPeriod(sun, t0, t1).forEach((p) => {
          bars += `<rect class="km-${p.p}" x="${xT(p.t0)}" y="${y}" width="${Math.max(0, xT(p.t1) - xT(p.t0))}" height="${BH}"><title>${esc(a.place(s.from.place).name)} → ${esc(a.place(s.to.place).name)}：${fmtKm(s.km)} km / ${fmtDur(s.min)}　${hhmm(p.t0)}–${hhmm(p.t1)}（${PERIODS.find((q) => q[0] === p.p)[1]}）</title></rect>`;
        });
        s.incidents.forEach((inc) => { const tm = t0 + ((inc.km - s.from.km) / (s.km || 1)) * (t1 - t0); bars += `<text class="inc" x="${xT(tm)}" y="${y + 12}" text-anchor="middle"><title>${esc(incTitle(inc))}</title>${incIcon(inc)}</text>`; });
      });
      ride.stops.slice(1, -1).forEach((s, k) => {
        const t0 = toMin(s.arrive); const t1 = toMin(s.depart); if (t0 == null || t1 == null) return;
        bars += `<rect class="seg-stop" x="${xT(t0)}" y="${y}" width="${Math.max(1.5, xT(t1) - xT(t0))}" height="${BH}"><title>${esc(a.place(s.place).name)} ${s.arrive}–${s.depart} 停留 ${stayOf(s)} 分</title></rect>`;
        a.stopIncidents[k + 1].forEach((inc) => { bars += `<text class="inc" x="${xT((t0 + t1) / 2)}" y="${y + 12}" text-anchor="middle"><title>${esc(incTitle(inc))}</title>${incIcon(inc)}</text>`; });
      });
    } else {
      // 距離軸：騎乘段依時段上色，休息站是圓點（大小 = 停留時間）
      a.segments.forEach((s) => {
        const t0 = toMin(s.from.depart ?? s.from.arrive); const t1 = toMin(s.to.arrive ?? s.to.depart);
        if (t0 == null || t1 == null || s.km == null) return;
        splitByPeriod(sun, t0, t1).forEach((p) => {
          const k0 = s.from.km + ((p.t0 - t0) / (t1 - t0 || 1)) * s.km; const k1 = s.from.km + ((p.t1 - t0) / (t1 - t0 || 1)) * s.km;
          bars += `<rect class="km-${p.p}" x="${xK(k0)}" y="${y}" width="${Math.max(0, xK(k1) - xK(k0))}" height="${BH}"><title>${esc(a.place(s.from.place).name)} → ${esc(a.place(s.to.place).name)}：${hhmm(p.t0)}–${hhmm(p.t1)}（${PERIODS.find((q) => q[0] === p.p)[1]}）${s.speed ? `，${s.speed.toFixed(1)} km/h` : ''}</title></rect>`;
        });
        s.incidents.forEach((inc) => { bars += `<text class="inc" x="${xK(inc.km)}" y="${y + 12}" text-anchor="middle"><title>${esc(incTitle(inc))}</title>${incIcon(inc)}</text>`; });
      });
      ride.stops.slice(1, -1).forEach((s, k) => {
        const r = Math.max(3, Math.min(11, Math.sqrt(stayOf(s)) * 1.4));
        bars += `<circle class="stop-dot" cx="${xK(s.km)}" cy="${y + BH / 2}" r="${r}"><title>${esc(a.place(s.place).name)} @${fmtKm(s.km)}K　${s.arrive}–${s.depart} 停留 ${stayOf(s)} 分</title></circle>`;
        a.stopIncidents[k + 1].forEach((inc) => { bars += `<text class="inc" x="${xK(s.km)}" y="${y - 4}" text-anchor="middle"><title>${esc(incTitle(inc))}</title>${incIcon(inc)}</text>`; });
      });
    }
    const endX = mode === 'time' ? xT(a.end) : xK(a.km || 0);
    return `<g class="row" data-row="${ride.no}">
      ${bg}
      <a href="#/ride/${ride.no}"><text class="lbl" x="22" y="${y + 12}">${ordinal(ride.no)} <tspan class="tot">${ride.date.slice(0, 4)}</tspan></text></a>
      <g class="play1" data-play="${ride.no}" role="button" tabindex="0" aria-label="播放 ${ordinal(ride.no)}"><title>只播放 ${ordinal(ride.no)}</title><circle cx="8" cy="${y + 7}" r="8"/><path d="M5 ${y + 2.5} L12 ${y + 7} L5 ${y + 11.5}Z"/></g>
      ${bars}
      <text class="tot" data-readout="${ride.no}" x="${endX + 8}" y="${y + 12}">${mode === 'time' ? fmtDur(a.total) : `${fmtKm(a.km)} km`}</text>
      <g class="rider" data-rider="${ride.no}" style="display:none"><text class="rider__icon" transform="scale(-1,1)" x="0" y="0" text-anchor="middle">🚴</text></g>
    </g>`;
  }).join('');
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode === 'time' ? '各次出發到抵達的時間軸' : '各次以距離排列的節奏'}"><g class="axis">${axis}</g>${rows}</svg>`, xT, xK, h0, h1 };
}

/* 掛到容器上。items: [{ride,a}]；onTick(positions) 讓地圖跟著動 */
export function mountRhythm(el, items, { onTick } = {}) {
  if (!items.some(({ a }) => a.start != null)) { el.innerHTML = ''; return; }
  let mode = 'km'; const picked = new Set(items.map(({ ride }) => ride.no)); let geo; let playing = null; let raf = 0; let elapsed = 0; let speed = 1; let last = 0;
  const maxTotal = Math.max(...items.map(({ a }) => a.total || 0));
  const SECONDS = 24; // 1x 時，最長的一次播放 24 秒

  el.innerHTML = `<div class="strip">
    <div class="strip__bar">
      <div class="axis-toggle" role="group" aria-label="橫軸">
        <button type="button" data-mode="km" aria-pressed="true">距離</button><button type="button" data-mode="time" aria-pressed="false">時刻</button>
      </div>
      <div class="strip__play">
        <button type="button" class="btn btn--sm btn--go" data-playall>${items.length > 1 ? '▶ 播放比較' : '▶ 播放'}</button>
        <button type="button" class="btn btn--sm" data-pause hidden>❚❚ 暫停</button>
        <button type="button" class="btn btn--sm" data-stop hidden>■ 停止</button>
        <label class="speed">速度 <select data-speed><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <span class="clock num" data-clock></span>
      </div>
    </div>
    ${items.length > 1 ? `<div class="picks" role="group" aria-label="選擇要比較的場次"><span class="picks__label">比較：</span>${items.map(({ ride }) => `<button type="button" class="key" data-pick="${ride.no}" aria-pressed="true"><i style="background:${rideColor(ride.no)}"></i>${ordinal(ride.no)} ${ride.date.slice(0, 4)}</button>`).join('')}<button type="button" class="linkish" data-pick-all>全選</button><button type="button" class="linkish" data-pick-none>清除</button></div>` : ''}
    <div class="strip__svg" data-svg></div>
    <div class="legend" data-legend></div>
  </div>`;
  const svgBox = el.querySelector('[data-svg]');

  function legend() {
    const periodKeys = '<span><i class="sw-km-night"></i>🌙 夜間騎乘</span><span><i class="sw-km-twilight"></i>🌅 晨昏騎乘</span><span><i class="sw-km-day"></i>☀️ 白天騎乘</span>';
    const inc = Object.values(INCIDENT_TYPES).slice(0, 5).map((t) => `<span>${t.icon} ${t.label}</span>`).join('');
    el.querySelector('[data-legend]').innerHTML = mode === 'time'
      ? `${periodKeys}<span><i style="background:var(--stop)"></i>休息</span>${inc}`
      : `${periodKeys}<span><i class="dot"></i>休息站（越大停越久）</span>${inc}`;
  }
  function draw() {
    geo = buildSvg(items, mode); svgBox.innerHTML = geo.svg; legend();
    svgBox.querySelectorAll('[data-play]').forEach((b) => {
      const go = () => start([Number(b.dataset.play)]);
      b.addEventListener('click', go); b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    if (playing) paint();
  }

  function paint() {
    const pos = [];
    items.forEach(({ ride, a }) => {
      const g = svgBox.querySelector(`[data-rider="${ride.no}"]`); const out = svgBox.querySelector(`[data-readout="${ride.no}"]`);
      const row = svgBox.querySelector(`[data-row="${ride.no}"]`);
      const on = playing && playing.includes(ride.no);
      row.classList.toggle('is-dim', !!playing && !on);
      if (!on) { g.style.display = 'none'; out.textContent = mode === 'time' ? fmtDur(a.total) : `${fmtKm(a.km)} km`; return; }
      const m = a.start + Math.min(elapsed, a.total);
      const p = positionAt(ride, a, m);
      const y = TOP + items.findIndex((r) => r.ride.no === ride.no) * ROW + 16;
      const x = mode === 'time' ? geo.xT(m) : geo.xK(p.km);
      g.style.display = '';
      g.setAttribute('transform', `translate(${x},${y - 1})`);
      g.classList.toggle('is-rest', p.state === 'rest');
      out.textContent = p.state === 'done' ? `🏁 ${fmtDur(a.total)}` : `${fmtKm(p.km)} km${p.state === 'rest' ? ' ☕' : ''}`;
      pos.push({ ride, a, ...p, clock: m });
    });
    el.querySelector('[data-clock]').textContent = playing ? `出發後 ${fmtDur(elapsed)}` : '';
    if (onTick) onTick(playing ? pos : null);
  }
  function frame(ts) {
    if (!el.isConnected) return;
    const dt = last ? (ts - last) / 1000 : 0; last = ts;
    elapsed += dt * (maxTotal / SECONDS) * speed;
    const lim = Math.max(...items.filter(({ ride }) => playing.includes(ride.no)).map(({ a }) => a.total || 0));
    if (elapsed >= lim) { elapsed = lim; paint(); finish(); return; }
    paint(); raf = requestAnimationFrame(frame);
  }
  let paused = false;
  const pauseBtn = el.querySelector('[data-pause]');
  const setPaused = (v) => { paused = v; pauseBtn.textContent = v ? '▶ 繼續' : '❚❚ 暫停'; pauseBtn.setAttribute('aria-pressed', String(v)); };
  function start(nos) {
    cancelAnimationFrame(raf); playing = nos; elapsed = 0; last = 0;
    el.querySelector('[data-stop]').hidden = false; pauseBtn.hidden = false; setPaused(false);
    raf = requestAnimationFrame(frame);
  }
  function togglePause() {
    if (!playing) return;
    if (paused) { setPaused(false); last = 0; raf = requestAnimationFrame(frame); } else { setPaused(true); cancelAnimationFrame(raf); }
  }
  function finish() { cancelAnimationFrame(raf); pauseBtn.hidden = true; el.querySelector('[data-stop]').textContent = '✕ 清除'; }
  function stop() {
    cancelAnimationFrame(raf); playing = null; elapsed = 0; setPaused(false); pauseBtn.hidden = true;
    const b = el.querySelector('[data-stop]'); b.hidden = true; b.textContent = '■ 停止';
    paint();
  }

  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw();
  }));
  const playBtn = el.querySelector('[data-playall]');
  const syncPicks = () => {
    el.querySelectorAll('[data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(picked.has(Number(b.dataset.pick)))));
    playBtn.disabled = !picked.size;
    if (items.length > 1) playBtn.textContent = picked.size === items.length ? '▶ 全部播放比較' : picked.size ? `▶ 播放所選 ${picked.size} 趟` : '▶ 先選場次';
  };
  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.pick); if (picked.has(n)) picked.delete(n); else picked.add(n); syncPicks();
  }));
  el.querySelector('[data-pick-all]')?.addEventListener('click', () => { items.forEach(({ ride }) => picked.add(ride.no)); syncPicks(); });
  el.querySelector('[data-pick-none]')?.addEventListener('click', () => { picked.clear(); syncPicks(); });
  syncPicks();
  playBtn.addEventListener('click', () => { if (picked.size) start(items.map(({ ride }) => ride.no).filter((n) => picked.has(n))); });
  el.querySelector('[data-stop]').addEventListener('click', stop);
  pauseBtn.addEventListener('click', togglePause);
  el.querySelector('[data-speed]').addEventListener('change', (e) => { speed = Number(e.target.value); });
  draw();
  return { stop };
}
