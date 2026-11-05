/*
 * 背景騎乘動畫：canvas 固定在畫面底部、內容後方。
 * 右下角的控制列可直接切換畫風、場景、日夜，展開後再調線條濃淡與騎乘節奏；設定記在瀏覽器。
 * 動畫的日夜配色會同步到整個網站（底色連續變化，夜裡文字與卡片切成深色版）。
 */
import { mountAero } from './aero.js';

const KEY = 'tyckhh.aero.user'; // 只存訪客自己改過的項目，其餘用後台設定的預設值
const SEEN = 'tyckhh.aero.hint';
const STYLES = { sculpted: ['A', '塊面'], hatched: ['B', '版畫'], blueprint: ['C', '藍圖'], ribbon: ['D', '流線'] };
const SCENES = { city: '城市', hybrid: '山城混合', mountain: '群山', coast: '海邊' };
const TIMES = { auto: '自動日夜', day: '白天', dusk: '黃昏', night: '黑夜' };
const IC = {
  style: '<path d="M4 20c4 0 5-3 5-5a3 3 0 1 0-6 0c0 2-1 3-2 3"/><path d="M9 15 20 4"/>',
  hybrid: '<path d="m2 20 6-9 4 5 3-3 7 7Z"/><path d="M16 9V5h3v6"/>',
  city: '<path d="M3 21V9h6v12M9 21V4h7v17M16 21v-9h5v9M2 21h20"/>',
  mountain: '<path d="m2 20 7-11 4 6 3-4 6 9Z"/>',
  coast: '<path d="M2 17c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 21c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M12 3v10M12 3l5 8h-5"/>',
  auto: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3v6h-6"/>',
  day: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dusk: '<path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 9V2M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>',
  night: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  more: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h-1M15 9l-1.5-3H16"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;
export const AERO_DEFAULTS = { style: 'sculpted', scene: 'city', time: 'day', speed: 30, opacity: 0.5, on: true };
export const AERO_OPTIONS = { STYLES, SCENES, TIMES };
/* 後台存的預設值：不合法的欄位丟掉 */
function siteDefaults(d = {}) {
  const o = {};
  if (STYLES[d.style]) o.style = d.style;
  if (SCENES[d.scene]) o.scene = d.scene;
  if (TIMES[d.time]) o.time = d.time;
  if (Number.isFinite(d.speed)) o.speed = Math.min(55, Math.max(15, Math.round(d.speed)));
  if (Number.isFinite(d.opacity)) o.opacity = Math.min(1, Math.max(0.15, Math.round(d.opacity * 20) / 20));
  if (typeof d.on === 'boolean') o.on = d.on;
  return o;
}
const next = (obj, k) => { const ks = Object.keys(obj); return ks[(ks.indexOf(k) + 1) % ks.length]; };
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 無痕模式等 */ } },
};

