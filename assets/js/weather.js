/* 當日天氣圖層（類似 Windy）：風場流線粒子＋風速色、降雨色。
   資料是 data/weather/<日期>.json（tools/fetch_weather.py 從 Open-Meteo 歷史資料預先抓好的逐時格點），
   在格點間做雙線性內插、小時之間做線性內插，所以播放時會連續變化。 */
import { esc, ordinal } from './ride.js';
import { trackAt } from './track.js';
import { fetchWeatherDay } from './wxfetch.js';

const cache = {};
const unpack = (j) => {
  if (!j || !Array.isArray(j.u) || !j.u.length) return null;
  const s = j.scale || 10;
  const f = (arr) => arr.map((h) => Float32Array.from(h, (x) => x / s));
  return { ...j, u: f(j.u), v: f(j.v), rain: f(j.rain), temp: j.temp ? f(j.temp) : null };
};
/* 先讀 repo 裡存好的檔；沒有的話直接向 Open-Meteo 抓（後台下次發佈時會存起來） */
export function loadWeather(date) {
  if (!cache[date]) {
    cache[date] = fetch(`data/weather/${date}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => j || fetchWeatherDay(date))
      .then(unpack)
      .catch((err) => { delete cache[date]; return { error: err.message }; });
  }
  return cache[date];
}

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const DIRS = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
/* 風從哪裡吹來（u, v 是往哪裡吹） */
const dirName = (u, v) => DIRS[Math.round(((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 / 22.5) % 16];

/* 色階：[值, r, g, b, a] */
const WIND_RAMP = [[0, 98, 113, 183, 0], [2, 57, 97, 159, 0.30], [4, 74, 148, 169, 0.36], [6, 77, 141, 123, 0.40], [8, 83, 165, 83, 0.42], [11, 162, 163, 64, 0.46], [14, 208, 141, 58, 0.50], [17, 205, 88, 70, 0.54], [21, 160, 50, 120, 0.58]];
const RAIN_RAMP = [[0.05, 120, 180, 255, 0], [0.2, 120, 180, 255, 0.35], [1, 54, 126, 230, 0.55], [3, 30, 80, 210, 0.66], [6, 90, 40, 200, 0.74], [12, 170, 40, 170, 0.80], [25, 220, 40, 90, 0.85]];
function ramp(R, x) {
  if (x <= R[0][0]) return R[0];
  for (let i = 1; i < R.length; i += 1) {
    if (x <= R[i][0]) {
      const a = R[i - 1]; const b = R[i]; const f = (x - a[0]) / (b[0] - a[0]);
      return [x, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4] + (b[4] - a[4]) * f];
    }
  }
  return R[R.length - 1];
}
const css = (c, alpha) => `rgba(${c[1] | 0},${c[2] | 0},${c[3] | 0},${alpha})`;

/* 一天的資料 → 某個時刻的場 */
function frameAt(W, minute) {
  const h = Math.max(0, Math.min(W.u.length - 1, minute / 60));
  const i = Math.floor(h); const j = Math.min(W.u.length - 1, i + 1); const f = h - i;
  const mix = (A) => { const a = A[i]; const b = A[j]; const out = new Float32Array(a.length); for (let k = 0; k < a.length; k += 1) out[k] = a[k] + (b[k] - a[k]) * f; return out; };
  return { u: mix(W.u), v: mix(W.v), rain: mix(W.rain), temp: W.temp ? mix(W.temp) : null };
}
/* 雙線性內插；格點外回傳 null */
function sampler(W) {
  return (arr, lat, lon) => {
    const y = (lat - W.lat0) / W.dlat; const x = (lon - W.lon0) / W.dlon;
    if (x < 0 || y < 0 || x > W.nlon - 1 || y > W.nlat - 1) return null;
    const x0 = Math.min(W.nlon - 2, Math.floor(x)); const y0 = Math.min(W.nlat - 2, Math.floor(y));
    const fx = x - x0; const fy = y - y0; const n = W.nlon; const k = y0 * n + x0;
    return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fy) + (arr[k + n] * (1 - fx) + arr[k + n + 1] * fx) * fy;
  };
}

/* 掛在 Leaflet 地圖上。items: [{ride,a}]；trackOf: {no: track}。回傳 { update(positions|null) } */
export function mountWeather(L, map, host, items, trackOf) {
  const byNo = Object.fromEntries(items.map((it) => [it.ride.no, it]));
  const latest = Math.max(...items.map((it) => it.ride.no));
  const state = { layer: 'wind', no: latest, minute: null, W: null, F: null, playing: false, multi: false };

  // ---- 畫布：放在自己的 pane（磚圖之上、路線之下） ----
  const pane = map.createPane('weather'); pane.style.zIndex = 350; pane.style.pointerEvents = 'none';
  const field = L.DomUtil.create('canvas', 'wx-field', pane);
  const flow = L.DomUtil.create('canvas', 'wx-flow', pane);
  const small = document.createElement('canvas');
  let W = 0; let H = 0; let dpr = 1; const STEP = 4;

  // ---- 控制面板 ----
  const ui = document.createElement('div');
  ui.className = 'wx';
  ui.innerHTML = `<div class="wx__bar">
      <div class="wx__layers" role="group" aria-label="天氣圖層">
        <button type="button" data-wx="wind" aria-pressed="true">💨 風</button><button type="button" data-wx="rain" aria-pressed="false">🌧️ 雨</button><button type="button" data-wx="off" aria-pressed="false">關</button>
      </div>
      ${items.length > 1 ? `<label class="wx__day">哪一天 <select data-wx-day>${items.map(({ ride }) => `<option value="${ride.no}"${ride.no === latest ? ' selected' : ''}>${ordinal(ride.no)} ${ride.date}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="wx__panel">
      <div class="wx__time">
        <span class="wx__clock num" data-wx-clock>--:--</span>
        <input type="range" min="0" max="1439" step="5" value="360" data-wx-range aria-label="天氣時刻">
      </div>
      <p class="wx__here" data-wx-here></p>
      <div class="wx__legend" data-wx-legend></div>
      <p class="wx__msg" data-wx-msg hidden></p>
    </div>`;
  host.append(ui);
  L.DomEvent.disableClickPropagation(ui); L.DomEvent.disableScrollPropagation(ui);
  const range = ui.querySelector('[data-wx-range]');
  const clock = ui.querySelector('[data-wx-clock]');
  const here = ui.querySelector('[data-wx-here]');
  const msg = ui.querySelector('[data-wx-msg]');

  function legend() {
    const box = ui.querySelector('[data-wx-legend]');
    if (state.layer === 'off') { box.innerHTML = ''; return; }
    const R = state.layer === 'wind' ? WIND_RAMP : RAIN_RAMP;
    const stops = R.map((c, i) => `${css(c, Math.min(1, c[4] + 0.3))} ${(i / (R.length - 1)) * 100}%`).join(',');
    const ticks = state.layer === 'wind'
      ? R.filter((_, i) => i % 2 === 0).map((c) => Math.round(c[0] * 3.6))
      : [0, 0.2, 1, 3, 6, 12, 25];
    box.innerHTML = `<span class="wx__unit">${state.layer === 'wind' ? '風速 km/h' : '雨量 mm/h'}</span>
      <span class="wx__ramp"><i style="background:linear-gradient(90deg,${stops})"></i><span>${ticks.map((t) => `<b>${t}</b>`).join('')}</span></span>`;
  }

  // ---- 時間與資料 ----
  function rideSpan(no) {
    const { a } = byNo[no]; return [Math.max(0, Math.floor((a.start ?? 240) / 60) * 60 - 60), Math.min(1439, Math.ceil((a.end ?? 1200) / 60) * 60 + 60)];
  }
  function setDay(no) {
    state.no = no; state.W = null; state.F = null;
    const [lo, hi] = rideSpan(no); range.min = lo; range.max = hi;
    if (!state.playing) setMinute(byNo[no].a.start ?? lo);
    const sel = ui.querySelector('[data-wx-day]'); if (sel) sel.value = String(no);
    msg.hidden = false; msg.textContent = '天氣資料載入中…'; ui.classList.add('is-empty'); clearAll();
    loadWeather(byNo[no].ride.date).then((w) => {
      if (state.no !== no) return;
      const err = w && w.error; if (err) w = null;
      state.W = w;
      msg.hidden = !!w; ui.classList.toggle('is-empty', !w);
      if (!w) msg.textContent = err ? `天氣資料載入失敗：${err}` : `${byNo[no].ride.date} 的天氣資料還沒出來（再分析資料約晚 5 天），過幾天再來看。`;
      refresh();
    });
  }
  function setMinute(m) {
    state.minute = m; range.value = String(Math.round(m)); clock.textContent = hhmm(m);
    refresh();
  }
  let lastKey = '';
  function refresh() {
    if (!state.W || state.multi) { clearAll(); return; }
    state.F = frameAt(state.W, state.minute);
    // 播放時每一幀都會呼叫：場的底色每 2 分鐘（資料時間）才重畫一次
    const key = `${state.layer}|${Math.round(state.minute / 2)}|${W}x${H}|${map.getZoom()}|${map.getCenter().toString()}`;
    if (key !== lastKey) { lastKey = key; drawField(); }
    if (state.layer !== 'wind' || REDUCED) drawArrows();
    readout();
  }

  // ---- 底色（風速或雨量） ----
  function resize() {
    const s = map.getSize(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = s.x; H = s.y;
    [field, flow].forEach((c) => { c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`; });
    small.width = Math.ceil(W / STEP); small.height = Math.ceil(H / STEP);
    place();
  }
  function place() { const p = map.containerPointToLayerPoint([0, 0]); L.DomUtil.setPosition(field, p); L.DomUtil.setPosition(flow, p); }
  function clearAll() {
    field.getContext('2d').clearRect(0, 0, field.width, field.height);
    flow.getContext('2d').clearRect(0, 0, flow.width, flow.height);
    lastKey = '';
  }
  function drawField() {
    const ctx = field.getContext('2d'); ctx.clearRect(0, 0, field.width, field.height);
    if (state.layer === 'off' || !state.F) return;
    const sw = small.width; const sh = small.height; const sx = small.getContext('2d');
    const img = sx.createImageData(sw, sh); const d = img.data;
    const lons = new Float64Array(sw); const lats = new Float64Array(sh);
    for (let x = 0; x < sw; x += 1) lons[x] = map.containerPointToLatLng([x * STEP + STEP / 2, 0]).lng;
    for (let y = 0; y < sh; y += 1) lats[y] = map.containerPointToLatLng([0, y * STEP + STEP / 2]).lat;
    const at = sampler(state.W); const F = state.F; const wind = state.layer === 'wind'; const R = wind ? WIND_RAMP : RAIN_RAMP;
    const Wd = state.W; // 格點邊緣淡出，避免出現一條硬邊
    const edge = (lat, lon) => { const gx = (lon - Wd.lon0) / Wd.dlon; const gy = (lat - Wd.lat0) / Wd.dlat; return Math.max(0, Math.min(1, Math.min(gx, gy, Wd.nlon - 1 - gx, Wd.nlat - 1 - gy) / 2)); };
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        let val;
        if (wind) { const u = at(F.u, lats[y], lons[x]); if (u == null) continue; const v = at(F.v, lats[y], lons[x]); val = Math.hypot(u, v); } else { val = at(F.rain, lats[y], lons[x]); if (val == null) continue; }
        const c = ramp(R, val); const o = (y * sw + x) * 4;
        d[o] = c[1]; d[o + 1] = c[2]; d[o + 2] = c[3]; d[o + 3] = c[4] * 255 * edge(lats[y], lons[x]);
      }
    }
    sx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, sw * STEP * dpr, sh * STEP * dpr);
  }

  // ---- 風場粒子（Windy 那種流線） ----
  let parts = []; let raf = 0; let moving = false;
  const wantFlow = () => state.layer === 'wind' && !!state.F && !state.multi && !REDUCED && !moving && !document.hidden && host.isConnected;
  function spawn(p) { p.x = Math.random() * W; p.y = Math.random() * H; p.age = Math.random() * 80 | 0; p.px = p.x; p.py = p.y; return p; }
  function seed() { const n = Math.round(Math.min(2400, (W * H) / 900)); parts = Array.from({ length: n }, () => spawn({})); }
  function tick() {
    raf = 0;
    if (!wantFlow()) return;
    const ctx = flow.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    const at = sampler(state.W); const F = state.F;
    // 每 m/s 每幀移動的像素：拉近時慢一點，看起來比較像真的流速
    const k = 0.22 * Math.max(0.6, Math.min(2, 2 ** ((map.getZoom() - 8) * 0.4)));
    ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    parts.forEach((p) => {
      const ll = map.containerPointToLatLng([p.x, p.y]);
      const u = at(F.u, ll.lat, ll.lng); const v = u == null ? null : at(F.v, ll.lat, ll.lng);
      p.age += 1;
      if (u == null || p.age > 90 || p.x < 0 || p.y < 0 || p.x > W || p.y > H) { spawn(p); p.age = 0; return; }
      p.px = p.x; p.py = p.y; p.x += u * k; p.y -= v * k;
      ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf && wantFlow()) raf = requestAnimationFrame(tick); }

  /* 不想要動畫的人、以及雨圖層：畫靜態風向箭頭 */
  function drawArrows() {
    const ctx = flow.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (state.layer === 'off' || !state.F) return;
    const at = sampler(state.W); const F = state.F; const gap = 64;
    ctx.strokeStyle = state.layer === 'rain' ? 'rgba(11,15,26,.45)' : 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (let y = gap / 2; y < H; y += gap) {
      for (let x = gap / 2; x < W; x += gap) {
        const ll = map.containerPointToLatLng([x, y]); const u = at(F.u, ll.lat, ll.lng); if (u == null) continue; const v = at(F.v, ll.lat, ll.lng);
        const s = Math.hypot(u, v); if (s < 0.3) continue;
        const len = Math.min(26, 8 + s * 2); const dx = (u / s) * len; const dy = (-v / s) * len;
        const x0 = x - dx / 2; const y0 = y - dy / 2; const x1 = x + dx / 2; const y1 = y + dy / 2; const a = Math.atan2(dy, dx);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.lineTo(x1 - 6 * Math.cos(a - 0.5), y1 - 6 * Math.sin(a - 0.5)); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 6 * Math.cos(a + 0.5), y1 - 6 * Math.sin(a + 0.5));
        ctx.stroke();
      }
    }
  }

  // ---- 騎士所在位置的天氣：風向、風速、順逆風、雨量 ----
  let riderPos = null;
  function readout() {
    if (!state.F) { here.textContent = ''; return; }
    const at = sampler(state.W); const F = state.F;
    const tr = trackOf[state.no];
    const pos = riderPos || (tr ? trackAt(tr, state.minute) : null);
    if (!pos) { here.textContent = ''; return; }
    const u = at(F.u, pos[0], pos[1]); const v = at(F.v, pos[0], pos[1]); if (u == null) { here.textContent = ''; return; }
    const s = Math.hypot(u, v); const rain = at(F.rain, pos[0], pos[1]); const temp = F.temp ? at(F.temp, pos[0], pos[1]) : null;
    let rel = '';
    if (tr && s >= 0.8) {
      const a = trackAt(tr, state.minute - 2); const b = trackAt(tr, state.minute + 2);
      const hx = (b[1] - a[1]) * Math.cos((pos[0] * Math.PI) / 180); const hy = b[0] - a[0]; const hl = Math.hypot(hx, hy);
      if (hl > 1e-5) {
        const along = (u * hx + v * hy) / hl; // 正值 = 順風
        rel = Math.abs(along) < s * 0.4 ? '側風' : along > 0 ? `順風 ${Math.round(along * 3.6)}` : `逆風 ${Math.round(-along * 3.6)}`;
      }
    }
    here.innerHTML = `<b>${esc(state.playing ? '騎士位置' : '路線上')}</b> ${s < 0.3 ? '無風' : `${dirName(u, v)}風 ${Math.round(s * 3.6)} km/h`}${rel ? ` · <em class="${rel.startsWith('逆') ? 'is-head' : rel.startsWith('順') ? 'is-tail' : ''}">${rel}${rel === '側風' ? '' : ' km/h'}</em>` : ''}${rain >= 0.1 ? ` · 🌧️ ${rain.toFixed(1)} mm` : ''}${temp != null ? ` · ${Math.round(temp)}°C` : ''}`;
  }

  // ---- 事件 ----
  ui.querySelectorAll('[data-wx]').forEach((b) => b.addEventListener('click', () => {
    state.layer = b.dataset.wx;
    ui.querySelectorAll('[data-wx]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    ui.classList.toggle('is-off', state.layer === 'off');
    clearAll(); legend(); refresh(); kick();
  }));
  ui.querySelector('[data-wx-day]')?.addEventListener('change', (e) => setDay(Number(e.target.value)));
  range.addEventListener('input', () => { if (!state.playing) { riderPos = null; setMinute(Number(range.value)); } });
  map.on('movestart zoomstart', () => { moving = true; flow.getContext('2d').clearRect(0, 0, flow.width, flow.height); field.style.opacity = '0'; });
  map.on('moveend zoomend', () => { moving = false; place(); field.style.opacity = ''; lastKey = ''; refresh(); seed(); kick(); });
  map.on('resize', () => { resize(); lastKey = ''; refresh(); seed(); kick(); });
  document.addEventListener('visibilitychange', kick);

  map.attributionControl?.addAttribution('<a href="https://open-meteo.com/">Open-Meteo</a>');
  resize(); seed(); legend(); setDay(latest);
  requestAnimationFrame(kick);
  const t = setInterval(() => { if (!host.isConnected) { clearInterval(t); cancelAnimationFrame(raf); } else kick(); }, 1000);

  return {
    /* positions：節奏播放每一幀的 [{ride, clock, …}]；null = 沒在播 */
    update(positions, riderAt) {
      const list = positions || [];
      // 兩趟以上一起播放時是不同日期，天氣對不起來，先整個藏起來
      const multi = list.length > 1;
      if (multi !== state.multi) { state.multi = multi; ui.hidden = multi; if (!multi) { lastKey = ''; refresh(); kick(); } }
      if (multi) { clearAll(); return; }
      state.playing = list.length > 0;
      ui.classList.toggle('is-live', state.playing);
      range.disabled = state.playing;
      if (!state.playing) { riderPos = null; readout(); return; }
      let p = list.find((x) => x.ride.no === state.no);
      if (!p) { p = list[0]; setDay(p.ride.no); }
      riderPos = riderAt ? riderAt(p.ride.no) : null;
      setMinute(p.clock);
      kick();
    },
  };
}
