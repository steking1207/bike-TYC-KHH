/* 一日桃高：從 data/rides.json 的原始紀錄算出停留、區段、總計。前台與後台共用。 */

export const INCIDENT_TYPES = {
  flat: { label: '爆胎', icon: '🛞' },
  crash: { label: '摔車', icon: '💥' },
  mechanical: { label: '機械故障', icon: '🔧' },
  join: { label: '會合', icon: '👋' },
  leave: { label: '中離', icon: '🚆' },
  weather: { label: '天氣', icon: '🌧️' },
  other: { label: '其他', icon: '📝' },
};
export const MEAL_TAGS = ['早餐', '中餐', '晚餐'];

export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const isTime = (t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t || '');
export const toMin = (t) => { if (!isTime(t)) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export function fmtDur(min) {
  if (min == null || Number.isNaN(min)) return '–';
  const h = Math.floor(min / 60); const m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
export const fmtKm = (km) => (km == null ? '–' : `${Math.round(km * 10) / 10}`);
export const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

// 停留分鐘；起點、終點沒有停留
export function stayOf(stop) {
  const a = toMin(stop.arrive); const d = toMin(stop.depart);
  return a != null && d != null ? d - a : 0;
}

/* 一次活動的完整計算結果 */
export function analyze(ride, placesById = {}) {
  const stops = ride.stops || [];
  const first = stops[0] || {}; const last = stops[stops.length - 1] || {};
  const start = toMin(first.depart ?? first.arrive);
  const end = toMin(last.arrive ?? last.depart);
  const total = start != null && end != null ? end - start : null;
  const rest = stops.slice(1, -1).reduce((s, x) => s + stayOf(x), 0);
  const km = last.km ?? null;
  const moving = total != null ? total - rest : null;
  const incidents = [...(ride.incidents || [])].sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
  const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.05;

  const segments = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]; const b = stops[i + 1];
    const t0 = toMin(a.depart ?? a.arrive); const t1 = toMin(b.arrive ?? b.depart);
    const dist = a.km != null && b.km != null ? b.km - a.km : null;
    const min = t0 != null && t1 != null ? t1 - t0 : null;
    segments.push({
      from: a, to: b, km: dist, min,
      speed: dist != null && min > 0 ? dist / (min / 60) : null,
      incidents: incidents.filter((x) => x.km > a.km && x.km < b.km && !near(x.km, a.km) && !near(x.km, b.km)),
    });
  }
  const stopIncidents = stops.map((s) => incidents.filter((x) => near(x.km, s.km)));
  return {
    total, rest, moving, km, start, end,
    avg: km && moving > 0 ? km / (moving / 60) : null,
    segments, stopIncidents, incidents,
    place: (id) => placesById[id] || { id, name: id || '?' },
  };
}

export function indexPlaces(data) { return Object.fromEntries((data.places || []).map((p) => [p.id, p])); }

/* 回傳要修正的問題清單（空陣列 = 沒問題） */
export function validateRide(ride, placesById) {
  const out = []; const tag = `第 ${ride.no || '?'} 次`;
  if (!ride.no || ride.no < 1) out.push(`${tag}：「第幾次」要填正整數。`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ride.date || '')) out.push(`${tag}：日期格式要是 YYYY-MM-DD。`);
  const stops = ride.stops || [];
  if (stops.length < 2) out.push(`${tag}：至少要有起點和終點兩個地點。`);
  let prevKm = -1; let prevT = -1;
  stops.forEach((s, i) => {
    const name = (placesById[s.place] || {}).name || `第 ${i + 1} 個地點`;
    if (!placesById[s.place]) out.push(`${tag}：第 ${i + 1} 個地點沒有選。`);
    const needArrive = i > 0; const needDepart = i < stops.length - 1;
    if (needArrive && !isTime(s.arrive)) out.push(`${tag}：${name} 的到達時間要填 HH:MM。`);
    if (needDepart && !isTime(s.depart)) out.push(`${tag}：${name} 的出發時間要填 HH:MM。`);
    if (s.km == null || Number.isNaN(s.km)) out.push(`${tag}：${name} 的里程沒有填。`);
    else if (s.km < prevKm) out.push(`${tag}：${name} 的里程比前一站少。`);
    const a = toMin(s.arrive); const d = toMin(s.depart);
    if (a != null && d != null && d < a) out.push(`${tag}：${name} 的出發時間比到達早。`);
    if (a != null && a < prevT) out.push(`${tag}：${name} 的到達時間比前一站出發早。`);
    prevKm = s.km ?? prevKm; prevT = d ?? a ?? prevT;
  });
  (ride.incidents || []).forEach((x, i) => {
    if (!INCIDENT_TYPES[x.type]) out.push(`${tag}：第 ${i + 1} 個突發狀況沒有選類型。`);
    if (x.km == null || Number.isNaN(x.km)) out.push(`${tag}：第 ${i + 1} 個突發狀況沒有填里程。`);
  });
  return out;
}
