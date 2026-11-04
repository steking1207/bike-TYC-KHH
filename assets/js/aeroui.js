/* 背景騎乘動畫：固定在畫面底部，右上角「畫風」面板可調畫風、騎乘節奏、線條濃淡，設定記在瀏覽器裡。 */
import { mountAero } from './aero.js';

const KEY = 'tyckhh.aero';
const STYLES = [
  ['sculpted', 'A', '塊面線稿'],
  ['hatched', 'B', '版畫排線'],
  ['blueprint', 'C', '工程藍圖'],
  ['ribbon', 'D', '風洞流線'],
];
const DEF = { style: 'sculpted', speed: 30, opacity: 0.6, on: true };

function load() {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEF }; }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 無痕模式等 */ } }

export function mountAeroBackdrop() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const s = load();
  const canvas = document.createElement('canvas');
  canvas.className = 'aero'; canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const art = mountAero(canvas, s);

  const sync = () => {
    canvas.hidden = !s.on;
    if (!s.on) { art.pause(); return; }
    if (reduced.matches || document.hidden) art.still(); else art.play();
  };
  sync();
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener?.('change', sync);

  // 面板
  const nav = document.querySelector('.top .nav');
  const wrap = document.createElement('div');
  wrap.className = 'aero-ctl';
  wrap.innerHTML = `<button type="button" class="aero-ctl__btn" aria-expanded="false" aria-controls="aero-panel" title="背景動畫設定">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h-1M15 9l-1.5-3H16"/></svg>
      <span>畫風</span></button>
    <div class="aero-panel" id="aero-panel" role="dialog" aria-label="背景動畫設定" hidden>
      <div class="aero-panel__row aero-panel__head"><b>背景騎乘動畫</b>
        <label class="aero-switch"><input type="checkbox" data-a="on"${s.on ? ' checked' : ''}><span>顯示</span></label></div>
      <fieldset class="aero-panel__styles"><legend>畫風</legend>
        ${STYLES.map(([k, l, n]) => `<button type="button" data-style="${k}" aria-pressed="${s.style === k}"><b>${l}</b>${n}</button>`).join('')}
      </fieldset>
      <label class="aero-panel__range"><span>騎乘節奏</span><input type="range" min="15" max="55" step="1" value="${s.speed}" data-a="speed"><output>${s.speed} km/h</output></label>
      <label class="aero-panel__range"><span>線條濃淡</span><input type="range" min="0.15" max="1" step="0.05" value="${s.opacity}" data-a="opacity"><output>${Math.round(s.opacity * 100)}%</output></label>
      <a class="aero-panel__link" href="aero/" target="_blank" rel="noopener">開啟獨立頁 ↗</a>
    </div>`;
  nav.after(wrap);
  const btn = wrap.querySelector('.aero-ctl__btn'); const panel = wrap.querySelector('.aero-panel');
  const open = (v) => { panel.hidden = !v; btn.setAttribute('aria-expanded', String(v)); };
  btn.addEventListener('click', () => open(panel.hidden));
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); btn.focus(); } });

  panel.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
    s.style = b.dataset.style; save(s); art.set({ style: s.style });
    panel.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (!s.on) { s.on = true; panel.querySelector('[data-a="on"]').checked = true; save(s); sync(); }
  }));
  panel.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    const v = Number(r.value); s[r.dataset.a] = v; save(s); art.set({ [r.dataset.a]: v });
    r.nextElementSibling.textContent = r.dataset.a === 'speed' ? `${v} km/h` : `${Math.round(v * 100)}%`;
  }));
  panel.querySelector('[data-a="on"]').addEventListener('change', (e) => { s.on = e.target.checked; save(s); sync(); });
}
