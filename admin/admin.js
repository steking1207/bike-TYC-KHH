/* 一日桃高 紀錄管理 — 編輯 data/rides.json，直接用 GitHub API 發佈成一個 commit。
   全部在瀏覽器執行；權杖只會送到 api.github.com。登入方式沿用 SK2 作品集後台。 */
import { parseGpx, analyzeTrack, guessPlace, kmHistory, hhmm, ymd, simplifyTrack } from '../assets/js/gpx.js';
import { fetchWeatherDay } from '../assets/js/wxfetch.js';
import { AERO_DEFAULTS, AERO_OPTIONS } from '../assets/js/aeroui.js';
import { INCIDENT_TYPES, MEAL_TAGS, esc, analyze, indexPlaces, validateRide, fmtDur, fmtKm, ordinal, stayOf } from '../assets/js/ride.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DATA_PATH = 'data/rides.json';
const store = (s) => ({
  get(k) { try { return s().getItem(k); } catch (e) { return null; } },
  set(k, v) { try { s().setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { s().removeItem(k); } catch (e) { /* noop */ } },
});
const LS = store(() => localStorage); const SS = store(() => sessionStorage);
const clone = (o) => JSON.parse(JSON.stringify(o));

const state = { data: null, original: null, sha: null, selected: null, dirty: false, tracks: {} }; // tracks：待發佈的 GPX 軌跡，key = 日期

/* ---------------- settings & login ---------------- */
function defaults() {
  const host = location.hostname; const parts = location.pathname.split('/').filter(Boolean);
  const owner = host.endsWith('.github.io') ? host.replace('.github.io', '') : 'steking1207';
  const repo = host.endsWith('.github.io') && parts[0] && parts[0] !== 'admin' ? parts[0] : 'bike-TYC-KHH';
  return { owner, repo, branch: 'main' };
}
const getToken = () => SS.get('tyc:token') || LS.get('tyc:token') || '';
function setToken(t, remember) { SS.del('tyc:token'); LS.del('tyc:token'); if (t) (remember ? LS : SS).set('tyc:token', t); }
function settings() {
  let s = {}; try { s = JSON.parse(LS.get('tyc:gh') || '{}'); } catch (e) { s = {}; }
  return { ...defaults(), ...s, token: getToken() };
}
const saveSettings = ({ owner, repo, branch }) => LS.set('tyc:gh', JSON.stringify({ owner, repo, branch }));
function logout() {
  if (state.dirty && !confirm('有未發佈的變更，登出後會保留在草稿中。確定登出？')) return;
  setToken(''); location.reload();
}

/* 只有權杖能 push 到這個 repo 的人才進得來 */
async function verifyAccess() {
  if (!settings().token) return { ok: false };
  try {
    const repo = await gh('');
    if (!repo.permissions || !repo.permissions.push) return { ok: false, msg: '這組權杖沒有這個 repo 的寫入權限。' };
    return { ok: true };
  } catch (err) { return { ok: false, msg: err.message }; }
}
function showLogin(msg = '') {
  const s = settings(); const el = $('[data-login]'); el.hidden = false; document.body.classList.add('is-locked');
  const f = $('[data-login-form]');
  f.elements.owner.value = s.owner; f.elements.repo.value = s.repo; f.elements.branch.value = s.branch;
  $('[data-repo-name]').textContent = s.repo;
  const q = new URLSearchParams({ name: `${s.repo} admin`, description: '一日桃高紀錄後台', target_name: s.owner, expires_in: '366', contents: 'write' });
  $('[data-token-link]').href = `https://github.com/settings/personal-access-tokens/new?${q}`;
  const err = $('[data-login-error]'); err.textContent = msg; err.hidden = !msg;
  setTimeout(() => f.elements.token.focus(), 50);
  return new Promise((resolve) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type="submit"]', f); btn.disabled = true; btn.textContent = '驗證中…';
      saveSettings({ owner: f.elements.owner.value.trim(), repo: f.elements.repo.value.trim(), branch: f.elements.branch.value.trim() });
      setToken(f.elements.token.value.trim(), f.elements.remember.checked);
      const r = await verifyAccess();
      btn.disabled = false; btn.textContent = '進入後台';
      if (r.ok) { el.hidden = true; document.body.classList.remove('is-locked'); f.elements.token.value = ''; resolve(); }
      else { setToken(''); err.textContent = r.msg || '權杖無效。'; err.hidden = false; }
    });
  });
}

