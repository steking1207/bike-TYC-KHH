/* 首頁線稿動畫：海線風車、路面，與一位持續踩踏的公路車騎士。純 SVG，偏好減少動態時停在靜止畫面。 */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const f1 = (n) => n.toFixed(1);

function mill(x, h, dur, base) {
  const top = base - h; const b = h * 0.46;
  const blade = (deg) => `<path d="M0 0 C${f1(b * 0.12)} ${f1(-b * 0.3)} ${f1(b * 0.06)} ${f1(-b * 0.8)} 0 ${f1(-b)} C${f1(-b * 0.05)} ${f1(-b * 0.6)} ${f1(-b * 0.06)} ${f1(-b * 0.3)} 0 0Z" transform="rotate(${deg})"/>`;
  return `<g class="ra-mill"><path class="ra-soft" d="M${x - 2.4} ${base} L${x - 1} ${top} M${x + 2.4} ${base} L${x + 1} ${top}"/>
    <g transform="translate(${x} ${top})"><g class="ra-blades" style="animation-duration:${dur}s">${blade(0)}${blade(120)}${blade(240)}</g><circle r="2.2"/></g></g>`;
}

/* 騎士與車（面向右）。座標原點 = 後輪軸 */
const G = {
  R: 40, rear: [0, 0], front: [134, 0], bb: [53, 7], seat: [34, -60], hip: [36, -64],
  shoulder: [100, -92], hand: [131, -66], thigh: 46, shin: 47, crank: 15,
};
function wheel(cx) {
  let sp = '';
  for (let i = 0; i < 12; i += 1) { const a = (i / 12) * Math.PI * 2; sp += `M${f1(cx + Math.cos(a) * 3)} ${f1(Math.sin(a) * 3)} L${f1(cx + Math.cos(a + 0.35) * 35)} ${f1(Math.sin(a + 0.35) * 35)}`; }
  return `<g><circle class="ra-tire" cx="${cx}" cy="0" r="${G.R}"/><circle class="ra-rim" cx="${cx}" cy="0" r="35.5"/>
    <g class="ra-spin"><path class="ra-spoke" d="${sp}"/><path class="ra-valve" d="M${cx} -35.5 v4"/></g><circle class="ra-hub" cx="${cx}" cy="0" r="3"/></g>`;
}
function riderSvg() {
  const [bx, by] = G.bb;
  return `<g class="ra-rider">
    ${wheel(0)}${wheel(134)}
    <g class="ra-frame">
      <path d="M0 0 L${bx} ${by} L34 -50 Z"/>
      <path d="M34 -50 L111 -58 L${bx} ${by}"/>
      <path class="ra-thick" d="M111 -58 L116 -40"/>
      <path d="M116 -40 Q124 -18 134 0"/>
      <path d="M111 -58 L113 -64 L126 -66"/>
      <path class="ra-tape" d="M126 -66 Q138 -67 139 -58 Q140 -48 131 -45"/>
      <path class="ra-thick" d="M34 -50 L33 -58"/>
      <path class="ra-saddle" d="M22 -60 Q34 -63 46 -60"/>
      <rect class="ra-bottle" x="74" y="-34" width="16" height="7" rx="3" transform="rotate(-38 82 -30)"/>
      <circle class="ra-ring" cx="${bx}" cy="${by}" r="11"/>
      <path class="ra-chain" d="M${bx} ${by - 11} L0 -5 M${bx} ${by + 11} L0 5"/>
      <circle class="ra-ring" cx="0" cy="0" r="5"/>
    </g>
    <path class="ra-leg ra-leg--far" data-leg="1"/>
    <g class="ra-body" data-body>
      <path class="ra-torso" d="M${G.hip[0]} ${G.hip[1]} C52 -84 76 -96 ${G.shoulder[0]} ${G.shoulder[1]}"/>
      <path class="ra-arm" d="M${G.shoulder[0]} ${G.shoulder[1]} L112 -76 L${G.hand[0]} ${G.hand[1]}"/>
      <path class="ra-neck" d="M100 -92 L108 -98"/>
      <circle class="ra-head" cx="116" cy="-104" r="8.5"/>
      <path class="ra-helmet" d="M102 -108 Q108 -120 122 -116 Q128 -113 127 -107 L104 -106 Z"/>
      <path class="ra-visor" d="M120 -103 L127 -103"/>
    </g>
    <path class="ra-leg" data-leg="0"/>
    <g data-crank><path class="ra-crankarm" d=""/></g>
  </g>`;
}