export function mountAeroBackdrop(site) {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const base = { ...AERO_DEFAULTS, ...siteDefaults(site) };
  let user; try { user = JSON.parse(store.get(KEY, '{}')) || {}; } catch { user = {}; }
  const s = { ...base, ...siteDefaults(user) };
  const changed = new Set(Object.keys(siteDefaults(user)));
  const save = (k) => { if (k) changed.add(k); const o = {}; changed.forEach((x) => { o[x] = s[x]; }); store.set(KEY, JSON.stringify(o)); };

  const canvas = document.createElement('canvas');
  canvas.className = 'aero'; canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  // 日夜配色同步到網站
  let lastApply = 0; let clockEl = null;
  const applyPalette = (p, force) => {
    const now = performance.now();
    if (!force && now - lastApply < 120) return;
    lastApply = now;
    if (!s.on) return;
    const [r, g, b] = p.bgRgb;
    root.style.setProperty('--paper', `rgb(${r} ${g} ${b})`);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const sky = lum < 0.5 ? 'night' : p.duskF > 0.35 ? 'dusk' : 'day';
    if (root.dataset.sky !== sky) root.dataset.sky = sky;
    if (clockEl) {
      const h = Math.floor(p.timeOfDay); const m = Math.floor((p.timeOfDay - h) * 60);
      clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  };
  const art = mountAero(canvas, { ...s, onPalette: (p) => applyPalette(p, false) });

  const sync = () => {
    canvas.hidden = !s.on;
    dock.classList.toggle('is-off', !s.on);
    if (!s.on) { art.pause(); root.style.removeProperty('--paper'); delete root.dataset.sky; return; }
    lastApply = 0;
    if (reduced.matches || document.hidden) art.still(); else art.play();
  };

  // 控制列（右下角）
  const dock = document.createElement('div');
  dock.className = 'aero-dock';
  dock.innerHTML = `
    <div class="aero-dock__bar" role="toolbar" aria-label="背景動畫">
      <span class="aero-dock__tag">${svg('bike')}<span>背景</span></span>
      <button type="button" data-cycle="style" title="切換畫風"><b class="aero-dock__key" data-v="style-key"></b><span data-v="style"></span></button>
      <button type="button" data-cycle="scene" title="切換場景"><i data-v="scene-ic"></i><span data-v="scene"></span></button>
      <button type="button" data-cycle="time" title="切換日夜"><i data-v="time-ic"></i><span data-v="time"></span><small class="aero-dock__clock" data-v="clock"></small></button>
      <button type="button" class="aero-dock__more" aria-expanded="false" aria-controls="aero-panel" title="更多設定">${svg('more')}<span>調整</span></button>
    </div>
    <button type="button" class="aero-dock__on" data-a="turn-on">${svg('bike')}<span>開啟背景動畫</span></button>
    <p class="aero-dock__hint" role="note" hidden>背景的騎士可以換畫風、場景和日夜，點點看 👉<button type="button" aria-label="知道了">×</button></p>
    <div class="aero-panel" id="aero-panel" role="dialog" aria-label="背景動畫設定" hidden>
      <div class="aero-panel__head"><b>背景騎乘動畫</b><label class="aero-switch"><input type="checkbox" data-a="on" checked><span>顯示</span></label></div>
      <fieldset><legend>畫風</legend><div class="aero-opts aero-opts--4">${Object.entries(STYLES).map(([k, [l, n]]) => `<button type="button" data-set="style" data-k="${k}"><b>${l}</b>${n}</button>`).join('')}</div></fieldset>
      <fieldset><legend>場景</legend><div class="aero-opts aero-opts--4">${Object.entries(SCENES).map(([k, n]) => `<button type="button" data-set="scene" data-k="${k}">${svg(k)}${n}</button>`).join('')}</div></fieldset>
      <fieldset><legend>日夜</legend><div class="aero-opts aero-opts--4">${Object.entries(TIMES).map(([k, n]) => `<button type="button" data-set="time" data-k="${k}">${svg(k)}${n.replace('自動日夜', '自動')}</button>`).join('')}</div>
        <p class="aero-panel__note">「自動」約 36 秒走完一天，網站顏色也會跟著變。</p></fieldset>
      <label class="aero-range"><span>線條濃淡</span><input type="range" min="0.15" max="1" step="0.05" data-r="opacity"><output></output></label>
      <label class="aero-range"><span>騎乘節奏</span><input type="range" min="15" max="55" step="1" data-r="speed"><output></output></label>
      <div class="aero-panel__foot"><button type="button" class="aero-panel__reset" data-a="reset">恢復網站預設</button><a class="aero-panel__link" href="aero/" target="_blank" rel="noopener">開啟全螢幕獨立頁 ↗</a></div>
    </div>`;
  document.body.append(dock);
  clockEl = dock.querySelector('[data-v="clock"]');
  const panel = dock.querySelector('.aero-panel'); const more = dock.querySelector('.aero-dock__more');
  const hint = dock.querySelector('.aero-dock__hint');

  const render = () => {
    const q = (k) => dock.querySelector(`[data-v="${k}"]`);
    q('style-key').textContent = STYLES[s.style][0]; q('style').textContent = STYLES[s.style][1];
    q('scene-ic').innerHTML = svg(s.scene); q('scene').textContent = SCENES[s.scene];
    q('time-ic').innerHTML = svg(s.time); q('time').textContent = TIMES[s.time];
    clockEl.hidden = s.time !== 'auto';
    panel.querySelectorAll('[data-set]').forEach((b) => b.setAttribute('aria-pressed', String(s[b.dataset.set] === b.dataset.k)));
    panel.querySelectorAll('[data-r]').forEach((r) => {
      const k = r.dataset.r; r.value = s[k];
      r.nextElementSibling.textContent = k === 'speed' ? `${s[k]} km/h` : `${Math.round(s[k] * 100)}%`;
    });
    panel.querySelector('[data-a="on"]').checked = s.on;
  };
  const seen = () => { hint.hidden = true; store.set(SEEN, '1'); };
  const setOpt = (k, v) => {
    s[k] = v; save(k); art.set({ [k]: v }); render(); seen();
    dock.classList.remove('is-pop'); void dock.offsetWidth; dock.classList.add('is-pop');
  };
  dock.querySelectorAll('[data-cycle]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cycle; setOpt(k, next(k === 'style' ? STYLES : k === 'scene' ? SCENES : TIMES, s[k]));
  }));
  panel.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => setOpt(b.dataset.set, b.dataset.k)));
  panel.querySelectorAll('[data-r]').forEach((r) => r.addEventListener('input', () => {
    const v = Number(r.value); s[r.dataset.r] = v; save(r.dataset.r); art.set({ [r.dataset.r]: v });
    r.nextElementSibling.textContent = r.dataset.r === 'speed' ? `${v} km/h` : `${Math.round(v * 100)}%`; seen();
  }));
  panel.querySelector('[data-a="on"]').addEventListener('change', (e) => { s.on = e.target.checked; save('on'); sync(); seen(); });
  panel.querySelector('[data-a="reset"]').addEventListener('click', () => {
    changed.clear(); store.set(KEY, '{}'); Object.assign(s, base);
    art.set({ style: s.style, scene: s.scene, time: s.time, speed: s.speed, opacity: s.opacity }); render(); sync();
  });
  dock.querySelector('[data-a="turn-on"]').addEventListener('click', () => { s.on = true; save('on'); render(); sync(); });
  hint.querySelector('button').addEventListener('click', seen);

  const open = (v) => { panel.hidden = !v; more.setAttribute('aria-expanded', String(v)); };
  more.addEventListener('click', () => { open(panel.hidden); seen(); });
  document.addEventListener('click', (e) => { if (!dock.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); more.focus(); } });

  render(); sync();
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener?.('change', sync);
  if (s.on && !store.get(SEEN, '')) setTimeout(() => { hint.hidden = false; }, 1600);
}
