/* 路線地圖：Leaflet（cdnjs）+ OpenStreetMap 底圖（濾鏡調淺）。有 data/tracks/<日期>.json 就畫實際軌跡，沒有就連休息站直線。 */
import { esc, ordinal } from './ride.js';
import { rideColor } from './rhythm.js';
import { loadTrack, trackAt } from './track.js';

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
let loading;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((ok, fail) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `${LEAFLET}leaflet.min.css`; document.head.append(css);
      const js = document.createElement('script'); js.src = `${LEAFLET}leaflet.min.js`;
      js.onload = () => ok(window.L); js.onerror = () => { loading = null; fail(new Error('地圖元件載入失敗')); };
      document.head.append(js);
    });
  }
  return loading;
}

const ll = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? [p.lat, p.lon] : null);

/* items: [{ride,a}]，placesById；回傳 { update(positions|null) } */
export function mountMap(el, items, placesById) {
  const api = { update() {} };
  el.innerHTML = `<div class="map"><div class="map__canvas" data-map role="region" aria-label="路線地圖"><p class="muted map__msg">地圖載入中…</p></div>
    ${items.length > 1 ? `<div class="map__keys">${items.map(({ ride }) => `<button type="button" class="key" data-key="${ride.no}" aria-pressed="true"><i style="background:${rideColor(ride.no)}"></i>${ordinal(ride.no)} ${ride.date.slice(0, 4)}</button>`).join('')}</div>` : ''}
    <p class="muted map__note" data-map-note hidden>沒有 GPS 軌跡的場次，以休息站之間的直線表示。</p></div>`;
  const box = el.querySelector('[data-map]');

  Promise.all([loadLeaflet(), Promise.all(items.map(({ ride }) => loadTrack(ride.date)))]).then(([L, trks]) => {
    const trackOf = Object.fromEntries(items.map(({ ride }, i) => [ride.no, trks[i]]));
    if (items.some(({ ride }) => !trackOf[ride.no])) el.querySelector('[data-map-note]').hidden = false;
    if (!el.isConnected) return;
    box.innerHTML = '';
    const map = L.map(box, { scrollWheelZoom: false, zoomSnap: 0.25 });
    // 和 Strava Heatmap 專案相同：OpenStreetMap 圖磚（不需要 API key），用 CSS 濾鏡調成淺色（.tiles-light）
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'tiles-light',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const lines = {}; const bounds = [];
    items.forEach(({ ride }) => {
      const pts = trackOf[ride.no] ? trackOf[ride.no].pts.map((p) => [p[0], p[1]]) : ride.stops.map((s) => ll(placesById[s.place])).filter(Boolean);
      if (pts.length < 2) return;
      bounds.push(...pts);
      lines[ride.no] = L.polyline(pts, { color: rideColor(ride.no), weight: 4, opacity: items.length > 1 ? 0.55 : 0.85 })
        .bindTooltip(`${ordinal(ride.no)} ${ride.date}`, { sticky: true }).addTo(map);
    });

    // 地點：這幾次用過的地點，標上停過幾次
    const used = new Map();
    items.forEach(({ ride }) => ride.stops.forEach((s, k) => {
      const u = used.get(s.place) || { n: 0, end: false }; u.n += 1; u.end = u.end || k === 0 || k === ride.stops.length - 1; used.set(s.place, u);
    }));
    used.forEach((u, id) => {
      const p = placesById[id]; const pos = ll(p); if (!pos) return;
      L.circleMarker(pos, { radius: u.end ? 7 : 5, color: '#1F2A26', weight: 1.5, fillColor: u.end ? '#1F2A26' : '#fff', fillOpacity: 1 })
        .bindTooltip(`<b>${esc(p.name)}</b>${p.sub ? `<br>${esc(p.sub)}${p.closed ? '（已歇業）' : ''}` : ''}${items.length > 1 ? `<br>停過 ${u.n} 次` : ''}`, { direction: 'top', offset: [0, -4] })
        .addTo(map);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] }); else map.setView([23.9, 120.6], 8);

    el.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on));
      const line = lines[b.dataset.key]; if (line) { if (on) line.addTo(map); else line.remove(); }
    }));

    // 播放時的騎車小人
    const riders = {};
    api.update = (positions) => {
      const live = new Set();
      (positions || []).forEach(({ ride, idx, f, state, clock }) => {
        let at;
        if (trackOf[ride.no]) at = trackAt(trackOf[ride.no], clock);
        else {
          const st = ride.stops; const a = ll(placesById[st[idx]?.place]); if (!a) return;
          const b = state === 'ride' ? ll(placesById[st[idx + 1]?.place]) : null;
          at = b ? [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] : a;
        }
        live.add(ride.no);
        if (!riders[ride.no]) {
          riders[ride.no] = L.marker(at, {
            interactive: false, zIndexOffset: 1000,
            icon: L.divIcon({ className: 'map-rider', html: `<span style="border-color:${rideColor(ride.no)}"><b>🚴</b></span><em style="background:${rideColor(ride.no)}">${ordinal(ride.no)}</em>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
          }).addTo(map);
        } else riders[ride.no].setLatLng(at);
      });
      Object.keys(riders).forEach((no) => { if (!live.has(Number(no))) { riders[no].remove(); delete riders[no]; } });
    };
  }).catch((err) => { box.innerHTML = `<p class="muted map__msg">${esc(err.message)}</p>`; });
  return { update: (p) => api.update(p) };
}