/* ---------------- GitHub API ---------------- */
async function gh(path, opts = {}) {
  const s = settings();
  const res = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}${path}`, {
    cache: 'no-store', ...opts,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg += ` ${j.message || ''}`; } catch (e) { /* noop */ }
    if (res.status === 401) msg = '權杖無效或已過期，請重新登入。';
    if (res.status === 403 || res.status === 404) msg += '（請確認權杖有這個 repo 的 Contents: Read and write 權限）';
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}
const b64FromText = (t) => { const b = new TextEncoder().encode(t); let s = ''; b.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
const textFromB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
async function loadRemote() {
  const s = settings();
  const j = await gh(`/contents/${DATA_PATH}?ref=${encodeURIComponent(s.branch)}&t=${Date.now()}`);
  return { data: JSON.parse(textFromB64(j.content)), sha: j.sha };
}
const serialize = (d) => `${JSON.stringify(d, null, 2)}\n`;

function summarize() {
  const a = new Map(state.original.rides.map((r) => [r.no, JSON.stringify(r)]));
  const b = new Map(state.data.rides.map((r) => [r.no, JSON.stringify(r)]));
  const parts = [];
  const added = [...b.keys()].filter((k) => !a.has(k)); const removed = [...a.keys()].filter((k) => !b.has(k));
  const edited = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
  if (added.length) parts.push(`新增 ${added.map(ordinal).join('、')}`);
  if (edited.length) parts.push(`修改 ${edited.map(ordinal).join('、')}`);
  if (removed.length) parts.push(`刪除 ${removed.map(ordinal).join('、')}`);
  if (JSON.stringify(state.original.places) !== JSON.stringify(state.data.places)) parts.push('地點');
  if (state.original.title !== state.data.title || state.original.subtitle !== state.data.subtitle) parts.push('網站資訊');
  if (JSON.stringify(state.original.aero || {}) !== JSON.stringify(state.data.aero || {})) parts.push('背景動畫預設');
  return parts.join('、') || '資料整理';
}
function allProblems() {
  const P = indexPlaces(state.data); const out = [];
  const nos = new Set();
  state.data.rides.forEach((r) => { if (nos.has(r.no)) out.push(`場次編號重複：${r.no}`); nos.add(r.no); out.push(...validateRide(r, P)); });
  const ids = new Set();
  state.data.places.forEach((p, i) => {
    if (!/^[a-z0-9-]+$/.test(p.id || '')) out.push(`地點第 ${i + 1} 列的代號只能用小寫英文、數字和 -。`);
    if (ids.has(p.id)) out.push(`地點代號重複：${p.id}`); ids.add(p.id);
    if (!p.name) out.push(`地點第 ${i + 1} 列沒有名稱。`);
  });
  return out;
}

/* 把匯入 GPX 時簡化好的軌跡存成 data/tracks/<日期>.json，前台地圖用來畫實際路線 */
async function publishTracks(summary) {
  const s = settings(); const failed = [];
  for (const [date, pts] of Object.entries(state.tracks)) {
    const path = `data/tracks/${date}.json`;
    try {
      let sha;
      try { sha = (await gh(`/contents/${path}?ref=${encodeURIComponent(s.branch)}&t=${Date.now()}`)).sha; } catch (err) { if (err.status !== 404) throw err; }
      await gh(`/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message: `更新軌跡：${date}（${summary}）`, content: b64FromText(`${JSON.stringify({ date, pts })}\n`), sha, branch: s.branch }) });
      delete state.tracks[date];
    } catch (err) { failed.push(date); }
  }
  return failed;
}

/* 每次騎乘當天的歷史天氣格點（地圖的風、雨圖層用）：repo 裡還沒有的日期，從 Open-Meteo 抓好存成 data/weather/<日期>.json。
   剛騎完的日期資料要幾天後才齊，抓不到就先跳過，下次發佈會再試。失敗不影響發佈。 */
async function publishWeather() {
  const s = settings(); let have = new Set();
  try { have = new Set((await gh(`/contents/data/weather?ref=${encodeURIComponent(s.branch)}&t=${Date.now()}`)).map((f) => f.name)); } catch (err) { if (err.status !== 404) return []; }
  const saved = [];
  for (const { date } of state.data.rides) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || have.has(`${date}.json`)) continue;
    try {
      const w = await fetchWeatherDay(date);
      if (!w) continue;
      await gh(`/contents/data/weather/${date}.json`, { method: 'PUT', body: JSON.stringify({ message: `存當日天氣：${date}`, content: b64FromText(`${JSON.stringify(w)}\n`), branch: s.branch }) });
      saved.push(date);
    } catch (err) { /* 下次再試 */ }
  }
  return saved;
}

async function publish() {
  if (!settings().token) { logout(); return; }
  const problems = allProblems();
  if (problems.length) { toast(problems[0], 'error'); return; }
  const btn = $('[data-publish]'); btn.disabled = true; btn.textContent = '發佈中…';
  try {
    const s = settings(); const summary = summarize();
    const body = { message: `更新騎行紀錄：${summary}`, content: b64FromText(serialize(state.data)), sha: state.sha, branch: s.branch };
    let res;
    try { res = await gh(`/contents/${DATA_PATH}`, { method: 'PUT', body: JSON.stringify(body) }); }
    catch (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
      if (!confirm('GitHub 上的資料在你載入後被別處改過（例如另一個分頁或另一台電腦）。\n按「確定」用目前畫面的版本覆蓋；按「取消」先不發佈，可重新整理載入最新版本。')) return;
      body.sha = (await loadRemote()).sha;
      res = await gh(`/contents/${DATA_PATH}`, { method: 'PUT', body: JSON.stringify(body) });
    }
    state.sha = res.content.sha; state.original = clone(state.data); setDirty(false); renderList();
    const failed = await publishTracks(summary);
    btn.textContent = '存天氣資料…'; await publishWeather();
    toast(failed.length ? `已發佈（${summary}），但 ${failed.join('、')} 的軌跡沒存成功，請重新匯入 GPX 再發佈一次。` : `已發佈（${summary}）。GitHub Pages 約 1 分鐘後更新。`, failed.length ? 'error' : 'ok');
  } catch (err) {
    toast(`發佈失敗：${err.message}`, 'error');
  } finally { btn.disabled = false; btn.textContent = '發佈到 GitHub'; }
}

