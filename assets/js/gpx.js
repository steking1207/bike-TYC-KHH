/* 讀 Strava 匯出的 GPX，算出累計里程並找出停留點。全部在瀏覽器執行，檔案不會上傳。 */

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* GPX 文字 → { name, points: [{ lat, lon, t(ms), temp? }] } */
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('這不是有效的 GPX 檔。');
  const pts = [...doc.getElementsByTagName('trkpt')].map((el) => {
    const time = el.getElementsByTagName('time')[0];
    const temp = [...el.getElementsByTagName('*')].find((x) => /(^|:)atemp$/.test(x.tagName));
    return {
      lat: parseFloat(el.getAttribute('lat')), lon: parseFloat(el.getAttribute('lon')),
      t: time ? Date.parse(time.textContent.trim()) : NaN,
      temp: temp ? parseFloat(temp.textContent) : undefined,
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t));
  if (pts.length < 2) throw new Error('GPX 裡沒有帶時間的軌跡點（請用 Strava 活動頁「匯出 GPX」）。');
  const name = (doc.getElementsByTagName('name')[0] || {}).textContent || '';
  return { name: name.trim(), points: pts };
}

/* 停留偵測：從某點開始，之後的點都在 radius 公尺內、且持續 minStop 分鐘以上，就算一次停留。
   Strava 自動暫停時軌跡會直接跳過一段時間，也會被這個規則抓到。 */
export function analyzeTrack(points, { radius = 150, minStop = 5, mergeGap = 3 } = {}) {
  const stops = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (j < points.length && haversine(points[i], points[j]) <= radius) j += 1;
    const last = j - 1;
    if (last > i && points[last].t - points[i].t >= minStop * 60000) {
      stops.push({ i, j: last, start: points[i].t, end: points[last].t, lat: points[i].lat, lon: points[i].lon });
      i = last + 1;
    } else i += 1;
  }
  // 同一個地方停兩段（例如移車、換位置）合併
  const merged = [];
  stops.forEach((s) => {
    const p = merged[merged.length - 1];
    if (p && s.start - p.end <= mergeGap * 60000 && haversine(p, s) <= 600) { p.end = s.end; p.j = s.j; } else merged.push({ ...s });
  });
  // 累計里程：停留期間的 GPS 漂移不算
  // 停留期間只算起點到終點的直線位移，不算來回漂移
  const still = new Int32Array(points.length).fill(-1);
  stops.forEach((st) => { for (let k = st.i + 1; k <= st.j; k += 1) still[k] = st.i; });
  const cum = [0];
  for (let k = 1; k < points.length; k += 1) {
    let d = 0;
    if (still[k] < 0) d = haversine(points[k - 1], points[k]);
    else if (k === points.length - 1 || still[k + 1] !== still[k]) d = haversine(points[still[k]], points[k]);
    cum.push(cum[k - 1] + d);
  }
  merged.forEach((st) => { st.km = cum[st.i] / 1000; });
  const first = points[0]; const last = points[points.length - 1];
  // 起點、終點附近的停留（出發前、到站後還沒按停止）不算休息點
  const inner = merged.filter((s) => s.i > 0 && s.j < points.length - 1);
  const temps = points.map((p) => p.temp).filter((x) => Number.isFinite(x));
  return {
    start: { t: first.t, lat: first.lat, lon: first.lon, km: 0 },
    end: { t: last.t, lat: last.lat, lon: last.lon, km: cum[cum.length - 1] / 1000 },
    stops: inner, all: merged, cum, points,
    temp: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
    head: merged[0] && merged[0].i === 0 ? merged[0] : null,
    tail: merged.length && merged[merged.length - 1].j === points.length - 1 ? merged[merged.length - 1] : null,
  };
}

/* 停留點 → 最可能的地點：有座標的用距離（500 公尺內）；沒有座標的，比對過去每次在該地點的里程（差 3 公里內最接近者） */
export function guessPlace(stop, places, kmHistory, used = new Set()) {
  let best = null; let bestScore = Infinity;
  places.forEach((p) => {
    if (used.has(p.id)) return;
    let score = Infinity;
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
      const d = haversine(stop, p); if (d <= 500) score = d / 1000;
    } else if (kmHistory[p.id]) {
      const d = Math.min(...kmHistory[p.id].map((k) => Math.abs(k - stop.km))); if (d <= 3) score = d + 1; // 座標比對優先
    }
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return best;
}

export function kmHistory(rides) {
  const h = {};
  rides.forEach((r) => (r.stops || []).forEach((s) => { if (s.km != null) (h[s.place] = h[s.place] || []).push(s.km); }));
  return h;
}

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* 軌跡簡化（Douglas–Peucker，容差 tol 公尺），存成 [[lat, lon, 當地分鐘], …] 給前台地圖畫路線、播放時對時間。
   隱私：出發點（第一個軌跡點）與 hide 裡每個點周圍 hideRadius 公尺內的軌跡點一律刪除，不會存進 repo。 */
export const HIDE_RADIUS = 200;
export function simplifyTrack(points, tol = 12, { hide = [], hideRadius = HIDE_RADIUS } = {}) {
  const centers = points.length ? [points[0], ...hide] : hide;
  points = points.filter((p) => centers.every((c) => haversine(p, c) > hideRadius));
  if (points.length < 3) return points.map((p) => [p.lat, p.lon, 0]);
  const lat0 = rad(points[0].lat);
  const xy = points.map((p) => [rad(p.lon) * Math.cos(lat0) * R, rad(p.lat) * R]);
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); const [ax, ay] = xy[i]; const [bx, by] = xy[j];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
    let best = -1; let bi = -1;
    for (let k = i + 1; k < j; k += 1) {
      const [px, py] = xy[k];
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best) { best = d; bi = k; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  // 以出發當天（台灣時間）午夜為 0 的分鐘數
  const day0 = Date.parse(`${new Date(points[0].t + 8 * 3600e3).toISOString().slice(0, 10)}T00:00:00+08:00`);
  return points.filter((_, k) => keep[k]).map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5), Math.round(((p.t - day0) / 60000) * 10) / 10]);
}
