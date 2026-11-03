/* 簡化軌跡 data/tracks/<日期>.json：[[lat, lon, 當天分鐘], …]。地圖與節奏播放共用。 */
const cache = {};
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = rad(b[0] - a[0]); const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/* 回傳 { pts, cum }（cum = 累計公尺），沒有軌跡回傳 null */
export function loadTrack(date) {
  if (!cache[date]) {
    cache[date] = fetch(`data/tracks/${date}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const pts = j && Array.isArray(j.pts) && j.pts.length > 1 ? j.pts : null;
      if (!pts) return null;
      const cum = [0]; for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
      return { pts, cum };
    }).catch(() => null);
  }
  return cache[date];
}

function locate(tr, m) {
  const { pts } = tr; const n = pts.length - 1;
  if (m <= pts[0][2]) return [0, 0, 0];
  if (m >= pts[n][2]) return [n, n, 0];
  let lo = 0; let hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][2] <= m) lo = mid; else hi = mid; }
  return [lo, hi, (m - pts[lo][2]) / (pts[hi][2] - pts[lo][2] || 1)];
}
/* 某個時刻（當地分鐘）的位置 [lat, lon] */
export function trackAt(tr, m) {
  const [i, j, f] = locate(tr, m); const a = tr.pts[i]; const b = tr.pts[j];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
/* 某個時刻已騎的軌跡距離（公尺） */
export function distAt(tr, m) {
  const [i, j, f] = locate(tr, m);
  return tr.cum[i] + (tr.cum[j] - tr.cum[i]) * f;
}