/* ---------------- state helpers ---------------- */
function setDirty(v = true) {
  state.dirty = v; $('[data-dirty]').hidden = !v;
  if (v) LS.set('tyc:admin-draft', JSON.stringify({ data: state.data, sha: state.sha, at: Date.now() }));
  else LS.del('tyc:admin-draft');
}
const ride = () => state.data.rides.find((r) => r.no === state.selected);
const sortedRides = () => [...state.data.rides].sort((a, b) => b.no - a.no);
const placeOptions = (cur) => `<option value="">— 選擇地點 —</option>${state.data.places.map((p) => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}${p.sub ? `（${esc(p.sub)}）` : ''}${p.closed ? ' ✕歇業' : ''}</option>`).join('')}`;
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
function clean(o) { Object.keys(o).forEach((k) => { if (o[k] === '' || o[k] == null) delete o[k]; }); return o; }

/* ---------------- ride list ---------------- */
function renderList() {
  const P = indexPlaces(state.data);
  $('[data-list]').innerHTML = sortedRides().map((r) => {
    const bad = validateRide(r, P).length;
    return `<li><button type="button" data-no="${r.no}" aria-current="${r.no === state.selected}"><b>${ordinal(r.no)}${r.hidden ? ' <span class="muted">（隱藏）</span>' : ''}</b><small>${esc(r.date || '')}${bad ? ' <span class="warn">● 待補</span>' : ''}</small></button></li>`;
  }).join('');
}

/* ---------------- ride editor ---------------- */
function renderEditor() {
  const el = $('[data-editor]'); const r = ride();
  if (!r) { el.innerHTML = '<p class="muted">從左側選一次活動編輯，或按「新增一次活動」。</p>'; return; }
  const links = r.links || {};
  const stops = r.stops || [];
  const stopRows = stops.map((s, i) => {
    const first = i === 0; const last = i === stops.length - 1;
    return `<tr data-stop="${i}">
      <td class="n">${i + 1}</td>
      <td><select class="input" data-s="place">${placeOptions(s.place)}</select></td>
      <td><input class="input" type="time" data-s="arrive" value="${esc(s.arrive || '')}" ${first ? 'disabled title="起點不用填到達"' : ''}></td>
      <td><input class="input" type="time" data-s="depart" value="${esc(s.depart || '')}" ${last ? 'disabled title="終點不用填出發"' : ''}></td>
      <td><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-s="km" value="${s.km ?? ''}"></td>
      <td><select class="input" data-s="tag"><option value=""></option>${MEAL_TAGS.map((t) => `<option ${s.tag === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input class="input" data-s="note" value="${esc(s.note || '')}" placeholder="備註"></td>
      <td class="calc" data-calc="${i}"></td>
      <td class="ops"><button type="button" class="icon" data-op="up" ${first ? 'disabled' : ''} title="上移">↑</button> <button type="button" class="icon" data-op="down" ${last ? 'disabled' : ''} title="下移">↓</button> <button type="button" class="icon" data-op="ins" title="在下方插入一站">＋</button> <button type="button" class="icon" data-op="del" title="刪除這一站">✕</button></td>
    </tr>`;
  }).join('');
  const incRows = (r.incidents || []).map((x, i) => `<tr data-inc="${i}">
      <td><select class="input" data-i="type">${Object.entries(INCIDENT_TYPES).map(([k, t]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}</select></td>
      <td><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-i="km" value="${x.km ?? ''}"></td>
      <td><input class="input" data-i="who" value="${esc(x.who || '')}" placeholder="誰（選填）" list="riders"></td>
      <td><input class="input" type="number" min="0" inputmode="numeric" data-i="minutes" value="${x.minutes ?? ''}" placeholder="分鐘"></td>
      <td><input class="input" data-i="note" value="${esc(x.note || '')}" placeholder="說明（選填）"></td>
      <td class="calc" data-inc-at="${i}"></td>
      <td class="ops"><button type="button" class="icon" data-iop="del" title="刪除">✕</button></td>
    </tr>`).join('');
  el.innerHTML = `
    <h2>${ordinal(r.no)} 基本資料</h2>
    <div class="box grid">
      <label class="field"><span>第幾次</span><input class="input" type="number" min="1" data-r="no" value="${r.no}"></label>
      <label class="field"><span>日期</span><input class="input" type="date" data-r="date" value="${esc(r.date || '')}"></label>
      <label class="field wide"><span>參加者（用「、」或逗號分隔）</span><input class="input" data-r="riders" value="${esc((r.riders || []).join('、'))}"></label>
      <label class="field wide"><span>天氣</span><input class="input" data-r="weather" value="${esc(r.weather || '')}" placeholder="例：新竹以北小雨、中部晴"></label>
      <label class="field"><span>氣溫 °C</span><input class="input" type="number" step="0.1" data-r="temp" value="${r.temp ?? ''}"></label>
      <label class="field"><span>回程高鐵班次</span><input class="input" type="time" data-r="train" value="${esc(r.train || '')}"></label>
      <label class="field wide"><span>Strava 連結</span><input class="input" type="url" data-l="strava" value="${esc(links.strava || '')}" placeholder="https://www.strava.com/activities/…"></label>
      <label class="field wide"><span>部落格連結（選填）</span><input class="input" type="url" data-l="blog" value="${esc(links.blog || '')}" placeholder="https://steking.medium.com/…"></label>
      <label class="field wide"><span>裝備連結（LighterPack）</span><input class="input" type="url" data-l="gear" value="${esc(links.gear || '')}"></label>
      <label class="check"><input type="checkbox" data-r="hidden" ${r.hidden ? 'checked' : ''}> 隱藏（不在網站顯示）</label>
    </div>
    <div data-summary></div>

    <h2>停靠點</h2>
    <p class="hint">依序填每一站。起點只填出發、終點只填到達；里程是 Strava 上的累計公里。停留、區段距離與均速會自動算。</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th></th><th>地點</th><th>到達</th><th>出發</th><th>累計 km</th><th>用餐</th><th>備註</th><th>自動計算</th><th></th></tr></thead>
      <tbody>${stopRows}</tbody></table></div>
    <div class="add-row"><button type="button" class="btn btn--small" data-add-stop>＋ 在最後加一站</button></div>

    <h2>突發狀況</h2>
    <p class="hint">爆胎、摔車、會合、中離等。里程填發生的位置；在休息點發生就填那一站的里程。「分鐘」是處理花掉的時間（選填）。</p>
    ${incRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>類型</th><th>里程 km</th><th>誰</th><th>分鐘</th><th>說明</th><th>位置</th><th></th></tr></thead><tbody>${incRows}</tbody></table></div>` : '<p class="muted">這次沒有突發狀況。</p>'}
    <div class="add-row"><button type="button" class="btn btn--small" data-add-inc>＋ 新增突發狀況</button></div>
    <datalist id="riders">${(r.riders || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>

    <div class="danger-zone"><button type="button" class="btn btn--danger" data-del-ride>刪除這一次活動</button></div>`;
  updateCalc();
}

/* 只更新自動計算的欄位，不重畫表單，避免打字時失去焦點 */
function updateCalc() {
  const r = ride(); if (!r) return;
  const P = indexPlaces(state.data); const a = analyze(r, P);
  r.stops.forEach((s, i) => {
    const c = $(`[data-calc="${i}"]`); if (!c) return;
    const seg = a.segments[i]; const parts = [];
    if (i > 0 && i < r.stops.length - 1) parts.push(`停 ${stayOf(s)} 分`);
    if (seg) parts.push(`→ <span class="${seg.speed != null && seg.speed < 18 ? 'slow' : ''}">${fmtKm(seg.km)} km · ${fmtDur(seg.min)} · ${seg.speed ? seg.speed.toFixed(1) : '–'} km/h</span>`);
    c.innerHTML = parts.join('<br>');
  });
  (r.incidents || []).forEach((x, i) => {
    const c = $(`[data-inc-at="${i}"]`); if (!c) return;
    let at = '';
    a.stopIncidents.forEach((list, k) => { if (list.includes(x)) at = `在 ${a.place(r.stops[k].place).name}`; });
    a.segments.forEach((sg) => { if (sg.incidents.includes(x)) at = `${a.place(sg.from.place).name} → ${a.place(sg.to.place).name}`; });
    c.textContent = at || (x.km != null ? '超出路線範圍' : '');
  });
  const problems = validateRide(r, P);
  if (state.data.rides.filter((x) => x.no === r.no).length > 1) problems.unshift(`場次編號 ${r.no} 重複了。`);
  $('[data-summary]').innerHTML = `<div class="summary"><span>總時間 <b>${fmtDur(a.total)}</b></span><span>騎乘 <b>${fmtDur(a.moving)}</b></span><span>休息 <b>${fmtDur(a.rest)}</b></span><span>里程 <b>${fmtKm(a.km)}</b> km</span><span>均速 <b>${a.avg ? a.avg.toFixed(1) : '–'}</b> km/h</span></div>${problems.length ? `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="ok">✓ 資料完整</p>'}`;
}

function bindEditor() {
  const el = $('[data-editor]');
  el.addEventListener('input', (e) => {
    const t = e.target; const r = ride(); if (!r) return;
    if (t.dataset.r) {
      const k = t.dataset.r;
      if (k === 'riders') r.riders = t.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
      else if (k === 'temp') r.temp = numOrNull(t.value);
      else if (k === 'hidden') r.hidden = t.checked || undefined;
      else if (k === 'no') { const n = parseInt(t.value, 10); if (n > 0) { r.no = n; state.selected = n; } }
      else r[k] = t.value;
      clean(r);
    }
    if (t.dataset.l) { r.links = clean({ ...(r.links || {}), [t.dataset.l]: t.value.trim() }); }
    const tr = t.closest('[data-stop]');
    if (tr && t.dataset.s) {
      const s = r.stops[+tr.dataset.stop]; const k = t.dataset.s;
      s[k] = k === 'km' ? numOrNull(t.value) : t.value;
      clean(s); if (s.km === undefined && k !== 'km') { /* keep */ }
    }
    const ir = t.closest('[data-inc]');
    if (ir && t.dataset.i) {
      const x = r.incidents[+ir.dataset.inc]; const k = t.dataset.i;
      x[k] = k === 'km' || k === 'minutes' ? numOrNull(t.value) : t.value; clean(x);
    }
    setDirty(); updateCalc();
    if (t.dataset.r === 'no' || t.dataset.r === 'date' || t.dataset.r === 'hidden' || t.dataset.s === 'place' || t.dataset.s === 'km') renderList();
  });
  el.addEventListener('change', (e) => { if (e.target.matches('select, [type="checkbox"]')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  el.addEventListener('click', (e) => {
    const r = ride(); if (!r) return; const b = e.target.closest('button'); if (!b) return;
    const tr = b.closest('[data-stop]'); const i = tr ? +tr.dataset.stop : -1;
    if (b.dataset.op === 'up') [r.stops[i - 1], r.stops[i]] = [r.stops[i], r.stops[i - 1]];
    else if (b.dataset.op === 'down') [r.stops[i + 1], r.stops[i]] = [r.stops[i], r.stops[i + 1]];
    else if (b.dataset.op === 'ins') r.stops.splice(i + 1, 0, { place: '' });
    else if (b.dataset.op === 'del') { if (!confirm('刪除這一站？')) return; r.stops.splice(i, 1); }
    else if (b.matches('[data-add-stop]')) r.stops.push({ place: '' });
    else if (b.dataset.iop === 'del') r.incidents.splice(+b.closest('[data-inc]').dataset.inc, 1);
    else if (b.matches('[data-add-inc]')) { r.incidents = r.incidents || []; r.incidents.push({ type: 'flat' }); }
    else if (b.matches('[data-del-ride]')) {
      if (!confirm(`確定刪除 ${ordinal(r.no)}（${r.date}）？發佈後才會真的從網站移除。`)) return;
      state.data.rides = state.data.rides.filter((x) => x !== r); state.selected = (sortedRides()[0] || {}).no ?? null;
    } else return;
    // 起點不留到達、終點不留出發
    if (r.stops && r.stops.length) { delete r.stops[0].arrive; if (r.stops.length > 1) delete r.stops[r.stops.length - 1].depart; }
    setDirty(); renderList(); renderEditor();
  });
}

function newRide() {
  const last = sortedRides()[0];
  const no = (last ? last.no : 0) + 1;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const stops = last ? last.stops.map((s, i) => clean({ place: s.place, km: i === 0 ? 0 : null, tag: s.tag })) : [{ place: 'home', km: 0 }, { place: 'zuoying' }];
  const r = { no, date: today, riders: last ? [...last.riders] : [], weather: '', links: {}, stops, incidents: [] };
  state.data.rides.push(r); state.selected = no; setDirty(); renderList(); renderEditor();
  toast(`已建立 ${ordinal(no)}，停靠點先帶入上一次的路線，沒停的站按 ✕ 刪除。`);
}

/* ---------------- GPX import ---------------- */
let gpxState = null;
async function importGpx(file) {
  if (!file) return;
  let track;
  try { track = parseGpx(await file.text()); } catch (err) { toast(err.message, 'error'); return; }
  const a = analyzeTrack(track.points);
  const places = state.data.places; const hist = kmHistory(state.data.rides);
  const near = (pt, fallback) => {
    const g = places.find((p) => Number.isFinite(p.lat) && Math.abs(p.lat - pt.lat) < 0.005 && Math.abs(p.lon - pt.lon) < 0.005);
    return (g || places.find((p) => p.id === fallback) || places[0] || {}).id;
  };
  const last = places[places.length - 1];
  const startPlace = near(a.start, 'home'); const endPlace = near(a.end, last && last.id);
  const used = new Set([startPlace, endPlace]); // 起終點附近的停留（到站後還沒按停止）不當成休息點
  const rows = a.stops.map((s) => {
    const p = guessPlace(s, places, hist, used); if (p) used.add(p.id);
    return { ...s, action: p ? `place:${p.id}` : 'skip' };
  });
  gpxState = { a, rows, date: ymd(a.start.t), name: track.name, startPlace, endPlace, points: track.points };
  renderGpx(); $('[data-gpx-dialog]').showModal();
}
function actionOptions(cur) {
  const ps = state.data.places.map((p) => `<option value="place:${esc(p.id)}" ${cur === `place:${p.id}` ? 'selected' : ''}>${esc(p.name)}${p.sub ? `（${esc(p.sub)}）` : ''}</option>`).join('');
  const inc = Object.entries(INCIDENT_TYPES).map(([k, t]) => `<option value="inc:${k}" ${cur === `inc:${k}` ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');
  return `<option value="skip" ${cur === 'skip' ? 'selected' : ''}>略過（等紅燈、臨時停）</option><optgroup label="休息點">${ps}</optgroup><optgroup label="突發狀況">${inc}</optgroup>`;
}
function renderGpx() {
  const g = gpxState; const { a } = g;
  const existing = state.data.rides.find((r) => r.date === g.date);
  const placeSel = (key, cur) => `<select class="input" data-g="${key}">${state.data.places.map((p) => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  const rows = g.rows.map((r, i) => `<tr data-g-row="${i}" class="${r.action === 'skip' ? 'is-skip' : ''}"><td class="calc">${hhmm(r.start)}</td><td class="calc">${hhmm(r.end)}</td><td class="calc">${Math.round((r.end - r.start) / 60000)} 分</td><td class="calc">${fmtKm(r.km)}</td><td><select class="input" data-g-act>${actionOptions(r.action)}</select></td></tr>`).join('');
  $('[data-gpx-form]').innerHTML = `
    <h2>從 GPX 匯入${g.name ? `：${esc(g.name)}` : ''}</h2>
    <p class="hint">${esc(g.date)}　${hhmm(a.start.t)} 出發 → ${hhmm(a.end.t)} 抵達　共 ${fmtKm(a.end.km)} km${a.temp != null ? `　平均 ${a.temp}°C` : ''}。找到 ${g.rows.length} 次超過 5 分鐘的停留，請確認每一次是哪個休息點；沒對到地點的預設略過，爆胎等狀況可改成「突發狀況」，連續幾列選同一種會合成一筆。里程由軌跡計算，可能和 Strava 顯示差一點。</p>
    <div class="grid">
      <label class="field"><span>起點</span>${placeSel('startPlace', g.startPlace)}</label>
      <label class="field"><span>終點</span>${placeSel('endPlace', g.endPlace)}</label>
      <label class="field wide"><span>Strava 連結（選填）</span><input class="input" type="url" data-g="strava" value="${esc(g.strava || '')}" placeholder="https://www.strava.com/activities/…"></label>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>到達</th><th>出發</th><th>停留</th><th>累計 km</th><th>這是…</th></tr></thead><tbody>
      ${rows || '<tr><td colspan="5" class="muted">沒有找到停留點。</td></tr>'}
    </tbody></table></div>
    ${existing ? `<p class="hint">已經有 ${esc(g.date)} 的紀錄（${ordinal(existing.no)}），套用後會<b>取代它的停靠點</b>，基本資料與手動加的突發狀況會保留。</p>` : ''}
    <div class="dialog__actions">
      <button value="cancel" class="btn" formnovalidate>取消</button>
      <button value="ok" class="btn btn--primary">${existing ? `套用到 ${ordinal(existing.no)}` : '建立新的一次活動'}</button>
    </div>`;
}
function bindGpx() {
  const input = $('[data-gpx]');
  input.addEventListener('change', () => { importGpx(input.files[0]); input.value = ''; });
  addEventListener('dragover', (e) => { if ([...(e.dataTransfer.items || [])].some((x) => x.kind === 'file')) { e.preventDefault(); document.body.classList.add('is-dragging'); } });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('is-dragging'); });
  addEventListener('drop', (e) => {
    document.body.classList.remove('is-dragging');
    const f = [...(e.dataTransfer.files || [])].find((x) => /\.gpx$/i.test(x.name)); if (!f) return;
    e.preventDefault(); importGpx(f);
  });
  $('[data-gpx-form]').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.g) gpxState[t.dataset.g] = t.value;
    const tr = t.closest('[data-g-row]');
    if (tr) { gpxState.rows[+tr.dataset.gRow].action = t.value; tr.classList.toggle('is-skip', t.value === 'skip'); }
  });
  $('[data-gpx-form]').addEventListener('input', (e) => { if (e.target.dataset.g === 'strava') gpxState.strava = e.target.value; });
  $('[data-gpx-dialog]').addEventListener('close', (e) => { if (e.target.returnValue === 'ok' && gpxState) applyGpx(); gpxState = null; });
}
function applyGpx() {
  const g = gpxState; const { a } = g; const km1 = (x) => Math.round(x * 10) / 10;
  const P = indexPlaces(state.data);
  const setCoord = (id, pt) => { const p = P[id]; if (p && !p.private && !Number.isFinite(p.lat)) { p.lat = +pt.lat.toFixed(5); p.lon = +pt.lon.toFixed(5); } };
  // 用餐標籤：該地點過去超過一半的停留都標了同一餐才自動帶入
  const tagCount = {}; const visits = {};
  state.data.rides.forEach((r) => r.stops.forEach((s) => { visits[s.place] = (visits[s.place] || 0) + 1; if (s.tag) { const k = `${s.place}|${s.tag}`; tagCount[k] = (tagCount[k] || 0) + 1; } }));
  const prevTag = {}; Object.entries(tagCount).forEach(([k, n]) => { const [id, tag] = k.split('|'); if (n * 2 > visits[id]) prevTag[id] = tag; });
  const stops = [{ place: g.startPlace, depart: hhmm(a.start.t), km: 0 }];
  const incidents = [];
  g.rows.forEach((r, i) => {
    if (r.action.startsWith('place:')) {
      const id = r.action.slice(6);
      stops.push(clean({ place: id, arrive: hhmm(r.start), depart: hhmm(r.end), km: km1(r.km), tag: prevTag[id] }));
      setCoord(id, r);
    } else if (r.action.startsWith('inc:')) {
      // 連續幾段都標成同一種狀況（例如修爆胎時移動了一下）就合成一筆，時間從第一段開始算到最後一段結束
      const prev = incidents[incidents.length - 1];
      if (prev && prev._row === i - 1 && prev.type === r.action.slice(4) && r.start - prev._end <= 30 * 60000) {
        prev.minutes = Math.round((r.end - prev._start) / 60000); prev._row = i; prev._end = r.end;
      } else incidents.push({ type: r.action.slice(4), km: km1(r.km), minutes: Math.round((r.end - r.start) / 60000), _row: i, _start: r.start, _end: r.end });
    }
  });
  incidents.forEach((x) => { delete x._row; delete x._start; delete x._end; });
  stops.push({ place: g.endPlace, arrive: hhmm(a.end.t), km: km1(a.end.km) });
  setCoord(g.startPlace, a.start); setCoord(g.endPlace, a.end);
  let r = state.data.rides.find((x) => x.date === g.date);
  if (r) {
    r.stops = stops;
    // 已經手動記過的同類狀況（里程差 1 公里內）保留原本的，不重複加
    const old = r.incidents || [];
    r.incidents = [...old, ...incidents.filter((y) => !old.some((x) => x.type === y.type && x.km != null && Math.abs(x.km - y.km) <= 1))];
  } else {
    const last = sortedRides()[0];
    r = { no: (last ? last.no : 0) + 1, date: g.date, riders: last ? [...last.riders] : [], weather: '', links: {}, stops, incidents };
    state.data.rides.push(r);
  }
  // 出發點 200 m 內一律不存；終點若是設為「隱私」的地點（例如回到家）也一併隱藏
  const endPriv = (P[g.endPlace] || {}).private;
  state.tracks[g.date] = simplifyTrack(g.points, undefined, { hide: endPriv ? [a.end] : [] });
  if (a.temp != null && r.temp == null) r.temp = a.temp;
  if (g.strava && g.strava.trim()) r.links = { ...(r.links || {}), strava: g.strava.trim() };
  state.selected = r.no; setDirty();
  $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === 'rides')));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== 'rides'; });
  renderList(); renderEditor();
  toast(`已從 GPX 帶入 ${ordinal(r.no)}：${stops.length - 2} 個休息點${incidents.length ? `、${incidents.length} 個突發狀況` : ''}。請補上天氣、參加者，確認後發佈。`, 'ok');
}

