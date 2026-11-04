#!/usr/bin/env python3
"""抓每次騎乘當天的逐時天氣格點（Open-Meteo 歷史資料，ERA5 等再分析），存成 data/weather/<日期>.json。

    python3 tools/fetch_weather.py            # 只抓還沒有的日期
    python3 tools/fetch_weather.py --force    # 全部重抓
    python3 tools/fetch_weather.py 2026-01-10 # 只抓指定日期

只用 Python 標準函式庫。GitHub Actions（.github/workflows/weather.yml）會在 rides.json 更新時自動執行。

輸出格式（數值都乘 10 存成整數以縮小檔案）：
  lat0/lon0 = 格點西南角，dlat/dlon = 間距，nlat/nlon = 列數/欄數，格點依「由南到北、每列由西到東」排列
  hours = 0..23（當地時間 Asia/Taipei）
  u, v      = 每小時一個陣列，10 m 風的東西／南北分量（0.1 m/s；往東、往北為正）
  rain      = 每小時降雨量（0.1 mm，該小時累積）
  temp      = 2 m 氣溫（0.1 °C）
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RIDES = ROOT / 'data' / 'rides.json'
OUT = ROOT / 'data' / 'weather'
API = 'https://archive-api.open-meteo.com/v1/archive'

# 涵蓋桃園到高雄、加上台灣海峽與中央山脈西側，地圖拉遠時周圍也有風場
LAT0, LAT1, LON0, LON1, STEP = 22.0, 25.75, 119.25, 122.0, 0.25
NLAT = round((LAT1 - LAT0) / STEP) + 1
NLON = round((LON1 - LON0) / STEP) + 1
CHUNK = 60  # 每次請求的格點數


def grid():
    return [(round(LAT0 + i * STEP, 3), round(LON0 + j * STEP, 3)) for i in range(NLAT) for j in range(NLON)]


def get(params, tries=5):
    url = f'{API}?{urllib.parse.urlencode(params)}'
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'bike-TYC-KHH weather fetch'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            wait = 15 * (k + 1)
            print(f'  請求失敗（{e}），{wait} 秒後重試', file=sys.stderr)
            time.sleep(wait)
    raise SystemExit('Open-Meteo 一直失敗，放棄')


def fetch_day(date):
    pts = grid()
    res = []
    for s in range(0, len(pts), CHUNK):
        part = pts[s:s + CHUNK]
        j = get({
            'latitude': ','.join(str(p[0]) for p in part),
            'longitude': ','.join(str(p[1]) for p in part),
            'start_date': date, 'end_date': date,
            'hourly': 'wind_speed_10m,wind_direction_10m,precipitation,temperature_2m',
            'wind_speed_unit': 'ms', 'timezone': 'Asia/Taipei',
        })
        res.extend(j if isinstance(j, list) else [j])
        time.sleep(4)  # 免費額度每分鐘 600 個格點，放慢一點
    if len(res) != len(pts):
        raise SystemExit(f'{date}: 回傳 {len(res)} 個格點，預期 {len(pts)}')

    u = [[0] * len(pts) for _ in range(24)]
    v = [[0] * len(pts) for _ in range(24)]
    rain = [[0] * len(pts) for _ in range(24)]
    temp = [[0] * len(pts) for _ in range(24)]
    missing = 0
    for k, loc in enumerate(res):
        h = loc['hourly']
        for t in range(24):
            ws, wd = h['wind_speed_10m'][t], h['wind_direction_10m'][t]
            pr, tc = h['precipitation'][t], h['temperature_2m'][t]
            if ws is None or wd is None:
                missing += 1
                continue
            # 風向是「從哪裡吹來」，換成往哪裡吹的分量
            a = math.radians(wd)
            u[t][k] = round(-ws * math.sin(a) * 10)
            v[t][k] = round(-ws * math.cos(a) * 10)
            rain[t][k] = round((pr or 0) * 10)
            temp[t][k] = round((tc if tc is not None else 0) * 10)
    if missing > len(pts) * 24 * 0.05:
        print(f'{date}: 資料還不完整（缺 {missing} 筆，可能是太近的日期），先跳過')
        return None
    return {
        'date': date,
        'source': 'Open-Meteo Historical Weather API (ERA5 / ECMWF reanalysis)',
        'lat0': LAT0, 'lon0': LON0, 'dlat': STEP, 'dlon': STEP, 'nlat': NLAT, 'nlon': NLON,
        'hours': list(range(24)), 'scale': 10,
        'u': u, 'v': v, 'rain': rain, 'temp': temp,
    }


def main(argv):
    force = '--force' in argv
    only = [a for a in argv if not a.startswith('--')]
    dates = only or [r['date'] for r in json.loads(RIDES.read_text(encoding='utf-8'))['rides']]
    OUT.mkdir(parents=True, exist_ok=True)
    wrote = 0
    for date in sorted(set(dates)):
        f = OUT / f'{date}.json'
        if f.exists() and not force and not only:
            continue
        print(f'抓 {date}（{NLAT}×{NLON} 格點）…')
        data = fetch_day(date)
        if data:
            f.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
            print(f'  寫入 {f.relative_to(ROOT)}（{f.stat().st_size // 1024} KB）')
            wrote += 1
    print(f'完成，更新 {wrote} 個檔案')


if __name__ == '__main__':
    main(sys.argv[1:])
