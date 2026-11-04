# 一日桃高

桃園騎到高雄、一天完成的每次紀錄。純 HTML／CSS／JavaScript，沒有建置步驟，可直接放 GitHub Pages。

所有紀錄都在 `data/rides.json`，網站載入時讀取它，停留時間、區段距離、均速、總時間、休息時間都由程式計算。

## 頁面

- **總覽** `#/`：統計、各次「一天的節奏」時間軸、每次一張卡片
- **單次** `#/ride/6`：停靠點時間軸，區段之間標出爆胎、摔車等突發狀況
- **比較表** `#/compare`：可勾選場次的「地點 × 場次」對照表，可列印

### 地圖的天氣圖層

地圖右上角可切換「💨 風／🌧️ 雨／關」：風是風速底色加上流動的風場線條，雨是每小時雨量。左下角的時間軸可拖動看當天各時刻；按「播放」時天氣跟著騎士的時間變化，並顯示騎士所在位置的風向、風速、順風／逆風、雨量與氣溫。總覽頁可選要看哪一天。

資料來自 [Open-Meteo](https://open-meteo.com/) 的歷史天氣（ERA5／ECMWF 再分析，約 25 km 格點、逐時），是模式重建的數值，不是測站實測，小範圍的陣雨可能不準。後台按「發佈到 GitHub」時，會把還沒存的日期抓好存到 `data/weather/<日期>.json`；還沒存的日期，前台會直接在瀏覽器向 Open-Meteo 抓。剛騎完的日期資料約 5 天後才齊，之後再發佈一次就會補上。也可在本機執行 `python3 tools/fetch_weather.py`。

## 新增一次活動（後台）

打開 `/admin/`（例如 `https://steking1207.github.io/bike-TYC-KHH/admin/`）。

1. **登入**：貼上對這個 repo 有寫入權限的 GitHub 權杖（設定方式見下方「建立 GitHub 權杖」）。沒有權限的人只會看到登入畫面。
2. **從 GPX 匯入（建議）**：在 Strava 活動頁按 ⋯ →「匯出 GPX」，回到後台按「從 GPX 匯入」選檔案（或直接拖進後台）。會自動抓出日期、出發與抵達時間、每次停留超過 5 分鐘的時間與累計里程，並依座標或過去的里程猜是哪個休息點；不是休息點的停留可改為「略過」或記成突發狀況（例如爆胎）。確認後再補天氣、參加者即可。
   - GPX 只在瀏覽器裡解析，原始檔不會上傳；發佈時會另存一份簡化後的軌跡（約 20 KB）到 `data/tracks/<日期>.json`，前台地圖用它畫實際路線、播放時跟著時間移動
   - 隱私：出發點 200 m 內的軌跡點不會存；地點勾「隱私」（例如「家」）就不記錄座標，若終點是隱私地點，終點 200 m 內也不存
   - 第一次對到某個地點時會記下它的座標，之後匯入就用座標比對，越用越準
   - 若當天已有紀錄，會取代它的停靠點，基本資料與已記的突發狀況保留
   - 沒有直接串 Strava API：那需要 Strava 開發者 App 和一個能保管 client secret 的伺服器，純靜態網站做不到
3. 或按「＋ 新增一次活動」手動填。會帶入下一個場次編號、今天日期、上一次的參加者與停靠點。
   每站填到達、出發時間與累計里程（起點只填出發、終點只填到達）。沒停的站按 ✕，多停的站按 ＋ 插入。爆胎、摔車、會合、中離等加在「突發狀況」，填發生時的里程。
4. 「預覽」看效果，再按「發佈到 GitHub」，會產生一個 commit。

### 建立 GitHub 權杖

1. 打開 [建立 Fine-grained token](https://github.com/settings/personal-access-tokens/new?name=bike-TYC-KHH%20admin&description=%E4%B8%80%E6%97%A5%E6%A1%83%E9%AB%98%E7%B4%80%E9%8C%84%E5%BE%8C%E5%8F%B0&target_name=steking1207&expires_in=366&contents=write)（已預填名稱、366 天有效期限與 Contents 權限；後台登入頁的「在 GitHub 建立權杖」按鈕也是開這個頁面）。
2. **Resource owner** 選 `steking1207`。
3. **Repository access** 選 **Only select repositories**，只勾 `bike-TYC-KHH`。
4. **Permissions → Repository permissions → Contents** 設為 **Read and write**，其他權限都不用開。
5. 按 **Generate token**，複製 `github_pat_…` 開頭的字串。它只會顯示一次，建議存進密碼管理器。
6. 到後台貼上權杖，按「進入後台」。自己的電腦可勾「記住這台電腦」；沒勾的話關掉瀏覽器就會登出。

權杖只存在你的瀏覽器，只會送到 api.github.com，不會進 repo。過期或遺失時照上面步驟重建一組即可；不用的權杖可在 [Personal access tokens](https://github.com/settings/personal-access-tokens) 刪除。

### 沒有權杖時

也可以按「下載 JSON」，覆蓋 `data/rides.json` 後自己 commit。

## 資料格式

```jsonc
{
  "title": "一日桃高",
  "subtitle": "桃園 → 高雄，一天騎完",
  "places": [                                   // 依路線由北到南排列，決定比較表的列順序
    { "id": "nanliao", "name": "新竹南寮", "sub": "7-11聖華門市", "map": "https://maps.app.goo.gl/…", "closed": false,
      "lat": 24.84, "lon": 120.92 }            // 座標由 GPX 匯入時自動記錄，用來比對休息點
  ],
  "rides": [{
    "no": 6, "date": "2026-01-10",
    "riders": ["SK2", "秀彥", "Terry"],
    "weather": "整日晴", "temp": 14.4,
    "links": { "strava": "https://www.strava.com/activities/…", "gear": "https://lighterpack.com/r/…" },
    "train": "21:30",                           // 回程高鐵班次（選填）
    "stops": [
      { "place": "home", "depart": "02:48", "km": 0 },
      { "place": "yamei", "arrive": "03:00", "depart": "03:21", "km": 4.7, "tag": "早餐", "note": "" },
      { "place": "zuoying", "arrive": "20:14", "km": 331.6 }
    ],
    "incidents": [
      { "type": "flat", "km": 139, "who": "", "minutes": 72, "note": "" }
    ],
    "hidden": false
  }]
}
```

`incidents[].type`：`flat` 爆胎、`crash` 摔車、`mechanical` 機械故障、`join` 會合、`leave` 中離、`weather` 天氣、`other` 其他。里程等於某一站的里程時顯示在那一站，否則顯示在所屬區段。

## 檔案結構

```
index.html            網站
assets/css/site.css   樣式
assets/js/app.js      畫面產生
assets/js/ride.js     計算與驗證（前台、後台共用）
assets/js/gpx.js      GPX 解析與停留偵測（後台用）
assets/js/weather.js  地圖的風場、降雨圖層
assets/js/wxfetch.js  向 Open-Meteo 抓歷史天氣格點
data/rides.json       所有紀錄
data/tracks/          每次的簡化軌跡（[緯度, 經度, 當天第幾分鐘]），沒有的場次地圖改畫休息站直線
data/weather/         每次當天的逐時天氣格點（風、雨、氣溫），後台發佈時自動產生
admin/                後台
```

本機預覽：在 repo 根目錄執行 `python3 -m http.server`，開 http://localhost:8000/。直接雙擊 `index.html` 會因瀏覽器限制讀不到 JSON。