/* ---------------- places & site ---------------- */
function renderPlaces() {
  const used = new Map();
  state.data.rides.forEach((r) => r.stops.forEach((s) => used.set(s.place, (used.get(s.place) || 0) + 1)));
  const rows = state.data.places.map((p, i) => `<tr data-place="${i}">
    <td class="n">${i + 1}</td>
    <td><input class="input" data-p="id" value="${esc(p.id)}" ${used.has(p.id) ? 'readonly title="已被活動使用，不能改代號"' : ''} style="width:130px"></td>
    <td><input class="input" data-p="name" value="${esc(p.name || '')}"></td>
    <td><input class="input" data-p="sub" value="${esc(p.sub || '')}" placeholder="店名／補充"></td>
    <td><input class="input" type="url" data-p="map" value="${esc(p.map || '')}" placeholder="Google 地圖連結"></td>
    <td><label class="check"><input type="checkbox" data-p="closed" ${p.closed ? 'checked' : ''}> 歇業</label><label class="check" title="不記錄座標，匯入 GPX 時這裡 200 m 內的軌跡也不存"><input type="checkbox" data-p="private" ${p.private ? 'checked' : ''}> 隱私</label></td>
    <td class="calc">${used.get(p.id) || 0} 次</td>
    <td class="ops"><button type="button" class="icon" data-pop="up" ${i === 0 ? 'disabled' : ''}>↑</button> <button type="button" class="icon" data-pop="down" ${i === state.data.places.length - 1 ? 'disabled' : ''}>↓</button> <button type="button" class="icon" data-pop="ins" title="在下方插入">＋</button> <button type="button" class="icon" data-pop="del" ${used.has(p.id) ? 'disabled title="已被活動使用"' : ''}>✕</button></td>
  </tr>`).join('');
  $('[data-places]').innerHTML = `
    <h2>網站資訊</h2>
    <div class="box grid">
      <label class="field"><span>網站標題</span><input class="input" data-site="title" value="${esc(state.data.title || '')}"></label>
      <label class="field wide"><span>副標</span><input class="input" data-site="subtitle" value="${esc(state.data.subtitle || '')}"></label>
    </div>
    ${aeroBox()}
    <h2>地點（依路線由北到南排列）</h2>
    <p class="hint">這個順序決定比較表的列順序。代號用小寫英文，建立後被活動用到就不能改。</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>代號</th><th>名稱</th><th>店名／補充</th><th>地圖</th><th></th><th>使用</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="add-row"><button type="button" class="btn btn--small" data-add-place>＋ 在最後加一個地點</button></div>`;
}
function bindPlaces() {
  const el = $('[data-places]');
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.site) { state.data[t.dataset.site] = t.value; setDirty(); return; }
    if (t.dataset.aero) {
      const k = t.dataset.aero; const v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
      const out = el.querySelector(`[data-aero-out="${k}"]`); if (out) out.textContent = k === 'speed' ? `${v} km/h` : `${Math.round(v * 100)}%`;
      setAero(k, v); return;
    }
    const tr = t.closest('[data-place]'); if (!tr) return;
    const p = state.data.places[+tr.dataset.place]; const k = t.dataset.p;
    if (k === 'closed') p.closed = t.checked || undefined;
    else if (k === 'private') { p.private = t.checked || undefined; if (t.checked) { delete p.lat; delete p.lon; } }
    else p[k] = k === 'id' ? t.value.trim().toLowerCase() : t.value;
    clean(p); setDirty();
  });
  el.addEventListener('change', (e) => { if (e.target.type === 'checkbox') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const L = state.data.places;
    const tr = b.closest('[data-place]'); const i = tr ? +tr.dataset.place : -1;
    const blank = () => { let n = L.length + 1; while (L.some((p) => p.id === `place-${n}`)) n += 1; return { id: `place-${n}`, name: '' }; };
    if (b.dataset.pop === 'up') [L[i - 1], L[i]] = [L[i], L[i - 1]];
    else if (b.dataset.pop === 'down') [L[i + 1], L[i]] = [L[i], L[i + 1]];
    else if (b.dataset.pop === 'ins') L.splice(i + 1, 0, blank());
    else if (b.dataset.pop === 'del') L.splice(i, 1);
    else if (b.matches('[data-add-place]')) L.push(blank());
    else return;
    setDirty(); renderPlaces();
  });
}

