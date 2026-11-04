/* 路線地圖：Leaflet（cdnjs）+ OpenStreetMap 底圖（濾鏡調淺）。有 data/tracks/<日期>.json 就畫實際軌跡，沒有就連休息站直線。 */
import { esc, ordinal } from './ride.js';
import { rideColor } from './rhythm.js';
import { loadTrack, trackAt } from './track.js';
import { mountWeather } from './weather.js';

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
export function mountMap(el, items, placesById, { player } = {}) {
  const api = { update() {} };
  el.innerHTML = `<div class="map">${player ? `<div class="map__play">
      ${items.length > 1 ? `<div class="map__ones" role="group" aria-label="單獨播放某一趟">${items.map(({ ride }) => `<button type="button" class="one" data-mp-one="${ride.no}" style="--c:${rideColor(ride.no)}" title="只播放 ${ordinal(ride.no)}（${ride.date}）"><span class="one__ic" aria-hidden="true">▶</span>${ordinal(ride.no)}</button>`).join('')}</div>` : ''}
      <button type="button" class="btn btn--sm btn--go" data-mp-play>▶ 播放</button>
      <button type="button" class="btn btn--sm" data-mp-stop hidden>■ 停止</button>
      <span class="clock num" data-mp-clock></span>
      <span class="map__play-note" data-mp-note hidden>多趟一起播放時不顯示天氣</span>
    </div>` : ''}<div class="map__canvas" data-map role="region" aria-label="路線地圖"><p class="muted map__msg">地圖載入中…</p></div>
    ${items.length > 1 ? `<div class="map__keys">${items.map(({ ride }) => `<button type="button" class="key" data-key="${ride.no}" aria-pressed="true"><i style="background:${rideColor(ride.no)}"></i>${ordinal(ride.no)} ${ride.date.slice(0, 4)}</button>`).join('')}</div>` : ''}
    <p class="muted map__note" data-map-note hidden>沒有 GPS 軌跡的場次，以休息站之間的直線表示。</p></div>`;
  const box = el.querySelector('[data-map]');

  // 播放鈕：和節奏區塊共用同一個播放器
  let ps = { playing: false };
  const mpPlay = el.querySelector('[data-mp-play]'); const mpStop = el.querySelector('[data-mp-stop]');
  mpPlay?.addEventListener('click', () => { if (ps.playing) player.togglePause(); else player.playPicked(); });
  mpStop?.addEventListener('click', () => player.stop());
  el.querySelectorAll('[data-mp-one]').forEach((b) => b.addEventListener('click', () => player.playOne(Number(b.dataset.mpOne))));
  function setPlayState(st) {
    ps = st; if (!mpPlay) return;
    mpPlay.textContent = st.playing ? (st.paused ? '▶ 繼續' : '❚❚ 暫停') : st.label;
    mpPlay.disabled = !st.playing && !st.canPlay;
    mpPlay.classList.toggle('btn--go', !st.playing || st.paused);
    mpStop.hidden = !st.playing && !st.finished; mpStop.textContent = st.finished ? '✕ 清除' : '■ 停止';
    el.querySelectorAll('[data-mp-one]').forEach((b) => {
      const solo = st.nos && st.nos.length === 1 && st.nos[0] === Number(b.dataset.mpOne) && (st.playing || st.finished);
      const run = solo && st.playing && !st.paused;
      b.setAttribute('aria-pressed', String(solo)); b.querySelector('.one__ic').textContent = run ? '❚❚' : '▶';
      b.title = `${run ? '暫停' : '只播放'} ${ordinal(Number(b.dataset.mpOne))}`;
    });
    el.querySelector('[data-mp-clock]').textContent = st.playing || st.finished ? st.clock : '';
  }

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
      L.circleMarker(pos, { radius: u.end ? 7 : 5, color: '#0B0F1A', weight: 1.5, fillColor: u.end ? '#0B0F1A' : '#fff', fillOpacity: 1 })
        .bindTooltip(`<b>${esc(p.name)}</b>${p.sub ? `<br>${esc(p.sub)}${p.closed ? '（已歇業）' : ''}` : ''}${items.length > 1 ? `<br>停過 ${u.n} 次` : ''}`, { direction: 'top', offset: [0, -4] })
        .addTo(map);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] }); else map.setView([23.9, 120.6], 8);

    // 當日天氣圖層（風場、降雨），播放時跟著時間變化
    const weather = mountWeather(L, map, map.getContainer(), items, trackOf);

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
      const note = el.querySelector('[data-mp-note]'); if (note) note.hidden = !(positions && positions.length > 1);
      weather.update(positions, (no) => { const r = riders[no]; if (!r) return null; const p = r.getLatLng(); return [p.lat, p.lng]; });
    };
  }).catch((err) => { box.innerHTML = `<p class="muted map__msg">${esc(err.message)}</p>`; });
  return { update: (p) => api.update(p), setPlayState };
}
