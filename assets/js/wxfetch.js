/* 從 Open-Meteo 歷史天氣 API（ERA5 / ECMWF 再分析）抓某一天的逐時格點，轉成 data/weather/<日期>.json 的格式。
   前台在沒有存檔時直接在瀏覽器抓；後台發佈時抓好存進 repo。tools/fetch_weather.py 是同樣邏輯的 Python 版。

   格式（數值乘 10 存整數）：lat0/lon0 = 西南角、dlat/dlon = 間距、nlat/nlon = 列/欄，格點由南到北、每列由西到東
   u, v = 每小時（0–23 時，台灣時間）10 m 風往東、往北的分量（0.1 m/s）；rain = 該小時雨量（0.1 mm）；temp = 2 m 氣溫（0.1 °C） */
export const GRID = { lat0: 21.75, lon0: 118.5, dlat: 0.25, dlon: 0.25, nlat: 17, nlon: 17 };
const API = 'https://archive-api.open-meteo.com/v1/archive';
const CHUNK = 100;

export function gridPoints(G = GRID) {
  const out = [];
  for (let i = 0; i < G.nlat; i += 1) for (let j = 0; j < G.nlon; j += 1) out.push([+(G.lat0 + i * G.dlat).toFixed(3), +(G.lon0 + j * G.dlon).toFixed(3)]);
  return out;
}

/* 回傳物件；資料還不齊（太近的日期）回傳 null；網路錯誤會 throw */
export async function fetchWeatherDay(date) {
  const pts = gridPoints();
  const parts = [];
  for (let s = 0; s < pts.length; s += CHUNK) parts.push(pts.slice(s, s + CHUNK));
  const res = [];
  for (const part of parts) {
    const q = new URLSearchParams({
      latitude: part.map((p) => p[0]).join(','), longitude: part.map((p) => p[1]).join(','),
      start_date: date, end_date: date,
      hourly: 'wind_speed_10m,wind_direction_10m,precipitation,temperature_2m',
      wind_speed_unit: 'ms', timezone: 'Asia/Taipei',
    });
    const r = await fetch(`${API}?${q}`);
    if (!r.ok) throw new Error(r.status === 429 ? 'Open-Meteo 請求太頻繁，請稍後再試' : `Open-Meteo 回應 ${r.status}`);
    const j = await r.json();
    res.push(...(Array.isArray(j) ? j : [j]));
  }
  if (res.length !== pts.length) throw new Error('天氣格點數量不對');
  const mk = () => Array.from({ length: 24 }, () => new Array(pts.length).fill(0));
  const u = mk(); const v = mk(); const rain = mk(); const temp = mk();
  let missing = 0;
  res.forEach((loc, k) => {
    const h = loc.hourly || {};
    for (let t = 0; t < 24; t += 1) {
      const ws = h.wind_speed_10m?.[t]; const wd = h.wind_direction_10m?.[t];
      if (ws == null || wd == null) { missing += 1; continue; }
      const a = (wd * Math.PI) / 180; // 風向是「從哪裡吹來」
      u[t][k] = Math.round(-ws * Math.sin(a) * 10); v[t][k] = Math.round(-ws * Math.cos(a) * 10);
      rain[t][k] = Math.round((h.precipitation?.[t] || 0) * 10);
      temp[t][k] = Math.round((h.temperature_2m?.[t] ?? 0) * 10);
    }
  });
  if (missing > pts.length * 24 * 0.05) return null;
  return { date, source: 'Open-Meteo Historical Weather API (ERA5 / ECMWF reanalysis)', ...GRID, hours: [...Array(24).keys()], scale: 10, u, v, rain, temp };
}