/* 背景騎乘動畫的網站預設值（存在 rides.json 的 aero；訪客自己在網站上改過的會優先） */
function aeroBox() {
  const a = { ...AERO_DEFAULTS, ...(state.data.aero || {}) };
  const { STYLES, SCENES, TIMES } = AERO_OPTIONS;
  const sel = (k, opts, label) => `<label class="field"><span>${label}</span><select class="input" data-aero="${k}">${Object.entries(opts).map(([v, n]) => `<option value="${v}" ${a[k] === v ? 'selected' : ''}>${esc(Array.isArray(n) ? `${n[0]}．${n[1]}` : n)}</option>`).join('')}</select></label>`;
  return `<h2>背景騎乘動畫（網站預設）</h2>
    <p class="hint">訪客第一次進站看到的樣子。訪客自己在網站右下角改過的設定會優先，按面板裡的「恢復網站預設」就會回到這裡的設定。</p>
    <div class="box grid">
      ${sel('style', STYLES, '畫風')}${sel('scene', SCENES, '場景')}${sel('time', TIMES, '日夜')}
      <label class="field"><span>線條濃淡 <output data-aero-out="opacity">${Math.round(a.opacity * 100)}%</output></span><input type="range" min="0.15" max="1" step="0.05" value="${a.opacity}" data-aero="opacity"></label>
      <label class="field"><span>騎乘節奏 <output data-aero-out="speed">${a.speed} km/h</output></span><input type="range" min="15" max="55" step="1" value="${a.speed}" data-aero="speed"></label>
      <label class="check"><input type="checkbox" data-aero="on" ${a.on ? 'checked' : ''}> 預設顯示動畫</label>
    </div>`;
}
function setAero(k, v) {
  const a = { ...(state.data.aero || {}) }; a[k] = v;
  Object.keys(a).forEach((x) => { if (a[x] === AERO_DEFAULTS[x]) delete a[x]; });
  if (Object.keys(a).length) state.data.aero = a; else delete state.data.aero;
  setDirty();
}