/* 兩段式反向運動學：髖 → 膝 → 踏板 */
function legPath(t, bob) {
  const [bx, by] = G.bb; const hip = [G.hip[0], G.hip[1] + bob];
  const p = [bx + G.crank * Math.cos(t), by + G.crank * Math.sin(t)];
  const dx = p[0] - hip[0]; const dy = p[1] - hip[1];
  const D = Math.min(G.thigh + G.shin - 0.5, Math.hypot(dx, dy));
  const a = Math.atan2(dy, dx); const k = Math.acos((G.thigh ** 2 + D * D - G.shin ** 2) / (2 * G.thigh * D));
  const knee = [hip[0] + G.thigh * Math.cos(a - k), hip[1] + G.thigh * Math.sin(a - k)];
  const ankle = [p[0] - 2, p[1] - 4];
  return { d: `M${f1(hip[0])} ${f1(hip[1])} L${f1(knee[0])} ${f1(knee[1])} L${f1(ankle[0])} ${f1(ankle[1])} L${f1(p[0] + 9)} ${f1(p[1] + 1)}`, p };
}

export function mountRideArt(el) {
  const base = 196;
  let far = '';
  [[90, 120, 9], [330, 78, 7], [520, 140, 10], [820, 96, 8], [1100, 130, 9], [1360, 84, 7]].forEach(([x, h, d]) => { far += mill(x, h, d, base) + mill(x + 1600, h, d, base); });
  let speed = '';
  for (let i = 0; i < 5; i += 1) speed += `<path class="ra-speed" style="animation-delay:${(i * 0.23).toFixed(2)}s" d="M${640 - i * 10} ${118 + i * 17} h-${70 + i * 18}"/>`;
  el.innerHTML = `<svg viewBox="0 0 1600 270" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <g class="ra-far">${far}<path class="ra-soft" d="M0 ${base} H3200"/></g>
    <path class="ra-ground" d="M-50 256 H1700"/>
    <path class="ra-road" d="M-50 266 H1700"/>
    ${speed}
    <g transform="translate(690 202) scale(1.4)"><g class="ra-halo">${riderSvg()}</g>${riderSvg()}</g>
  </svg>`;
  const legs = [...el.querySelectorAll('[data-leg]')]; const bodies = [...el.querySelectorAll('[data-body]')]; const cranks = [...el.querySelectorAll('.ra-crankarm')];
  const pose = (th) => {
    const bob = Math.sin(th * 2) * 0.8;
    bodies.forEach((b) => b.setAttribute('transform', `translate(0 ${f1(bob)})`));
    legs.forEach((l) => { const r = legPath(th + Number(l.dataset.leg) * Math.PI, bob); l.setAttribute('d', r.d); });
    const [bx, by] = G.bb; const p0 = [bx + G.crank * Math.cos(th), by + G.crank * Math.sin(th)];
    cranks.forEach((c) => c.setAttribute('d', `M${bx} ${by} L${f1(p0[0])} ${f1(p0[1])}`));
  };
  if (REDUCED) { pose(0.6); el.classList.add('is-still'); return; }
  const t0 = performance.now(); let raf = 0; let visible = true;
  const loop = (t) => { if (!el.isConnected) return; pose(((t - t0) / 950) * Math.PI * 2); if (visible) raf = requestAnimationFrame(loop); };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; el.classList.toggle('is-paused', !visible); if (visible) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } }).observe(el);
  }
  raf = requestAnimationFrame(loop);
}