/* ---------------- misc ---------------- */
let toastT;
function toast(msg, kind = '') {
  const t = $('[data-toast]'); t.textContent = msg; t.className = `toast ${kind ? `is-${kind}` : ''}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 9000 : 4500);
}
function download() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([serialize(state.data)], { type: 'application/json' }));
  a.download = 'rides.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function preview() {
  if (!LS.set('tyc:draft', JSON.stringify(state.data))) { toast('瀏覽器不允許暫存，無法預覽。', 'error'); return; }
  const r = ride(); window.open(`../?preview${r ? `#/ride/${r.no}` : ''}`, '_blank', 'noopener');
}

async function boot() {
  const access = await verifyAccess();
  if (!access.ok) await showLogin(settings().token ? access.msg : '');
  $('[data-app]').hidden = false;
  try { const l = await loadRemote(); state.data = l.data; state.sha = l.sha; } catch (err) { toast(`無法從 GitHub 載入：${err.message}`, 'error'); return; }
  state.data.places = state.data.places || []; state.data.rides = state.data.rides || [];
  state.original = clone(state.data);
  try {
    const draft = JSON.parse(LS.get('tyc:admin-draft') || 'null');
    if (draft && draft.data && JSON.stringify(draft.data) !== JSON.stringify(state.data) && confirm(`找到 ${new Date(draft.at).toLocaleString()} 未發佈的草稿，要還原嗎？${draft.sha && draft.sha !== state.sha ? '\n\n注意：這份草稿之後 GitHub 上的資料已經更新過，還原後再發佈會蓋掉那些更新。' : ''}`)) {
      state.data = draft.data; setDirty();
    } else LS.del('tyc:admin-draft');
  } catch (e) { LS.del('tyc:admin-draft'); }
  state.selected = (sortedRides()[0] || {}).no ?? null;
  renderList(); renderEditor(); renderPlaces();
  $('[data-list]').addEventListener('click', (e) => { const b = e.target.closest('[data-no]'); if (!b) return; state.selected = Number(b.dataset.no); renderList(); renderEditor(); if (innerWidth < 860) $('[data-editor]').scrollIntoView(); });
  $('[data-add]').addEventListener('click', newRide);
  $('[data-publish]').addEventListener('click', publish);
  $('[data-download]').addEventListener('click', download);
  $('[data-preview]').addEventListener('click', preview);
  $('[data-logout]').addEventListener('click', logout);
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
    if (b.dataset.tab === 'places') renderPlaces();
    if (b.dataset.tab === 'rides') { renderList(); renderEditor(); }
  }));
  addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  bindEditor(); bindPlaces(); bindGpx();
}
boot();
