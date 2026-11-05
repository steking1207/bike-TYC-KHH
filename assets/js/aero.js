/*
 * 背景騎乘動畫 v6：日夜循環、城市／山城混合／群山／海邊場景、風車與彎把公路車騎士（Canvas）。
 * 改寫自使用者提供的 AERO CYCLING 線稿頁（原頁在 aero/），改成可嵌入的模組：
 * 畫在指定 canvas 的大小內，日夜配色透過 onPalette 回呼交給網站同步，畫布文字 ≥13px。
 */
export function mountAero(canvas, opts = {}) {
  let VW = 0; let VH = 0; let raf = 0; let running = false;
  const onPalette = opts.onPalette || (() => {});
  /**
   * ============================================================================
   * AERO CYCLING v5.0 — 日夜循環 + 城市/山稜視差 + Path2D 解剖學彎把公路車引擎
   * ============================================================================
   */
  const ctx = canvas.getContext('2d');

  // 核心狀態管理（線條濃淡預設 50% = 0.50，預設場景為「純城市」展示都市動態車流與高架捷運）
  let cyclistStyle = opts.style || 'sculpted'; // 'sculpted' | 'hatched' | 'blueprint' | 'ribbon'
  let sceneMode = opts.scene || 'city';        // 'city' (純城市) | 'hybrid' (山城混合) | 'mountain' (純山稜)
  let dayNightMode = opts.time || 'auto';     // 'auto' | 'day' | 'dusk' | 'night'
  const START = { day: 10.5, dusk: 17.6, night: 22.5 };
  let timeOfDay = START[opts.time] ?? 10.5; // 24 小時制時間 (0.0 ~ 24.0)
  let targetTimeOfDay = timeOfDay;
  let lineOpacity = opts.opacity ?? 0.50;        // 預設 50% 線條濃淡
  let targetSpeed = opts.speed ?? 34.0;
  let currentSpeed = targetSpeed;

  // 動態日夜色彩緩存
  let currentPalette = {
    bgHex: '#f6f5f2',
    inkRgb: [39, 39, 42],
    subRgb: [82, 82, 91],
    faintRgb: [161, 161, 170],
    accentRgb: [14, 116, 144],
    nightFactor: 0.0, // 0 = 白天, 0.5 = 黃昏, 1.0 = 黑夜
    duskFactor: 0.0
  };

  // 動畫時間與物理相位
  let lastTime = performance.now();
  let pedalPhase = 0;
  let riderScale = 1;
  let wheelPhase = 0;
  let roadOffset = 0;
  let ridgeOffsets = [0, 0, 0, 0]; // 極遠山、遠景、中景、近景水平視差位移

  // 海邊風力發電機配置（精簡為 3 座，讓海景更開闊）
  const turbines = [
    { xRatio: 0.24, scale: 0.36, layer: 0, angle: 0.5, speedMult: 0.74 },
    { xRatio: 0.72, scale: 0.33, layer: 0, angle: 2.6, speedMult: 0.70 },
    { xRatio: 0.42, scale: 0.62, layer: 1, angle: 1.5, speedMult: 0.90 }
  ];

  // 海邊場景動態船隻與海鷗狀態
  const coastalVessels = [
    { offset: 220, speed: 6.5,  type: 'cargo', scale: 0.88, layer: 0 },
    { offset: 680, speed: 14.0, type: 'yacht', scale: 0.92, layer: 1 },
    { offset: 980, speed: 11.5, type: 'yacht', scale: 0.72, layer: 1 },
    { offset: 1320, speed: 5.2, type: 'cargo', scale: 0.74, layer: 0 }
  ];

  // 城市快車道動態汽車與公車車流 (laneYOffset 設為 0，確保車輪 100% 精準貼齊地面線 roadY)
  const urbanCars = [
    { offset: 90,   relSpeed: 125,  type: 'coupe', scale: 0.90, laneYOffset: 0, dir: 1 },
    { offset: 390,  relSpeed: -165, type: 'sedan', scale: 0.82, laneYOffset: 0, dir: -1 },
    { offset: 680,  relSpeed: 76,   type: 'bus',   scale: 0.88, laneYOffset: 0, dir: 1 },
    { offset: 980,  relSpeed: -190, type: 'suv',   scale: 0.84, laneYOffset: 0, dir: -1 },
    { offset: 1260, relSpeed: 145,  type: 'coupe', scale: 0.86, laneYOffset: 0, dir: 1 },
    { offset: 1520, relSpeed: -150, type: 'sedan', scale: 0.80, laneYOffset: 0, dir: -1 }
  ];

  // 夜空幾何星象與星座連線配置
  const starField = [];
  function initStars() {
    starField.length = 0;
    for (let i = 0; i < 42; i++) {
      const seed = (i * 9301 + 49297) % 233280;
      const r1 = seed / 233280;
      const r2 = ((seed * 7) % 233280) / 233280;
      starField.push({
        xRatio: (i / 42) + (r1 - 0.5) * 0.02,
        yRatio: 0.05 + r2 * 0.42,
        size: 1.1 + (i % 3) * 0.65,
        twinklePhase: i * 1.3,
        connectNext: i % 5 === 0 || i % 5 === 1
      });
    }
  }

  // 氣流微粒線
  const windStreaks = [];
  function initWindStreaks() {
    windStreaks.length = 0;
    const w = VW;
    const h = VH;
    for (let i = 0; i < 24; i++) {
      windStreaks.push({
        x: Math.random() * w,
        y: h * 0.25 + Math.random() * (h * 0.52),
        len: 35 + Math.random() * 85,
        speed: 1.6 + Math.random() * 2.4,
        alpha: 0.12 + Math.random() * 0.24
      });
    }
  }

  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    VW = canvas.clientWidth; VH = canvas.clientHeight;
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    initWindStreaks();
    if (starField.length === 0) initStars();
  }

  /**
   * ============================================================================
   * 日夜色彩插值系統 (Day / Dusk / Night Smooth Color Interpolation)
   * ============================================================================
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t))
    ];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  function updateDayNightPalette(dt) {
    if (dayNightMode === 'auto') {
      // 自動循環：約每 36 秒完成一整天 24 小時日夜循環
      timeOfDay = (timeOfDay + dt * 0.68) % 24;
    } else {
      // 直接切換時，平滑過渡至目標時段
      let diff = targetTimeOfDay - timeOfDay;
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      timeOfDay = (timeOfDay + diff * Math.min(1, dt * 5.5) + 24) % 24;
    }

    // 將 24 小時映射為白天 (Day: 7~16)、黃昏/破曉 (Dusk/Dawn: 5~7, 16~20)、黑夜 (Night: 20~5)
    let nightF = 0;
    let duskF = 0;

    if (timeOfDay >= 7.5 && timeOfDay <= 16.0) {
      nightF = 0;
      duskF = 0;
    } else if (timeOfDay > 16.0 && timeOfDay < 18.2) {
      // 下午進入黃昏
      const t = (timeOfDay - 16.0) / 2.2;
      duskF = Math.sin(t * Math.PI * 0.5);
      nightF = t * 0.35;
    } else if (timeOfDay >= 18.2 && timeOfDay < 20.2) {
      // 黃昏進入黑夜
      const t = (timeOfDay - 18.2) / 2.0;
      duskF = Math.cos(t * Math.PI * 0.5);
      nightF = 0.35 + t * 0.65;
    } else if (timeOfDay >= 20.2 || timeOfDay < 4.5) {
      // 深邃黑夜
      nightF = 1.0;
      duskF = 0.0;
    } else if (timeOfDay >= 4.5 && timeOfDay < 6.0) {
      // 破曉微光
      const t = (timeOfDay - 4.5) / 1.5;
      duskF = Math.sin(t * Math.PI * 0.5);
      nightF = 1.0 - t * 0.65;
    } else {
      // 6.0 ~ 7.5 日出轉白天
      const t = (timeOfDay - 6.0) / 1.5;
      duskF = Math.cos(t * Math.PI * 0.5);
      nightF = 0.35 * (1 - t);
    }

    // 定義三種基準調色盤 (Day / Dusk / Night) 與藍圖專屬色盤
    const isBlueprint = cyclistStyle === 'blueprint';

    const dayPal = isBlueprint
      ? { bg: [238, 244, 248], ink: [15, 58, 92], sub: [38, 102, 148], faint: [115, 162, 198], accent: [2, 132, 199] }
      : { bg: [245, 245, 242], ink: [11, 15, 26], sub: [82, 82, 91], faint: [161, 161, 170], accent: [14, 116, 144] };

    const duskPal = isBlueprint
      ? { bg: [34, 48, 68], ink: [224, 242, 254], sub: [125, 211, 252], faint: [71, 128, 168], accent: [251, 191, 36] }
      : { bg: [232, 221, 206], ink: [52, 42, 38], sub: [108, 88, 76], faint: [168, 148, 134], accent: [194, 65, 12] };

    const nightPal = isBlueprint
      ? { bg: [11, 19, 30], ink: [215, 240, 255], sub: [110, 178, 225], faint: [48, 98, 142], accent: [56, 189, 248] }
      : { bg: [18, 20, 24], ink: [228, 228, 234], sub: [152, 156, 168], faint: [78, 82, 94], accent: [245, 158, 11] };

    // 先由 Day 與 Night 線性插值，再疊加 Dusk 暮色過渡
    let bgRgb = lerpRgb(dayPal.bg, nightPal.bg, nightF);
    let inkRgb = lerpRgb(dayPal.ink, nightPal.ink, nightF);
    let subRgb = lerpRgb(dayPal.sub, nightPal.sub, nightF);
    let faintRgb = lerpRgb(dayPal.faint, nightPal.faint, nightF);
    let accentRgb = lerpRgb(dayPal.accent, nightPal.accent, nightF);

    if (duskF > 0.01) {
      bgRgb = lerpRgb(bgRgb, duskPal.bg, duskF * 0.78);
      inkRgb = lerpRgb(inkRgb, duskPal.ink, duskF * 0.78);
      subRgb = lerpRgb(subRgb, duskPal.sub, duskF * 0.78);
      faintRgb = lerpRgb(faintRgb, duskPal.faint, duskF * 0.78);
      accentRgb = lerpRgb(accentRgb, duskPal.accent, duskF * 0.85);
    }

    const bgHex = rgbToHex(bgRgb);
    const textHex = rgbToHex(inkRgb);

    currentPalette = {
      bgHex,
      inkRgb,
      subRgb,
      faintRgb,
      accentRgb,
      nightFactor: nightF,
      duskFactor: duskF
    };

    onPalette({ bgRgb, inkRgb, subRgb, accentRgb, nightF, duskF, timeOfDay });
  }

  function getBgColor() {
    return currentPalette.bgHex;
  }

  function strokeCol(tier = 'ink', alpha = 1) {
    let rgbArr = currentPalette.inkRgb;
    if (tier === 'sub') rgbArr = currentPalette.subRgb;
    else if (tier === 'faint') rgbArr = currentPalette.faintRgb;
    else if (tier === 'accent') rgbArr = currentPalette.accentRgb;

    const finalAlpha = Math.max(0.02, Math.min(1, alpha * lineOpacity));
    return `rgba(${rgbArr[0]}, ${rgbArr[1]}, ${rgbArr[2]}, ${finalAlpha})`;
  }

  /**
   * ============================================================================
   * 0. 全局天空、日夜天體運行軌跡（太陽 / 弦月 / 星座座標）與環境流場
   * ============================================================================
   */
  function drawCelestialAndSky(w, h, roadY, cyclistX, time) {
    ctx.save();

    const nightF = currentPalette.nightFactor;
    const duskF = currentPalette.duskFactor;

    // A. 繪製極簡天體運行軌跡弧 (Celestial Trajectory Arc)
    const arcCx = w * 0.52;
    const arcCy = roadY + h * 0.12;
    const arcRx = w * 0.44;
    const arcRy = roadY * 0.78;

    const orbitPath = new Path2D();
    orbitPath.ellipse(arcCx, arcCy, arcRx, arcRy, 0, Math.PI * 1.12, Math.PI * 1.88);
    ctx.strokeStyle = strokeCol('faint', 0.22);
    ctx.lineWidth = 0.75;
    ctx.setLineDash([4, 6]);
    ctx.stroke(orbitPath);
    ctx.setLineDash([]);

    // B. 夜晚與黃昏星象圖 (Constellation Stars & Crosshairs)
    if (nightF > 0.12) {
      const starAlpha = (nightF - 0.12) / 0.88;
      const constellationPath = new Path2D();

      for (let i = 0; i < starField.length; i++) {
        const st = starField[i];
        const sx = ((st.xRatio * w - ridgeOffsets[0] * 0.05) % w + w) % w;
        const sy = st.yRatio * roadY;
        const twinkle = 0.65 + 0.35 * Math.sin(time * 0.003 + st.twinklePhase);

        // 繪製星點或十字星芒
        const starCross = new Path2D();
        const r = st.size * twinkle;
        starCross.moveTo(sx - r * 1.8, sy);
        starCross.lineTo(sx + r * 1.8, sy);
        starCross.moveTo(sx, sy - r * 1.8);
        starCross.lineTo(sx, sy + r * 1.8);
        ctx.strokeStyle = strokeCol(i % 4 === 0 ? 'accent' : 'sub', starAlpha * 0.65 * twinkle);
        ctx.lineWidth = 0.8;
        ctx.stroke(starCross);

        // 幾何星座虛線連線
        if (st.connectNext && i + 1 < starField.length) {
          const nextSt = starField[i + 1];
          const nx = ((nextSt.xRatio * w - ridgeOffsets[0] * 0.05) % w + w) % w;
          const ny = nextSt.yRatio * roadY;
          if (Math.hypot(nx - sx, ny - sy) < w * 0.16) {
            constellationPath.moveTo(sx, sy);
            constellationPath.lineTo(nx, ny);
          }
        }
      }

      ctx.strokeStyle = strokeCol('faint', starAlpha * 0.28);
      ctx.lineWidth = 0.65;
      ctx.setLineDash([2, 4]);
      ctx.stroke(constellationPath);
      ctx.setLineDash([]);
    }

    // C. 太陽位置計算與繪製 (06:00 日出 -> 12:00 正午 -> 18:30 日落)
    if (timeOfDay >= 5.2 && timeOfDay <= 19.2) {
      const sunProg = (timeOfDay - 5.2) / 14.0; // 0 ~ 1
      const sunAngle = Math.PI * (1.14 + sunProg * 0.72);
      const sunX = arcCx + Math.cos(sunAngle) * arcRx;
      const sunY = arcCy + Math.sin(sunAngle) * arcRy;
      const sunR = duskF > 0.2 ? 24 : 18;

      ctx.save();
      ctx.translate(sunX, sunY);

      // 外圍光暈同心線圈
      const haloPath = new Path2D();
      haloPath.arc(0, 0, sunR + 9, 0, Math.PI * 2);
      ctx.strokeStyle = strokeCol(duskF > 0.25 ? 'accent' : 'faint', 0.35);
      ctx.lineWidth = 0.8;
      ctx.setLineDash(cyclistStyle === 'blueprint' ? [3, 3] : [8, 4]);
      ctx.stroke(haloPath);
      ctx.setLineDash([]);

      // 太陽本體
      const sunBody = new Path2D();
      sunBody.arc(0, 0, sunR, 0, Math.PI * 2);
      ctx.fillStyle = getBgColor();
      ctx.fill(sunBody);

      if (cyclistStyle === 'hatched') {
        drawHatchingInPath(sunBody, -sunR, sunR, -sunR, sunR, 3.8, 0.42);
      }

      ctx.strokeStyle = strokeCol(duskF > 0.25 ? 'accent' : 'sub', 0.82);
      ctx.lineWidth = 1.4;
      ctx.stroke(sunBody);

      if (cyclistStyle === 'blueprint') {
        ctx.font = '400 13px "JetBrains Mono", monospace';
        ctx.fillStyle = strokeCol('accent', 0.75);
        ctx.fillText(`SOL AZ.${Math.round(sunProg * 180)}°`, sunR + 12, 3);
      }
      ctx.restore();
    }

    // D. 弦月位置計算與繪製 (17:30 月升 -> 00:00 子夜 -> 06:30 月落)
    const moonTime = (timeOfDay + 6) % 24; // 將夜晚中心移至正中
    if (moonTime >= 5.0 && moonTime <= 19.0) {
      const moonProg = (moonTime - 5.0) / 14.0;
      const moonAngle = Math.PI * (1.15 + moonProg * 0.70);
      const moonX = arcCx + Math.cos(moonAngle) * arcRx;
      const moonY = arcCy + Math.sin(moonAngle) * arcRy;
      const moonR = 16;

      ctx.save();
      ctx.translate(moonX, moonY);
      ctx.rotate(-0.35);

      const moonHalo = new Path2D();
      moonHalo.arc(0, 0, moonR + 8, 0, Math.PI * 2);
      ctx.strokeStyle = strokeCol('faint', 0.3 * nightF);
      ctx.lineWidth = 0.75;
      ctx.setLineDash([2, 4]);
      ctx.stroke(moonHalo);
      ctx.setLineDash([]);

      // 精緻弦月輪廓 (Crescent Moon Path2D)
      const crescent = new Path2D();
      crescent.arc(0, 0, moonR, -Math.PI * 0.65, Math.PI * 0.65, false);
      crescent.quadraticCurveTo(-moonR * 0.15, 0, Math.cos(-Math.PI * 0.65) * moonR, Math.sin(-Math.PI * 0.65) * moonR);
      crescent.closePath();

      ctx.fillStyle = getBgColor();
      ctx.fill(crescent);
      if (cyclistStyle === 'hatched') {
        drawHatchingInPath(crescent, -moonR, moonR, -moonR, moonR, 3.4, 0.5);
      }
      ctx.strokeStyle = strokeCol('ink', 0.88);
      ctx.lineWidth = 1.4;
      ctx.stroke(crescent);

      if (cyclistStyle === 'blueprint') {
        ctx.rotate(0.35);
        ctx.font = '400 13px "JetBrains Mono", monospace';
        ctx.fillStyle = strokeCol('accent', 0.8);
        ctx.fillText('LUNA PHASE 0.28', moonR + 10, 3);
      }
      ctx.restore();
    }

    // E. 依畫風繪製天空背景網格 / 版畫雲線 / 風洞層流線
    if (cyclistStyle === 'blueprint') {
      const minorStep = 36;
      const majorStep = 180;
      const gridMinor = new Path2D();
      const gridMajor = new Path2D();

      for (let x = 0; x <= w; x += minorStep) {
        if (x % majorStep === 0) {
          gridMajor.moveTo(x, 0);
          gridMajor.lineTo(x, h);
        } else {
          gridMinor.moveTo(x, 0);
          gridMinor.lineTo(x, h);
        }
      }
      for (let y = 0; y <= h; y += minorStep) {
        if (y % majorStep === 0) {
          gridMajor.moveTo(0, y);
          gridMajor.lineTo(w, y);
        } else {
          gridMinor.moveTo(0, y);
          gridMinor.lineTo(w, y);
        }
      }

      ctx.strokeStyle = strokeCol('faint', 0.14);
      ctx.lineWidth = 0.6;
      ctx.stroke(gridMinor);

      ctx.strokeStyle = strokeCol('faint', 0.26);
      ctx.lineWidth = 0.85;
      ctx.stroke(gridMajor);

      const crossPath = new Path2D();
      ctx.font = '400 13px "JetBrains Mono", monospace';
      ctx.fillStyle = strokeCol('faint', 0.55);
      for (let x = majorStep; x < w; x += majorStep) {
        for (let y = majorStep; y < roadY; y += majorStep) {
          crossPath.moveTo(x - 4, y);
          crossPath.lineTo(x + 4, y);
          crossPath.moveTo(x, y - 4);
          crossPath.lineTo(x, y + 4);
        }
        ctx.fillText(`X:${x}`, x + 4, 72);
      }
      ctx.strokeStyle = strokeCol('accent', 0.45);
      ctx.lineWidth = 0.9;
      ctx.stroke(crossPath);
    } else if (cyclistStyle === 'hatched') {
      const skyHatch = new Path2D();
      const bandCount = 5;
      for (let b = 0; b < bandCount; b++) {
        const baseBx = ((b * 340 - ridgeOffsets[0] * 0.45) % (w + 300) + (w + 300)) % (w + 300) - 150;
        const baseBy = h * 0.14 + (b % 3) * 58;
        const clusterW = 130 + (b % 2) * 55;
        for (let i = 0; i < clusterW; i += 6.5) {
          const hLen = Math.sin((i / clusterW) * Math.PI) * 14;
          skyHatch.moveTo(baseBx + i, baseBy - hLen * 0.3);
          skyHatch.lineTo(baseBx + i + hLen * 0.9, baseBy - hLen * 1.1);
        }
      }
      ctx.strokeStyle = strokeCol('faint', 0.32);
      ctx.lineWidth = 0.8;
      ctx.stroke(skyHatch);
    } else if (cyclistStyle === 'ribbon') {
      const streamCount = 9;
      const cY = roadY - 95;
      for (let i = 0; i < streamCount; i++) {
        const baseY = h * 0.16 + (i / (streamCount - 1)) * (roadY - h * 0.20);
        const streamPath = new Path2D();
        for (let x = 0; x <= w; x += 16) {
          const dx = x - cyclistX;
          const dy = baseY - cY;
          const distSq = dx * dx + dy * dy * 1.8;
          const deflect = -Math.exp(-distSq / 18000) * 34 * Math.max(0.15, 1 - Math.abs(dy) / 220);
          const wave = Math.sin((x + ridgeOffsets[1] * 2.2) * 0.008 + i * 0.9) * 5.5;
          const py = baseY + deflect + wave;
          if (x === 0) streamPath.moveTo(x, py);
          else streamPath.lineTo(x, py);
        }
        ctx.strokeStyle = strokeCol(i % 3 === 0 ? 'sub' : 'faint', i % 3 === 0 ? 0.34 : 0.20);
        ctx.lineWidth = i % 3 === 0 ? 1.15 : 0.75;
        ctx.stroke(streamPath);
      }
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 1B. 城市建築天際線與現代橋樑視差層 (3-Layer Architectural City Skyline)
   * ============================================================================
   */
  function getBuildingSpec(slotIndex, layerIndex) {
    const h1 = Math.abs(Math.sin(slotIndex * 12.9898 + layerIndex * 78.233) * 43758.5453);
    const r1 = h1 - Math.floor(h1);
    const h2 = Math.abs(Math.sin(slotIndex * 39.346 + layerIndex * 11.135) * 23421.631);
    const r2 = h2 - Math.floor(h2);

    const modSlot = ((slotIndex % 10) + 10) % 10;
    if (modSlot === 4) {
      return { type: 'bridge', width: 110, height: [95, 78, 52][layerIndex], r1, r2 };
    }
    if (modSlot === 8 || (sceneMode === 'hybrid' && modSlot % 3 === 0)) {
      return { type: 'gap' };
    }

    const baseH = [185, 130, 74][layerIndex];
    const varH = [95, 72, 42][layerIndex];
    const height = baseH * 0.45 + r1 * varH;
    const width = [44, 52, 58][layerIndex] + r2 * 26;

    let styleType = 'modern';
    if (r1 > 0.72) styleType = 'stepped';
    else if (r2 > 0.68) styleType = 'diag';

    return { type: styleType, width, height, r1, r2, hasSpire: r1 > 0.62 };
  }

  function drawCitySkylineLayer(w, roadY, layerIndex, scrollOffset, time) {
    const slotSpan = [66, 78, 92][layerIndex];
    const startSlot = Math.floor(scrollOffset / slotSpan) - 2;
    const endSlot = Math.ceil((scrollOffset + w) / slotSpan) + 2;
    const alphaLayer = [0.42, 0.64, 0.84][layerIndex];
    const lineW = [1.0, 1.35, 1.65][layerIndex];
    const nightF = currentPalette.nightFactor;
    const duskF = currentPalette.duskFactor;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = cyclistStyle === 'blueprint' ? 'miter' : 'round';

    if (cyclistStyle === 'ribbon') {
      const strandCount = 4;
      for (let s = 0; s < strandCount; s++) {
        const skylineRibbon = new Path2D();
        let started = false;
        for (let slot = startSlot; slot <= endSlot; slot++) {
          const sx = slot * slotSpan - scrollOffset;
          const spec = getBuildingSpec(slot, layerIndex);
          const topY = spec.type === 'gap'
            ? roadY - 6
            : roadY - spec.height + s * 11;

          if (!started) {
            skylineRibbon.moveTo(sx, roadY);
            started = true;
          }
          skylineRibbon.lineTo(sx + 4, topY);
          skylineRibbon.lineTo(sx + slotSpan - 6, topY);
          skylineRibbon.lineTo(sx + slotSpan, roadY);
        }
        ctx.strokeStyle = strokeCol(s === 0 ? 'sub' : 'faint', alphaLayer * (1 - s * 0.22));
        ctx.lineWidth = s === 0 ? lineW : 0.8;
        ctx.stroke(skylineRibbon);
      }
      ctx.restore();
      return;
    }

    for (let slot = startSlot; slot <= endSlot; slot++) {
      const spec = getBuildingSpec(slot, layerIndex);
      if (spec.type === 'gap') continue;

      const bx = slot * slotSpan - scrollOffset;
      const bw = Math.min(spec.width, slotSpan - 4);
      const bh = spec.height;
      const topY = roadY - bh;

      if (spec.type === 'bridge') {
        const pylonX = bx + slotSpan * 0.5;
        const pylonTopY = roadY - bh * 1.15;
        const deckY = roadY - bh * 0.32;

        const cablesPath = new Path2D();
        for (let c = 1; c <= 5; c++) {
          const anchorOffset = c * (slotSpan * 0.16);
          const pylonAnchorY = pylonTopY + c * 6;
          cablesPath.moveTo(pylonX, pylonAnchorY);
          cablesPath.lineTo(pylonX - anchorOffset, deckY);
          cablesPath.moveTo(pylonX, pylonAnchorY);
          cablesPath.lineTo(pylonX + anchorOffset, deckY);
        }
        ctx.strokeStyle = strokeCol('faint', alphaLayer * 0.65);
        ctx.lineWidth = 0.75;
        ctx.stroke(cablesPath);

        const pylonPath = new Path2D();
        pylonPath.moveTo(pylonX - 5, roadY);
        pylonPath.lineTo(pylonX - 2, pylonTopY);
        pylonPath.lineTo(pylonX + 2, pylonTopY);
        pylonPath.lineTo(pylonX + 5, roadY);
        pylonPath.closePath();
        ctx.fillStyle = getBgColor();
        ctx.fill(pylonPath);
        ctx.strokeStyle = strokeCol('sub', alphaLayer);
        ctx.lineWidth = lineW;
        ctx.stroke(pylonPath);

        const deckPath = new Path2D();
        deckPath.rect(pylonX - slotSpan * 0.85, deckY - 3, slotSpan * 1.7, 4);
        ctx.fill(deckPath);
        ctx.stroke(deckPath);
        continue;
      }

      const bldgPath = new Path2D();
      if (spec.type === 'stepped') {
        const step1Y = roadY - bh * 0.72;
        const step2Y = roadY - bh * 0.90;
        bldgPath.moveTo(bx, roadY);
        bldgPath.lineTo(bx, step1Y);
        bldgPath.lineTo(bx + bw * 0.14, step1Y);
        bldgPath.lineTo(bx + bw * 0.14, step2Y);
        bldgPath.lineTo(bx + bw * 0.28, step2Y);
        bldgPath.lineTo(bx + bw * 0.28, topY);
        bldgPath.lineTo(bx + bw * 0.72, topY);
        bldgPath.lineTo(bx + bw * 0.72, step2Y);
        bldgPath.lineTo(bx + bw * 0.86, step2Y);
        bldgPath.lineTo(bx + bw * 0.86, step1Y);
        bldgPath.lineTo(bx + bw, step1Y);
        bldgPath.lineTo(bx + bw, roadY);
        bldgPath.closePath();
      } else if (spec.type === 'diag') {
        bldgPath.moveTo(bx, roadY);
        bldgPath.lineTo(bx, topY + 16);
        bldgPath.lineTo(bx + bw * 0.82, topY);
        bldgPath.lineTo(bx + bw, topY + 8);
        bldgPath.lineTo(bx + bw, roadY);
        bldgPath.closePath();
      } else {
        bldgPath.rect(bx, topY, bw, bh);
      }

      ctx.fillStyle = getBgColor();
      ctx.fill(bldgPath);

      if (cyclistStyle === 'hatched') {
        ctx.save();
        ctx.clip(bldgPath);
        const shadowW = bw * 0.38;
        const sideShadow = new Path2D();
        sideShadow.rect(bx, topY, shadowW, bh);
        drawHatchingInPath(sideShadow, bx - 4, bx + shadowW + 4, topY - 4, roadY + 4, 4.2, alphaLayer * 0.62);
        ctx.restore();
      }

      if (cyclistStyle === 'blueprint') {
        ctx.save();
        ctx.clip(bldgPath);
        const bracePath = new Path2D();
        const tierH = 26;
        for (let y = roadY; y > topY; y -= tierH) {
          bracePath.moveTo(bx, y);
          bracePath.lineTo(bx + bw, y);
          bracePath.moveTo(bx, y);
          bracePath.lineTo(bx + bw, y - tierH);
          bracePath.moveTo(bx + bw, y);
          bracePath.lineTo(bx, y - tierH);
        }
        ctx.strokeStyle = strokeCol('faint', alphaLayer * 0.45);
        ctx.lineWidth = 0.7;
        ctx.stroke(bracePath);
        ctx.restore();

        if (spec.hasSpire && layerIndex <= 1 && slot % 3 === 0) {
          ctx.font = '500 13px "JetBrains Mono", monospace';
          ctx.fillStyle = strokeCol('accent', alphaLayer * 0.95);
          ctx.fillText(`BLDG ${Math.round(bh * 1.4)}m`, bx + 2, topY - 18);
        }
      }

      if (cyclistStyle !== 'blueprint') {
        ctx.save();
        ctx.clip(bldgPath);
        const facadePath = new Path2D();
        const colStep = Math.max(8, bw * 0.25);
        for (let cx = bx + colStep; cx < bx + bw - 3; cx += colStep) {
          facadePath.moveTo(cx, topY + 6);
          facadePath.lineTo(cx, roadY);
        }
        ctx.strokeStyle = strokeCol('faint', alphaLayer * 0.32);
        ctx.lineWidth = 0.65;
        ctx.stroke(facadePath);

        if (nightF > 0.18 || duskF > 0.35) {
          const winAlpha = Math.max(nightF, duskF * 0.7) * alphaLayer * 0.85;
          const winPath = new Path2D();
          for (let wy = topY + 12; wy < roadY - 12; wy += 9) {
            const rowHash = Math.sin(slot * 17.3 + wy * 0.41);
            if (rowHash > -0.15) {
              const xStart = bx + 5 + (rowHash > 0.3 ? 0 : bw * 0.25);
              const xEnd = bx + bw - 5 - (rowHash < 0.2 ? bw * 0.2 : 0);
              if (xEnd > xStart) {
                winPath.moveTo(xStart, wy);
                winPath.lineTo(xEnd, wy);
              }
            }
          }
          ctx.strokeStyle = strokeCol(nightF > 0.5 ? 'accent' : 'ink', winAlpha);
          ctx.lineWidth = 1.25;
          ctx.setLineDash([5, 4]);
          ctx.stroke(winPath);
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      ctx.strokeStyle = strokeCol(layerIndex === 0 ? 'faint' : 'sub', alphaLayer);
      ctx.lineWidth = lineW;
      ctx.stroke(bldgPath);

      if (spec.hasSpire) {
        const spireX = bx + bw * 0.5;
        const spireTopY = topY - 16;
        const spirePath = new Path2D();
        spirePath.moveTo(spireX, topY);
        spirePath.lineTo(spireX, spireTopY);
        ctx.strokeStyle = strokeCol('sub', alphaLayer);
        ctx.lineWidth = 1.0;
        ctx.stroke(spirePath);

        if (nightF > 0.2 || duskF > 0.3) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 0.005 + slot * 1.7);
          const beacon = new Path2D();
          beacon.arc(spireX, spireTopY, 1.8 + pulse * 1.8, 0, Math.PI * 2);
          ctx.strokeStyle = strokeCol('accent', Math.max(nightF, duskF) * pulse * 0.9);
          ctx.lineWidth = 1.1;
          ctx.stroke(beacon);
        }
      }
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 1C. 城市地面動態汽車與電動公車車流 (Ground-aligned Cars, Bus & Streetlights)
   * ============================================================================
   */
  function drawUrbanCarsAndStreetlights(w, roadY, scrollOffset, time) {
    const nightStrength = Math.max(currentPalette.nightFactor, currentPalette.duskFactor * 0.75);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const lampSpan = 260;
    const startLamp = Math.floor((scrollOffset * 1.35) / lampSpan) - 1;
    const endLamp = Math.ceil((scrollOffset * 1.35 + w) / lampSpan) + 1;

    for (let i = startLamp; i <= endLamp; i++) {
      const lx = i * lampSpan - (scrollOffset * 1.35);
      const lampTopY = roadY - 94;

      const polePath = new Path2D();
      polePath.moveTo(lx, roadY);
      polePath.lineTo(lx, lampTopY + 12);
      polePath.quadraticCurveTo(lx, lampTopY, lx + 18, lampTopY);
      ctx.strokeStyle = strokeCol('sub', 0.55);
      ctx.lineWidth = 1.25;
      ctx.stroke(polePath);

      const headX = lx + 18;
      if (nightStrength > 0.18) {
        const lightCone = new Path2D();
        lightCone.moveTo(headX, lampTopY);
        lightCone.lineTo(headX - 38, roadY);
        lightCone.lineTo(headX + 44, roadY);
        lightCone.closePath();

        if (cyclistStyle === 'hatched') {
          drawHatchingInPath(lightCone, headX - 40, headX + 46, lampTopY, roadY, 6.5, nightStrength * 0.25);
        }
        ctx.strokeStyle = strokeCol('accent', nightStrength * 0.32);
        ctx.lineWidth = 0.8;
        ctx.setLineDash(cyclistStyle === 'blueprint' ? [3, 3] : []);
        ctx.stroke(lightCone);
        ctx.setLineDash([]);

        const bulb = new Path2D();
        bulb.arc(headX, lampTopY, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = strokeCol('accent', nightStrength * 0.9);
        ctx.fill(bulb);
      }
    }

    const trackSpan = w + 420;
    urbanCars.forEach((car) => {
      const carX = ((car.offset % trackSpan) + trackSpan) % trackSpan - 210;
      const carY = roadY + car.laneYOffset;
      const s = car.scale;
      const dir = car.dir || 1;

      ctx.save();
      ctx.translate(carX, carY);
      ctx.scale(s * dir, s);

      const bodyPath = new Path2D();
      const winPath = new Path2D();
      let rearWheelX = -26, frontWheelX = 28, wheelR = 9.2;

      if (car.type === 'bus') {
        rearWheelX = -38;
        frontWheelX = 38;
        wheelR = 10.5;
        bodyPath.moveTo(-62, -7);
        bodyPath.lineTo(-62, -36);
        bodyPath.quadraticCurveTo(-62, -41, -55, -41);
        bodyPath.lineTo(52, -41);
        bodyPath.quadraticCurveTo(60, -41, 63, -31);
        bodyPath.lineTo(64, -7);
        bodyPath.closePath();

        winPath.roundRect(-55, -36, 32, 13, 2);
        winPath.roundRect(-19, -36, 32, 13, 2);
        winPath.roundRect(17, -36, 40, 14, 2);
      } else if (car.type === 'coupe') {
        bodyPath.moveTo(-44, -6);
        bodyPath.lineTo(-42, -17);
        bodyPath.lineTo(-26, -19);
        bodyPath.bezierCurveTo(-14, -30, 8, -30, 22, -19);
        bodyPath.lineTo(44, -14);
        bodyPath.quadraticCurveTo(48, -11, 46, -5);
        bodyPath.closePath();

        winPath.moveTo(-22, -19);
        winPath.bezierCurveTo(-12, -27, 5, -27, 17, -19);
        winPath.closePath();
      } else if (car.type === 'suv') {
        bodyPath.moveTo(-45, -7);
        bodyPath.lineTo(-43, -24);
        bodyPath.lineTo(-32, -33);
        bodyPath.lineTo(14, -33);
        bodyPath.lineTo(26, -21);
        bodyPath.lineTo(45, -17);
        bodyPath.lineTo(46, -7);
        bodyPath.closePath();

        winPath.moveTo(-29, -22);
        winPath.lineTo(-22, -30);
        winPath.lineTo(11, -30);
        winPath.lineTo(21, -22);
        winPath.closePath();
        wheelR = 10.2;
      } else {
        bodyPath.moveTo(-45, -6);
        bodyPath.lineTo(-44, -19);
        bodyPath.lineTo(-28, -21);
        bodyPath.lineTo(-15, -31);
        bodyPath.lineTo(12, -31);
        bodyPath.lineTo(25, -20);
        bodyPath.lineTo(45, -16);
        bodyPath.lineTo(46, -6);
        bodyPath.closePath();

        winPath.moveTo(-24, -20);
        winPath.lineTo(-13, -28.5);
        winPath.lineTo(10, -28.5);
        winPath.lineTo(20, -20);
        winPath.closePath();
      }

      if (cyclistStyle === 'ribbon') {
        for (let r = 0; r < 3; r++) {
          const stream = new Path2D();
          const oy = (car.type === 'bus' ? -38 : -26) - r * 5;
          stream.moveTo(58, -10 - r * 3);
          stream.bezierCurveTo(22, oy - 8, -18, oy - 8, -72 - r * 14, -12 - r * 4);
          ctx.strokeStyle = strokeCol(r === 0 ? 'ink' : 'sub', 0.72 - r * 0.2);
          ctx.lineWidth = 1.6 - r * 0.35;
          ctx.stroke(stream);
        }
      }

      ctx.fillStyle = getBgColor();
      ctx.fill(bodyPath);

      if (cyclistStyle === 'hatched') {
        ctx.save();
        ctx.clip(bodyPath);
        const lowerDoor = new Path2D();
        lowerDoor.rect(-65, -20, 130, 16);
        drawHatchingInPath(lowerDoor, -66, 66, -22, -4, 3.8, 0.45);
        ctx.restore();
      }

      ctx.strokeStyle = strokeCol(dir === 1 ? 'ink' : 'sub', dir === 1 ? 0.88 : 0.68);
      ctx.lineWidth = 1.65;
      ctx.stroke(bodyPath);

      if (car.type === 'bus' && nightStrength > 0.25) {
        ctx.fillStyle = strokeCol('accent', nightStrength * 0.35);
        ctx.fill(winPath);
      }
      ctx.strokeStyle = strokeCol('faint', 0.75);
      ctx.lineWidth = 1.15;
      ctx.stroke(winPath);

      [rearWheelX, frontWheelX].forEach(wx => {
        const wy = -wheelR;
        const tire = new Path2D();
        tire.arc(wx, wy, wheelR, 0, Math.PI * 2);
        ctx.fillStyle = getBgColor();
        ctx.fill(tire);
        ctx.strokeStyle = strokeCol('ink', 0.9);
        ctx.lineWidth = 1.6;
        ctx.stroke(tire);

        const rim = new Path2D();
        rim.arc(wx, wy, wheelR * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = strokeCol('sub', 0.7);
        ctx.lineWidth = 1.0;
        ctx.stroke(rim);

        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(wheelPhase * 1.25);
        const spoke = new Path2D();
        spoke.moveTo(-wheelR * 0.55, 0);
        spoke.lineTo(wheelR * 0.55, 0);
        spoke.moveTo(0, -wheelR * 0.55);
        spoke.lineTo(0, wheelR * 0.55);
        ctx.strokeStyle = strokeCol('faint', 0.65);
        ctx.lineWidth = 0.85;
        ctx.stroke(spoke);
        ctx.restore();
      });

      const frontBumperX = car.type === 'bus' ? 64 : 46;
      const rearBumperX = car.type === 'bus' ? -62 : -45;
      if (nightStrength > 0.18) {
        const headBeam = new Path2D();
        headBeam.moveTo(frontBumperX, -13);
        headBeam.lineTo(frontBumperX + 95, -3);
        headBeam.lineTo(frontBumperX + 95, -20);
        headBeam.closePath();
        ctx.strokeStyle = strokeCol('accent', nightStrength * 0.48);
        ctx.lineWidth = 0.95;
        ctx.stroke(headBeam);

        const tailStreak = new Path2D();
        tailStreak.moveTo(rearBumperX, -14);
        tailStreak.lineTo(rearBumperX - 42, -14);
        ctx.strokeStyle = strokeCol('accent', nightStrength * 0.78);
        ctx.lineWidth = 1.8;
        ctx.stroke(tailStreak);
      }

      if (cyclistStyle === 'blueprint') {
        ctx.save();
        ctx.scale(dir, 1);
        ctx.font = '500 13px "JetBrains Mono", monospace';
        ctx.fillStyle = strokeCol('accent', 0.9);
        const labelStr = car.type === 'bus' ? 'EV BUS · 12.0m' : `WB 2.8m · ${car.type.toUpperCase()}`;
        ctx.fillText(labelStr, -28, car.type === 'bus' ? -45 : -37);
        ctx.restore();

        const radarArc = new Path2D();
        radarArc.arc(frontBumperX, -12, 28, -0.35, 0.35);
        ctx.strokeStyle = strokeCol('accent', 0.6);
        ctx.lineWidth = 0.85;
        ctx.setLineDash([3, 3]);
        ctx.stroke(radarArc);
        ctx.setLineDash([]);
      }

      ctx.restore();
    });

    ctx.restore();
  }

  /**
   * ============================================================================
   * 2B. 群山專屬景觀系統：針葉林森林群、山間斜頂木屋/山莊建築與山谷飛鳥
   * ============================================================================
   */
  function drawPineTreeCluster(centerX, baseY, scale, count, seed, alpha, lineW) {
    for (let i = 0; i < count; i++) {
      const h1 = Math.sin(seed * 19.3 + i * 7.1) * 43758.54;
      const r1 = h1 - Math.floor(h1);
      const offsetX = (i - (count - 1) * 0.5) * (13 * scale) + (r1 - 0.5) * 5 * scale;
      const tx = centerX + offsetX;
      const ty = baseY + Math.abs(offsetX) * 0.12;
      const treeH = (22 + r1 * 14) * scale;
      const treeW = (8.5 + r1 * 3.5) * scale;

      if (cyclistStyle === 'ribbon') {
        const ribbonTree = new Path2D();
        ribbonTree.moveTo(tx, ty);
        ribbonTree.quadraticCurveTo(tx - treeW * 0.5, ty - treeH * 0.5, tx, ty - treeH);
        ribbonTree.quadraticCurveTo(tx + treeW * 0.5, ty - treeH * 0.5, tx, ty);
        ctx.strokeStyle = strokeCol('sub', alpha * 0.75);
        ctx.lineWidth = Math.max(0.65, lineW * 0.85);
        ctx.stroke(ribbonTree);
        continue;
      }

      // 三層傘狀針葉松樹輪廓 (3-Tiered Conifer Pine Silhouette)
      const treePath = new Path2D();
      const tTop = ty - treeH;
      const tMid1 = ty - treeH * 0.68;
      const tMid2 = ty - treeH * 0.38;
      const tBase = ty - treeH * 0.12;

      treePath.moveTo(tx, tTop);
      treePath.lineTo(tx + treeW * 0.55, tMid1);
      treePath.lineTo(tx + treeW * 0.25, tMid1);
      treePath.lineTo(tx + treeW * 0.80, tMid2);
      treePath.lineTo(tx + treeW * 0.38, tMid2);
      treePath.lineTo(tx + treeW, tBase);
      treePath.lineTo(tx - treeW, tBase);
      treePath.lineTo(tx - treeW * 0.38, tMid2);
      treePath.lineTo(tx - treeW * 0.80, tMid2);
      treePath.lineTo(tx - treeW * 0.25, tMid1);
      treePath.lineTo(tx - treeW * 0.55, tMid1);
      treePath.closePath();

      ctx.fillStyle = getBgColor();
      ctx.fill(treePath);

      if (cyclistStyle === 'hatched') {
        drawHatchingInPath(treePath, tx - treeW, tx, tTop, tBase, 3.6 * scale, alpha * 0.5);
      }

      ctx.strokeStyle = strokeCol('sub', alpha * 0.9);
      ctx.lineWidth = Math.max(0.7, lineW * 0.9);
      ctx.stroke(treePath);

      // 樹幹與中軸枝幹
      const trunkPath = new Path2D();
      trunkPath.moveTo(tx, ty + 2 * scale);
      trunkPath.lineTo(tx, tTop + 4 * scale);
      ctx.strokeStyle = strokeCol('faint', alpha * 0.7);
      ctx.lineWidth = Math.max(0.6, lineW * 0.7);
      ctx.stroke(trunkPath);
    }
  }

  function drawMountainBuilding(bx, baseY, scale, type, alpha, lineW, nightStrength, slotIdx) {
    ctx.save();
    ctx.translate(bx, baseY);
    ctx.scale(scale, scale);

    if (type === 'chalet') {
      // 山間斜頂木屋群 (Alpine A-Frame Chalet & Mountain Lodge)
      const lodgePath = new Path2D();
      // 主屋體與陡斜屋頂
      lodgePath.moveTo(-22, 2);
      lodgePath.lineTo(-22, -16);
      lodgePath.lineTo(-26, -14);
      lodgePath.lineTo(-4, -36);
      lodgePath.lineTo(18, -14);
      lodgePath.lineTo(14, -16);
      lodgePath.lineTo(14, 2);
      lodgePath.closePath();

      // 側翼山屋與煙囪
      lodgePath.moveTo(14, 2);
      lodgePath.lineTo(14, -14);
      lodgePath.lineTo(30, -22);
      lodgePath.lineTo(42, -12);
      lodgePath.lineTo(40, 2);
      lodgePath.closePath();

      lodgePath.rect(6, -31, 4.5, 11);

      ctx.fillStyle = getBgColor();
      ctx.fill(lodgePath);

      if (cyclistStyle === 'hatched') {
        drawHatchingInPath(lodgePath, -26, 0, -36, 2, 3.8, alpha * 0.52);
      }

      ctx.strokeStyle = strokeCol('ink', alpha * 0.92);
      ctx.lineWidth = lineW / scale;
      ctx.stroke(lodgePath);

      // 木屋窗格與夜間溫暖燈火
      const winPath = new Path2D();
      winPath.rect(-10, -21, 12, 7);
      winPath.rect(-13, -10, 8, 6);
      winPath.rect(22, -11, 10, 6);

      if (nightStrength > 0.18) {
        ctx.fillStyle = strokeCol('accent', nightStrength * alpha * 0.75);
        ctx.fill(winPath);
      }
      ctx.strokeStyle = strokeCol('sub', alpha * 0.8);
      ctx.lineWidth = (lineW * 0.75) / scale;
      ctx.stroke(winPath);

      if (cyclistStyle === 'blueprint') {
        ctx.font = '500 13px "JetBrains Mono", monospace';
        ctx.fillStyle = strokeCol('accent', alpha * 0.9);
        ctx.fillText(`LODGE #${Math.abs(slotIdx % 20)}`, -18, -41);
      }
    } else {
      // 山脊觀景閣／林務瞭望塔 (Mountain Ridge Observation Pavilion)
      const towerPath = new Path2D();
      towerPath.moveTo(-12, 2);
      towerPath.lineTo(-8, -18);
      towerPath.lineTo(8, -18);
      towerPath.lineTo(12, 2);
      towerPath.closePath();

      // 雙層挑高觀景台與斜頂
      towerPath.rect(-15, -26, 30, 8);
      towerPath.moveTo(-19, -26);
      towerPath.quadraticCurveTo(0, -38, 19, -26);
      towerPath.closePath();

      ctx.fillStyle = getBgColor();
      ctx.fill(towerPath);

      if (cyclistStyle === 'hatched') {
        drawHatchingInPath(towerPath, -19, 0, -38, 2, 3.8, alpha * 0.5);
      }

      ctx.strokeStyle = strokeCol('ink', alpha * 0.9);
      ctx.lineWidth = lineW / scale;
      ctx.stroke(towerPath);

      // 觀景窗燈光
      const lantern = new Path2D();
      lantern.rect(-10, -24, 20, 4.5);
      if (nightStrength > 0.18) {
        ctx.fillStyle = strokeCol('accent', nightStrength * alpha * 0.8);
        ctx.fill(lantern);
      }
      ctx.strokeStyle = strokeCol('sub', alpha * 0.75);
      ctx.stroke(lantern);
    }

    ctx.restore();
  }

  function drawMountainForestsAndBuildings(w, roadY, baseHeightOffset, layerIndex, scrollOffset, time) {
    if (layerIndex < 0) return; // 極遠山僅保留純山巒線條
    const baseY = roadY - baseHeightOffset;
    const slotSpan = [210, 240, 280][layerIndex];
    const scale = [0.46, 0.70, 0.96][layerIndex];
    const alphaLayer = [0.45, 0.68, 0.90][layerIndex];
    const lineW = [1.0, 1.3, 1.6][layerIndex];
    const nightStrength = Math.max(currentPalette.nightFactor, currentPalette.duskFactor * 0.75);

    const startSlot = Math.floor(scrollOffset / slotSpan) - 1;
    const endSlot = Math.ceil((scrollOffset + w) / slotSpan) + 1;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let slot = startSlot; slot <= endSlot; slot++) {
      const worldX = slot * slotSpan + layerIndex * 65;
      const x = worldX - scrollOffset;
      const groundY = layerIndex === 2
        ? roadY - 2
        : baseY + getRidgeElevation(worldX, layerIndex) + 8;

      const mod = ((slot % 4) + 4) % 4;

      // 1. 針葉森林群落 (Conifer Pine Forest Clusters)
      if (mod === 0 || mod === 2) {
        const treeCount = mod === 0 ? 5 : 3;
        drawPineTreeCluster(x, groundY, scale, treeCount, slot + layerIndex * 13, alphaLayer, lineW);
      }

      // 2. 山間木屋建築或山嶺觀景台 (Mountain Chalets & Observation Pavilions)
      if (mod === 1) {
        const bldgType = (Math.abs(slot + layerIndex) % 2 === 0) ? 'chalet' : 'pavilion';
        drawMountainBuilding(x, groundY + 2, scale, bldgType, alphaLayer, lineW, nightStrength, slot);
        // 建築旁點綴兩棵松樹
        drawPineTreeCluster(x - 36 * scale, groundY + 3, scale * 0.85, 2, slot * 3, alphaLayer, lineW);
      }
    }

    // 3. 遠山山谷飛鳥 (Soaring Mountain Birds on Layer 0)
    if (layerIndex === 0) {
      for (let b = 0; b < 3; b++) {
        const bx = ((b * 410 + time * 0.015 - scrollOffset * 0.4) % (w + 160) + (w + 160)) % (w + 160) - 80;
        const by = roadY * 0.26 + Math.sin(time * 0.002 + b * 2.1) * 14 + b * 18;
        const flap = Math.sin(time * 0.006 + b * 1.7) * 3.5;

        const birdPath = new Path2D();
        birdPath.moveTo(bx - 10, by - flap);
        birdPath.quadraticCurveTo(bx - 4, by - 4, bx, by);
        birdPath.quadraticCurveTo(bx + 4, by - 4, bx + 10, by - flap);
        ctx.strokeStyle = strokeCol('sub', 0.52);
        ctx.lineWidth = 1.1;
        ctx.stroke(birdPath);
      }
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 2C-0. 風力發電機繪製函式（海邊場景專屬：離岸與濱海風力發電）
   * ============================================================================
   */
  function drawWindTurbine(x, baseY, scale, angle, layer) {
    const towerH = 225 * scale;
    const bladeLen = 112 * scale;
    const hubY = baseY - towerH;

    const alphaByLayer = [0.42, 0.72, 0.94][layer] || 0.68;
    const lineW = Math.max(0.8, [1.0, 1.4, 1.8][layer] * scale);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 模式 D【流體風洞動線】：繪製風車葉片尖端向後延伸的螺旋尾流渦流軌跡
    if (cyclistStyle === 'ribbon') {
      const wakeLen = (150 + layer * 65) * scale;
      for (let b = 0; b < 3; b++) {
        const bladeAngle = angle + (b * Math.PI * 2) / 3;
        const tipX = x + Math.sin(bladeAngle) * (bladeLen * 0.18);
        const tipY = hubY - Math.cos(bladeAngle) * bladeLen;

        const vortexPath = new Path2D();
        vortexPath.moveTo(tipX, tipY);
        for (let wx = 8; wx <= wakeLen; wx += 10) {
          const decay = wx / wakeLen;
          const swirl = Math.sin(wx * 0.065 - angle * 2.5 + b * 2.1) * (10 * scale * (1 - decay * 0.5));
          vortexPath.lineTo(tipX - wx, tipY + swirl);
        }
        ctx.strokeStyle = strokeCol('faint', alphaByLayer * 0.42);
        ctx.lineWidth = Math.max(0.65, 1.1 * scale);
        ctx.stroke(vortexPath);
      }
    }

    // 模式 C【工程藍圖結構】：繪製風車葉片掃掠面積虛線圓與工程標註
    if (cyclistStyle === 'blueprint') {
      const sweptCircle = new Path2D();
      sweptCircle.arc(x, hubY, bladeLen, 0, Math.PI * 2);
      ctx.strokeStyle = strokeCol('accent', alphaByLayer * 0.48);
      ctx.lineWidth = 0.85;
      ctx.setLineDash([5, 4]);
      ctx.stroke(sweptCircle);

      const axisLines = new Path2D();
      axisLines.moveTo(x - bladeLen * 1.12, hubY);
      axisLines.lineTo(x + bladeLen * 1.12, hubY);
      axisLines.moveTo(x, hubY - bladeLen * 1.12);
      axisLines.lineTo(x, baseY);
      ctx.setLineDash([8, 3, 2, 3]);
      ctx.strokeStyle = strokeCol('faint', alphaByLayer * 0.45);
      ctx.stroke(axisLines);
      ctx.setLineDash([]);

      if (layer >= 1) {
        ctx.font = `500 ${Math.max(13, Math.round(13 * scale))}px "JetBrains Mono", monospace`;
        ctx.fillStyle = strokeCol('accent', alphaByLayer * 0.9);
        const rotorDia = Math.round(126 * scale);
        const rpmVal = (12.5 + currentSpeed * 0.08).toFixed(1);
        ctx.fillText(`Ø ${rotorDia}m`, x + bladeLen * 0.72, hubY - bladeLen * 0.72);
        ctx.fillText(`${rpmVal} RPM`, x + 10 * scale, hubY + 14 * scale);
      }
    }

    // 1. 錐形塔柱 (Tapered Tower)
    const bW = 6.5 * scale;
    const tW = 2.4 * scale;
    const towerPath = new Path2D();
    towerPath.moveTo(x - bW, baseY);
    towerPath.lineTo(x - tW, hubY);
    towerPath.lineTo(x + tW, hubY);
    towerPath.lineTo(x + bW, baseY);
    towerPath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol(layer === 0 ? 'faint' : 'sub', alphaByLayer);
    ctx.lineWidth = lineW;
    ctx.fill(towerPath);

    // 模式 B【版畫排線插畫】：於風車塔柱背光側繪製版畫橫向陰影刻線
    if (cyclistStyle === 'hatched') {
      ctx.save();
      ctx.clip(towerPath);
      const towerTicks = new Path2D();
      const stepY = Math.max(3.2, 5.2 * scale);
      for (let ty = hubY + 4; ty < baseY; ty += stepY) {
        towerTicks.moveTo(x - bW - 2, ty);
        towerTicks.lineTo(x + bW * 0.18, ty - 2.5 * scale);
      }
      ctx.strokeStyle = strokeCol('sub', alphaByLayer * 0.65);
      ctx.lineWidth = Math.max(0.65, 0.9 * scale);
      ctx.stroke(towerTicks);
      ctx.restore();
    }

    ctx.stroke(towerPath);

    // 2. 三片旋轉風機葉片
    for (let i = 0; i < 3; i++) {
      const a = angle + (i * Math.PI * 2) / 3;
      ctx.save();
      ctx.translate(x, hubY);
      ctx.rotate(a);

      const bladePath = new Path2D();
      bladePath.moveTo(0, -3 * scale);
      bladePath.bezierCurveTo(
        4.2 * scale, -bladeLen * 0.28,
        3.0 * scale, -bladeLen * 0.75,
        0.4 * scale, -bladeLen
      );
      bladePath.bezierCurveTo(
        -1.8 * scale, -bladeLen * 0.75,
        -2.2 * scale, -bladeLen * 0.25,
        0, -3 * scale
      );
      bladePath.closePath();

      ctx.fillStyle = getBgColor();
      ctx.fill(bladePath);

      if (cyclistStyle === 'hatched' && layer >= 1) {
        ctx.save();
        ctx.clip(bladePath);
        const bladeTicks = new Path2D();
        for (let by = -8 * scale; by > -bladeLen * 0.85; by -= 4.5 * scale) {
          bladeTicks.moveTo(-2 * scale, by);
          bladeTicks.lineTo(1.5 * scale, by - 2 * scale);
        }
        ctx.strokeStyle = strokeCol('sub', alphaByLayer * 0.55);
        ctx.lineWidth = 0.75;
        ctx.stroke(bladeTicks);
        ctx.restore();
      }

      ctx.strokeStyle = strokeCol(layer === 0 ? 'faint' : 'sub', alphaByLayer);
      ctx.lineWidth = lineW;
      ctx.stroke(bladePath);
      ctx.restore();
    }

    // 3. 輪轂中心與夜間機艙警示燈
    const hubPath = new Path2D();
    hubPath.arc(x, hubY, 4.2 * scale, 0, Math.PI * 2);
    ctx.fillStyle = getBgColor();
    ctx.fill(hubPath);
    ctx.stroke(hubPath);

    if (currentPalette.nightFactor > 0.2 || currentPalette.duskFactor > 0.35) {
      const beaconPulse = 0.5 + 0.5 * Math.sin(angle * 3.0 + layer);
      const beaconRing = new Path2D();
      beaconRing.arc(x, hubY - 5 * scale, (3.5 + beaconPulse * 4.5) * scale, 0, Math.PI * 2);
      ctx.strokeStyle = strokeCol('accent', Math.max(currentPalette.nightFactor, currentPalette.duskFactor) * beaconPulse * 0.75);
      ctx.lineWidth = 1.0;
      ctx.stroke(beaconRing);
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 2C. 海邊專屬景觀系統：離岸與海岬風力發電、海浪波光、燈塔、遠洋貨輪與帆船
   * ============================================================================
   */
  function drawCoastAndOffshoreScene(w, roadY, time) {
    const seaHorizonY = roadY - 118;
    const nightStrength = Math.max(currentPalette.nightFactor, currentPalette.duskFactor * 0.75);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 遠方海平線與海面波光倒影 (Ocean Horizon & Sun/Moon Water Shimmer)
    const seaFill = new Path2D();
    seaFill.rect(0, seaHorizonY, w, roadY - seaHorizonY);
    ctx.fillStyle = getBgColor();
    ctx.fill(seaFill);

    const horizonLine = new Path2D();
    horizonLine.moveTo(0, seaHorizonY);
    horizonLine.lineTo(w, seaHorizonY);
    ctx.strokeStyle = strokeCol('sub', 0.62);
    ctx.lineWidth = 1.15;
    ctx.stroke(horizonLine);

    // 動態海浪紋理層 (Multi-layer Swell & Wave Contours)
    const waveBands = cyclistStyle === 'ribbon' ? 9 : 6;
    for (let r = 0; r < waveBands; r++) {
      const wy = seaHorizonY + 12 + Math.pow(r / waveBands, 1.25) * (roadY - seaHorizonY - 18);
      const wavePath = new Path2D();
      const speedScroll = ridgeOffsets[1] * (0.4 + r * 0.22);
      const stepX = cyclistStyle === 'ribbon' ? 18 : 42;

      for (let x = 0; x <= w + stepX; x += stepX) {
        const swell = Math.sin((x + speedScroll) * 0.025 + r * 1.4 + time * 0.002) * (1.5 + r * 0.65);
        if (cyclistStyle === 'ribbon') {
          if (x === 0) wavePath.moveTo(x, wy + swell);
          else wavePath.lineTo(x, wy + swell);
        } else {
          // 極簡插畫海浪短弧線
          if (((Math.floor((x + speedScroll) / stepX) + r) % 3) === 0) {
            wavePath.moveTo(x - 12, wy + swell);
            wavePath.quadraticCurveTo(x, wy - 2.5 - r * 0.3, x + 12, wy + swell);
          }
        }
      }
      ctx.strokeStyle = strokeCol(r > 3 ? 'sub' : 'faint', 0.25 + (r / waveBands) * 0.35);
      ctx.lineWidth = 0.8 + (r / waveBands) * 0.5;
      ctx.stroke(wavePath);
    }

    // 2. 遠景離岸風力發電機群 (Offshore Wind Farm on Horizon)
    turbines.filter(t => t.layer === 0).forEach(t => {
      const span = w * 1.25;
      const x = ((t.xRatio * span - ridgeOffsets[0] * 0.9) % span + span) % span - w * 0.12;
      drawWindTurbine(x, seaHorizonY + 4, t.scale * 1.08, t.angle, 0);
    });

    // 3. 海平線遠洋貨櫃船與中景競速帆船 (Cargo Ships & Racing Sailboats)
    const shipSpan = w + 380;
    coastalVessels.forEach((v, idx) => {
      const vx = ((v.offset - ridgeOffsets[v.layer] * 0.35) % shipSpan + shipSpan) % shipSpan - 190;
      const vy = v.layer === 0 ? seaHorizonY + 3 : seaHorizonY + 44 + (idx % 2) * 22;
      const s = v.scale;
      const bob = Math.sin(time * 0.0025 + idx * 1.7) * 1.4;

      ctx.save();
      ctx.translate(vx, vy + bob);
      ctx.scale(s, s);

      if (v.type === 'cargo') {
        // 遠洋貨櫃輪 (Container Cargo Vessel)
        const hullPath = new Path2D();
        hullPath.moveTo(-48, 0);
        hullPath.lineTo(-52, -10);
        hullPath.lineTo(46, -10);
        hullPath.lineTo(54, -14);
        hullPath.lineTo(48, 0);
        hullPath.closePath();

        // 艦橋與貨櫃堆疊
        hullPath.rect(-36, -19, 22, 9);
        hullPath.rect(-10, -21, 24, 11);
        hullPath.rect(20, -26, 14, 16);
        hullPath.moveTo(27, -26);
        hullPath.lineTo(27, -34);

        ctx.fillStyle = getBgColor();
        ctx.fill(hullPath);
        if (cyclistStyle === 'hatched') {
          drawHatchingInPath(hullPath, -54, 56, -28, 2, 3.8, 0.45);
        }
        ctx.strokeStyle = strokeCol('sub', 0.72);
        ctx.lineWidth = 1.2;
        ctx.stroke(hullPath);

        if (cyclistStyle === 'blueprint') {
          ctx.font = '500 13px "JetBrains Mono", monospace';
          ctx.fillStyle = strokeCol('accent', 0.85);
          ctx.fillText('VESSEL 14.2 KT', -28, -38);
        }
      } else {
        // 破風雙帆遊艇 (Coastal Racing Yacht)
        const hull = new Path2D();
        hull.moveTo(-20, 0);
        hull.lineTo(22, 0);
        hull.lineTo(27, -6);
        hull.lineTo(-23, -5);
        hull.closePath();

        const mainSail = new Path2D();
        mainSail.moveTo(2, -7);
        mainSail.lineTo(2, -52);
        mainSail.quadraticCurveTo(-12, -28, -18, -7);
        mainSail.closePath();

        const jibSail = new Path2D();
        jibSail.moveTo(5, -7);
        jibSail.lineTo(2, -48);
        jibSail.quadraticCurveTo(16, -26, 24, -7);
        jibSail.closePath();

        ctx.fillStyle = getBgColor();
        ctx.fill(hull);
        ctx.fill(mainSail);
        ctx.fill(jibSail);

        if (cyclistStyle === 'hatched') {
          drawHatchingInPath(mainSail, -20, 4, -54, -6, 3.8, 0.42);
        }

        ctx.strokeStyle = strokeCol('ink', 0.86);
        ctx.lineWidth = 1.35;
        ctx.stroke(hull);
        ctx.stroke(mainSail);
        ctx.stroke(jibSail);
      }
      ctx.restore();
    });

    // 4. 海岬岩岸地形與經典海岸燈塔 (Coastal Cape & Lighthouse with Rotating Night Beam)
    const capeSpan = w * 1.35;
    const capeX = ((w * 0.78 - ridgeOffsets[1] * 0.85) % capeSpan + capeSpan) % capeSpan - w * 0.18;
    const capeBaseY = seaHorizonY + 34;

    const capePath = new Path2D();
    capePath.moveTo(capeX - 180, capeBaseY);
    capePath.bezierCurveTo(capeX - 110, capeBaseY - 28, capeX - 45, capeBaseY - 34, capeX + 18, capeBaseY - 26);
    capePath.quadraticCurveTo(capeX + 55, capeBaseY - 20, capeX + 72, capeBaseY);
    capePath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.fill(capePath);
    if (cyclistStyle === 'hatched') {
      drawHatchingInPath(capePath, capeX - 180, capeX + 75, capeBaseY - 38, capeBaseY + 2, 4.5, 0.45);
    }
    ctx.strokeStyle = strokeCol('sub', 0.78);
    ctx.lineWidth = 1.4;
    ctx.stroke(capePath);

    // 繪製海岬燈塔
    const lhX = capeX + 12;
    const lhBaseY = capeBaseY - 24;
    const lhTopY = lhBaseY - 86;

    const lhTower = new Path2D();
    lhTower.moveTo(lhX - 9, lhBaseY);
    lhTower.lineTo(lhX - 5.5, lhTopY);
    lhTower.lineTo(lhX + 5.5, lhTopY);
    lhTower.lineTo(lhX + 9, lhBaseY);
    lhTower.closePath();

    // 燈室與圓頂
    lhTower.rect(lhX - 7.5, lhTopY - 3, 15, 3);
    lhTower.rect(lhX - 5, lhTopY - 13, 10, 10);
    lhTower.moveTo(lhX + 6, lhTopY - 13);
    lhTower.arc(lhX, lhTopY - 13, 6, 0, Math.PI, true);

    ctx.fillStyle = getBgColor();
    ctx.fill(lhTower);
    if (cyclistStyle === 'hatched') {
      drawHatchingInPath(lhTower, lhX - 10, lhX, lhTopY - 18, lhBaseY, 3.8, 0.52);
    }
    ctx.strokeStyle = strokeCol('ink', 0.9);
    ctx.lineWidth = 1.45;
    ctx.stroke(lhTower);

    // 燈塔夜間與黃昏雙向旋轉探照光束 (Rotating Lighthouse Searchlight Beam)
    if (nightStrength > 0.15) {
      const beamSweep = Math.sin(time * 0.0018);
      const beamLen = 280 * Math.abs(beamSweep);
      const lanternY = lhTopY - 8;

      const lhBeam = new Path2D();
      lhBeam.moveTo(lhX, lanternY);
      lhBeam.lineTo(lhX + beamLen, lanternY - 26);
      lhBeam.lineTo(lhX + beamLen, lanternY + 14);
      lhBeam.closePath();

      lhBeam.moveTo(lhX, lanternY);
      lhBeam.lineTo(lhX - beamLen * 0.85, lanternY - 20);
      lhBeam.lineTo(lhX - beamLen * 0.85, lanternY + 10);
      lhBeam.closePath();

      ctx.strokeStyle = strokeCol('accent', nightStrength * 0.45);
      ctx.lineWidth = 0.9;
      ctx.setLineDash(cyclistStyle === 'blueprint' ? [4, 4] : []);
      ctx.stroke(lhBeam);
      ctx.setLineDash([]);
    }

    // 5. 精簡配置濱海大型風力發電機 (Coastal Wind Turbine)
    turbines.filter(t => t.layer === 1).forEach(t => {
      const span = w * 1.35;
      const x = ((t.xRatio * span - ridgeOffsets[1] * 1.15) % span + span) % span - w * 0.15;
      drawWindTurbine(x, seaHorizonY + 42, t.scale, t.angle, 1);
    });

    // 6. 濱海堤防欄杆與海鷗群 (Coastal Seawall Bollards & Seagulls)
    const railPath = new Path2D();
    railPath.moveTo(0, roadY - 12);
    railPath.lineTo(w, roadY - 12);
    const postGap = 64;
    const postShift = (ridgeOffsets[2] * 1.6) % postGap;
    for (let px = -postShift; px < w + postGap; px += postGap) {
      railPath.moveTo(px, roadY);
      railPath.lineTo(px, roadY - 15);
    }
    ctx.strokeStyle = strokeCol('sub', 0.55);
    ctx.lineWidth = 1.15;
    ctx.stroke(railPath);

    for (let g = 0; g < 4; g++) {
      const gx = ((g * 330 + time * 0.022 - ridgeOffsets[0] * 0.6) % (w + 140) + (w + 140)) % (w + 140) - 70;
      const gy = roadY * 0.24 + Math.sin(time * 0.0025 + g * 1.9) * 12 + (g % 2) * 24;
      const wing = Math.sin(time * 0.007 + g * 1.4) * 4.0;
      const gull = new Path2D();
      gull.moveTo(gx - 10, gy - wing);
      gull.quadraticCurveTo(gx - 4, gy - 4, gx, gy);
      gull.quadraticCurveTo(gx + 4, gy - 4, gx + 10, gy - wing);
      ctx.strokeStyle = strokeCol('sub', 0.62);
      ctx.lineWidth = 1.15;
      ctx.stroke(gull);
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 1. 多層次疊合山巒稜線與山脊支脈線 (依畫風切換：A塊面遮罩 / B銅版畫坡面排線 / C三角網格高程藍圖 / D等高線流體絲帶)
   * ============================================================================
   */
  function getRidgeElevation(worldX, layerIndex) {
    if (layerIndex === -1) {
      // 極遠高山層：壯闊連綿的遠方主峰群
      const p1 = Math.sin(worldX * 0.0013 + 1.4) * 82;
      const p2 = Math.cos(worldX * 0.0031 - 0.6) * 42;
      const p3 = Math.sin(worldX * 0.0068) * 18;
      return p1 + p2 + p3 - Math.abs(Math.cos(worldX * 0.0021)) * 28;
    } else if (layerIndex === 0) {
      // 遠山：高聳連綿的山形
      const p1 = Math.sin(worldX * 0.0018) * 68;
      const p2 = Math.cos(worldX * 0.0041 + 0.8) * 34;
      const p3 = Math.sin(worldX * 0.0085) * 14;
      return p1 + p2 + p3 - Math.abs(Math.sin(worldX * 0.0029)) * 22;
    } else if (layerIndex === 1) {
      // 中山：中景山巒與稜線
      const p1 = Math.sin(worldX * 0.0026 + 2.1) * 44;
      const p2 = Math.cos(worldX * 0.0063) * 20;
      const p3 = Math.sin(worldX * 0.012) * 8;
      return p1 + p2 + p3;
    } else {
      // 近景丘陵：平緩起伏的近山稜線
      const p1 = Math.sin(worldX * 0.0038 + 4.2) * 24;
      const p2 = Math.cos(worldX * 0.0092) * 11;
      return p1 + p2;
    }
  }

  function drawMountainLayer(w, roadY, baseHeightOffset, layerIndex, scrollOffset) {
    const baseY = roadY - baseHeightOffset;
    const step = cyclistStyle === 'blueprint' ? 38 : 10;
    const idx = Math.max(0, layerIndex);
    const alphaMap = layerIndex === -1 ? 0.26 : [0.40, 0.60, 0.80][idx];
    const widthMap = layerIndex === -1 ? 0.85 : [1.05, 1.35, 1.65][idx];

    ctx.save();

    // 模式 D【流體風洞動線】：山稜轉化為平行流動的等高線流體絲帶
    if (cyclistStyle === 'ribbon') {
      const strandCount = layerIndex <= 0 ? 6 : layerIndex === 1 ? 5 : 4;
      const strandGap = layerIndex <= 0 ? 11 : layerIndex === 1 ? 9 : 7;

      for (let s = 0; s < strandCount; s++) {
        const ribbonPath = new Path2D();
        const phaseShift = s * 0.35;
        for (let x = 0; x <= w + 12; x += 12) {
          const wx = x + scrollOffset;
          const elev = getRidgeElevation(wx + s * 18, layerIndex);
          const harmonic = Math.sin(wx * 0.006 + phaseShift) * (s * 2.2);
          const py = Math.min(roadY, baseY + elev + s * strandGap + harmonic);
          if (x === 0) ribbonPath.moveTo(x, py);
          else ribbonPath.lineTo(x, py);
        }
        const strandAlpha = alphaMap * (1 - s / (strandCount + 1));
        ctx.strokeStyle = strokeCol(s === 0 ? 'sub' : 'faint', strandAlpha);
        ctx.lineWidth = s === 0 ? widthMap : 0.85;
        ctx.stroke(ribbonPath);
      }
      ctx.restore();
      return;
    }

    // 計算山稜頂點座標與遮罩路徑 (模式 A / B / C 共用基底)
    const fillPath = new Path2D();
    const contourPath = new Path2D();
    fillPath.moveTo(0, roadY + 10);

    const points = [];
    for (let x = 0; x <= w + step; x += step) {
      const wx = x + scrollOffset;
      const y = baseY + getRidgeElevation(wx, layerIndex);
      points.push({ x, y, wx });
      fillPath.lineTo(x, y);
      if (x === 0) contourPath.moveTo(x, y);
      else contourPath.lineTo(x, y);
    }

    fillPath.lineTo(w + step, roadY + 10);
    fillPath.closePath();

    // 背景色遮罩填色：乾淨遮擋後方山層
    ctx.fillStyle = getBgColor();
    ctx.fill(fillPath);

    // 模式 B【版畫排線插畫】：在山脈背光斜坡與稜線下方以獨立 Path2D 裁切繪製歐系銅版畫斜線
    if (cyclistStyle === 'hatched') {
      ctx.save();
      ctx.clip(fillPath);

      const slopeHatchPath = new Path2D();
      const hatchSpacing = layerIndex <= 0 ? 7.5 : layerIndex === 1 ? 6.0 : 5.0;

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const slope = (p2.y - p1.y) / (p2.x - p1.x || 1);

        const isShadowSlope = slope > -0.04;
        const hatchDepth = isShadowSlope
          ? (layerIndex <= 0 ? 88 : layerIndex === 1 ? 64 : 36) + slope * 95
          : (layerIndex <= 0 ? 22 : 15);

        for (let hx = p1.x; hx < p2.x; hx += hatchSpacing) {
          const t = (hx - p1.x) / (p2.x - p1.x || 1);
          const topY = p1.y + (p2.y - p1.y) * t;
          const botY = Math.min(roadY, topY + hatchDepth);
          const slantX = isShadowSlope ? -(botY - topY) * 0.55 : (botY - topY) * 0.3;
          slopeHatchPath.moveTo(hx, topY);
          slopeHatchPath.lineTo(hx + slantX, botY);
        }

        if (isShadowSlope && slope > 0.08) {
          const crossDepth = Math.min(35, hatchDepth * 0.45);
          for (let hx = p1.x; hx < p2.x; hx += hatchSpacing * 1.4) {
            const t = (hx - p1.x) / (p2.x - p1.x || 1);
            const topY = p1.y + (p2.y - p1.y) * t;
            const botY = Math.min(roadY, topY + crossDepth);
            slopeHatchPath.moveTo(hx, topY + 2);
            slopeHatchPath.lineTo(hx + (botY - topY) * 0.45, botY);
          }
        }
      }

      ctx.strokeStyle = strokeCol(layerIndex <= 0 ? 'faint' : 'sub', alphaMap * 0.62);
      ctx.lineWidth = layerIndex <= 0 ? 0.75 : 0.9;
      ctx.stroke(slopeHatchPath);
      ctx.restore();
    }

    // 模式 C【工程藍圖結構】：繪製多邊形三角網格與山峰高程標註
    if (cyclistStyle === 'blueprint') {
      const meshPath = new Path2D();
      const nodeDots = new Path2D();
      const dropH = layerIndex <= 0 ? 62 : layerIndex === 1 ? 45 : 26;

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const lowY1 = Math.min(roadY, p1.y + dropH + ((i % 2) * 14));
        const lowY2 = Math.min(roadY, p2.y + dropH + (((i + 1) % 2) * 14));

        meshPath.moveTo(p1.x, p1.y);
        meshPath.lineTo(p1.x, lowY1);
        meshPath.lineTo(p2.x, lowY2);
        meshPath.lineTo(p1.x, p1.y);
        meshPath.moveTo(p2.x, p2.y);
        meshPath.lineTo(p1.x, lowY1);

        nodeDots.moveTo(p1.x + 2, p1.y);
        nodeDots.arc(p1.x, p1.y, 2, 0, Math.PI * 2);

        if (i > 0 && i < points.length - 2 && layerIndex >= 0) {
          const prev = points[i - 1];
          if (p1.y < prev.y && p1.y <= p2.y && Math.floor(p1.wx / 220) !== Math.floor(prev.wx / 220)) {
            const elevMeters = Math.round(780 - layerIndex * 210 - (p1.y - baseY) * 2.4);
            const slopePct = Math.abs(((p2.y - p1.y) / step) * 18).toFixed(1);
            ctx.font = '500 13px "JetBrains Mono", monospace';
            ctx.fillStyle = strokeCol('accent', alphaMap * 1.15);
            ctx.fillText(`▲ EL.${elevMeters}m (${slopePct}%)`, p1.x - 28, p1.y - 8);
          }
        }
      }

      ctx.strokeStyle = strokeCol('faint', alphaMap * 0.52);
      ctx.lineWidth = 0.75;
      ctx.stroke(meshPath);

      ctx.fillStyle = strokeCol('accent', alphaMap * 0.85);
      ctx.fill(nodeDots);
    }

    // 描繪主山稜線
    ctx.strokeStyle = strokeCol(layerIndex <= 0 ? 'faint' : 'sub', alphaMap);
    ctx.lineWidth = widthMap;
    ctx.lineJoin = cyclistStyle === 'blueprint' ? 'miter' : 'round';
    ctx.stroke(contourPath);

    // 模式 A 與 模式 B：描繪山峰向下延伸的山脊支脈線與次級等高線
    if (cyclistStyle === 'sculpted' || cyclistStyle === 'hatched') {
      const spurPath = new Path2D();
      for (let i = 2; i < points.length - 2; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];

        const isLocalPeak = curr.y < prev.y && curr.y <= next.y;
        const isSpurPoint = Math.floor(curr.wx / 85) !== Math.floor(prev.wx / 85);

        if (isLocalPeak || (layerIndex < 2 && isSpurPoint)) {
          const spurLen = layerIndex <= 0 ? 54 : layerIndex === 1 ? 36 : 20;
          const slopeDir = (next.y - prev.y) > 0 ? -1 : 1;
          spurPath.moveTo(curr.x, curr.y);
          spurPath.quadraticCurveTo(
            curr.x + slopeDir * (spurLen * 0.45),
            curr.y + spurLen * 0.55,
            curr.x + slopeDir * (spurLen * 0.9),
            Math.min(roadY, curr.y + spurLen)
          );
        }
      }
      ctx.strokeStyle = strokeCol('faint', alphaMap * 0.58);
      ctx.lineWidth = 0.85;
      ctx.stroke(spurPath);

      if (layerIndex <= 1) {
        const echoPath = new Path2D();
        points.forEach((pt, idxPt) => {
          const echoY = Math.min(roadY, pt.y + 10 + Math.sin(pt.wx * 0.008) * 4);
          if (idxPt === 0) echoPath.moveTo(pt.x, echoY);
          else echoPath.lineTo(pt.x, echoY);
        });
        ctx.strokeStyle = strokeCol('faint', alphaMap * 0.34);
        ctx.lineWidth = 0.7;
        ctx.stroke(echoPath);
      }
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 3. 生物力學逆向運動學 (IK) 與獨立 Path2D 版畫排線工具 (無外溢 Bug)
   * ============================================================================
   */
  function solveTwoBoneIK(hx, hy, ax, ay, L1, L2) {
    const dx = ax - hx;
    const dy = ay - hy;
    const dist = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.01);
    const baseAngle = Math.atan2(dy, dx);
    const cosKnee = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const angleOffset = Math.acos(Math.max(-1, Math.min(1, cosKnee)));
    const thighAngle = baseAngle - angleOffset;
    return {
      x: hx + Math.cos(thighAngle) * L1,
      y: hy + Math.sin(thighAngle) * L1,
      thighAngle
    };
  }

  function mapLimbPoint(p1x, p1y, p2x, p2y, u, v) {
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = uy;
    const ny = -ux;
    return {
      x: p1x + dx * u + nx * v,
      y: p1y + dy * u + ny * v
    };
  }

  /**
   * 關鍵修復：使用獨立封閉的 Path2D 進行 `ctx.clip(clipPath)` (預設 nonzero 規則)，
   * 並且排線使用獨立的 `hatchLines` Path2D 繪製在局部邊界 `[minX, maxX, minY, maxY]` 內，
   * 絕不汙染外部形狀的描邊路徑，100% 杜絕斜線方塊外溢。
   */
  function drawHatchingInPath(clipPath, minX, maxX, minY, maxY, spacing = 4.0, alpha = 0.45) {
    ctx.save();
    ctx.clip(clipPath); // 嚴格限制在封閉的 Path2D 內部

    const hatchLines = new Path2D();
    const height = maxY - minY;
    // 45 度平行斜線 (x + y = const)
    for (let startX = minX - height - 10; startX <= maxX + 10; startX += spacing) {
      hatchLines.moveTo(startX, maxY + 4);
      hatchLines.lineTo(startX + height + 8, minY - 4);
    }

    ctx.strokeStyle = strokeCol('sub', alpha);
    ctx.lineWidth = 0.85;
    ctx.stroke(hatchLines);
    ctx.restore();
  }

  /**
   * 繪製解剖學大腿塊面 (Anatomical Thigh Volume)
   */
  function drawAnatomicalThigh(hx, hy, kx, ky, isFarLeg, styleMode) {
    const pHipTop = mapLimbPoint(hx, hy, kx, ky, -0.06, 13.5);
    const pHipBack = mapLimbPoint(hx, hy, kx, ky, -0.08, -11.5);
    const pQuadPeak = mapLimbPoint(hx, hy, kx, ky, 0.48, 15.0);
    const pKneeFront = mapLimbPoint(hx, hy, kx, ky, 1.03, 6.2);
    const pKneeCap = mapLimbPoint(hx, hy, kx, ky, 1.07, 1.0);
    const pKneeBack = mapLimbPoint(hx, hy, kx, ky, 0.98, -5.2);
    const pHamMid = mapLimbPoint(hx, hy, kx, ky, 0.45, -10.5);

    // 建立獨立封閉的大腿 Path2D
    const thighPath = new Path2D();
    thighPath.moveTo(pHipBack.x, pHipBack.y);
    thighPath.bezierCurveTo(hx - 14, hy - 6, hx - 6, hy - 15, pHipTop.x, pHipTop.y);
    thighPath.bezierCurveTo(
      pQuadPeak.x, pQuadPeak.y,
      (pQuadPeak.x + pKneeFront.x) * 0.5, (pQuadPeak.y + pKneeFront.y) * 0.5,
      pKneeFront.x, pKneeFront.y
    );
    thighPath.quadraticCurveTo(pKneeCap.x, pKneeCap.y, pKneeBack.x, pKneeBack.y);
    thighPath.bezierCurveTo(
      pHamMid.x, pHamMid.y,
      (pHamMid.x + pHipBack.x) * 0.5, (pHamMid.y + pHipBack.y) * 0.5,
      pHipBack.x, pHipBack.y
    );
    thighPath.closePath();

    // 1. 背景色填滿遮擋後方結構
    ctx.fillStyle = getBgColor();
    ctx.fill(thighPath);

    // 2. 模式 B：在獨立的 Path2D 內繪製 45 度版畫排線
    if (styleMode === 'hatched') {
      const minX = Math.min(hx, kx) - 24;
      const maxX = Math.max(hx, kx) + 24;
      const minY = Math.min(hy, ky) - 24;
      const maxY = Math.max(hy, ky) + 24;

      if (isFarLeg) {
        drawHatchingInPath(thighPath, minX, maxX, minY, maxY, 3.8, 0.50);
      } else {
        // 近側腿：僅在下半部膕繩肌暗面區排線
        const shadowClip = new Path2D();
        shadowClip.moveTo(hx, hy);
        shadowClip.lineTo(kx, ky);
        shadowClip.lineTo(pKneeBack.x, pKneeBack.y);
        shadowClip.bezierCurveTo(
          pHamMid.x, pHamMid.y,
          (pHamMid.x + pHipBack.x) * 0.5, (pHamMid.y + pHipBack.y) * 0.5,
          pHipBack.x, pHipBack.y
        );
        shadowClip.closePath();
        drawHatchingInPath(shadowClip, minX, maxX, minY, maxY, 4.2, 0.38);
      }
    }

    // 3. 描繪大腿外輪廓線 (直接對 thighPath 描邊，不依賴全域 default path)
    ctx.strokeStyle = strokeCol(isFarLeg ? 'sub' : 'ink', isFarLeg ? 0.65 : 0.98);
    ctx.lineWidth = isFarLeg ? 1.5 : 2.0;
    ctx.stroke(thighPath);

    // 4. 車褲褲管束口線與股內側肌線條
    if (!isFarLeg) {
      const hemTop = mapLimbPoint(hx, hy, kx, ky, 0.74, 10.2);
      const hemBot = mapLimbPoint(hx, hy, kx, ky, 0.72, -6.8);
      const hemPath = new Path2D();
      hemPath.moveTo(hemTop.x, hemTop.y);
      hemPath.quadraticCurveTo((hemTop.x + hemBot.x) * 0.5 + 2, (hemTop.y + hemBot.y) * 0.5, hemBot.x, hemBot.y);
      ctx.strokeStyle = strokeCol('sub', 0.75);
      ctx.lineWidth = 1.3;
      ctx.stroke(hemPath);

      const vmStart = mapLimbPoint(hx, hy, kx, ky, 0.55, 3.5);
      const vmEnd = mapLimbPoint(hx, hy, kx, ky, 0.88, 1.5);
      const vmPath = new Path2D();
      vmPath.moveTo(vmStart.x, vmStart.y);
      vmPath.quadraticCurveTo((vmStart.x + vmEnd.x) * 0.5, (vmStart.y + vmEnd.y) * 0.5 + 3, vmEnd.x, vmEnd.y);
      ctx.strokeStyle = strokeCol('faint', 0.6);
      ctx.lineWidth = 1.0;
      ctx.stroke(vmPath);
    }
  }

  /**
   * 繪製解剖學小腿塊面 (Anatomical Calf & Gastrocnemius Volume)
   */
  function drawAnatomicalCalf(kx, ky, ax, ay, isFarLeg, styleMode) {
    const pKneeFront = mapLimbPoint(kx, ky, ax, ay, 0.0, 5.5);
    const pKneeBack = mapLimbPoint(kx, ky, ax, ay, 0.0, -4.8);
    const pShinMid = mapLimbPoint(kx, ky, ax, ay, 0.52, 4.5);
    const pAnkleFront = mapLimbPoint(kx, ky, ax, ay, 0.98, 3.4);
    const pAnkleBack = mapLimbPoint(kx, ky, ax, ay, 0.98, -3.2);
    const pCalfBulge = mapLimbPoint(kx, ky, ax, ay, 0.34, -12.5);
    const pAchilles = mapLimbPoint(kx, ky, ax, ay, 0.74, -4.0);

    const calfPath = new Path2D();
    calfPath.moveTo(pKneeFront.x, pKneeFront.y);
    calfPath.quadraticCurveTo(pShinMid.x, pShinMid.y, pAnkleFront.x, pAnkleFront.y);
    calfPath.lineTo(pAnkleBack.x, pAnkleBack.y);
    calfPath.bezierCurveTo(pAchilles.x, pAchilles.y, pCalfBulge.x, pCalfBulge.y, pKneeBack.x, pKneeBack.y);
    calfPath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.fill(calfPath);

    if (styleMode === 'hatched') {
      const minX = Math.min(kx, ax) - 22;
      const maxX = Math.max(kx, ax) + 22;
      const minY = Math.min(ky, ay) - 22;
      const maxY = Math.max(ky, ay) + 22;

      if (isFarLeg) {
        drawHatchingInPath(calfPath, minX, maxX, minY, maxY, 3.8, 0.50);
      } else {
        const calfShadow = new Path2D();
        calfShadow.moveTo(kx, ky);
        calfShadow.lineTo(ax, ay);
        calfShadow.lineTo(pAnkleBack.x, pAnkleBack.y);
        calfShadow.bezierCurveTo(pAchilles.x, pAchilles.y, pCalfBulge.x, pCalfBulge.y, pKneeBack.x, pKneeBack.y);
        calfShadow.closePath();
        drawHatchingInPath(calfShadow, minX, maxX, minY, maxY, 4.2, 0.38);
      }
    }

    ctx.strokeStyle = strokeCol(isFarLeg ? 'sub' : 'ink', isFarLeg ? 0.65 : 0.98);
    ctx.lineWidth = isFarLeg ? 1.5 : 1.9;
    ctx.stroke(calfPath);

    // 單車襪束口線
    const sockF = mapLimbPoint(kx, ky, ax, ay, 0.66, 3.9);
    const sockB = mapLimbPoint(kx, ky, ax, ay, 0.66, -4.8);
    const sockPath = new Path2D();
    sockPath.moveTo(sockF.x, sockF.y);
    sockPath.lineTo(sockB.x, sockB.y);
    ctx.strokeStyle = strokeCol('sub', isFarLeg ? 0.45 : 0.75);
    ctx.lineWidth = 1.2;
    ctx.stroke(sockPath);

    // 腓腸肌肌理線
    if (!isFarLeg) {
      const gStart = mapLimbPoint(kx, ky, ax, ay, 0.22, -2.0);
      const gEnd = mapLimbPoint(kx, ky, ax, ay, 0.54, -4.5);
      const gPath = new Path2D();
      gPath.moveTo(gStart.x, gStart.y);
      gPath.quadraticCurveTo((gStart.x + gEnd.x) * 0.5 - 3, (gStart.y + gEnd.y) * 0.5 + 2, gEnd.x, gEnd.y);
      ctx.strokeStyle = strokeCol('faint', 0.55);
      ctx.lineWidth = 0.95;
      ctx.stroke(gPath);
    }
  }

  /**
   * 繪製立體公路車卡鞋與卡踏 (Sculpted Cycling Shoe & Clipless Pedal)
   */
  function drawCyclingShoe(pedalX, pedalY, footAngle, isFarLeg, styleMode) {
    ctx.save();
    ctx.translate(pedalX, pedalY);
    ctx.rotate(footAngle);

    const shoePath = new Path2D();
    shoePath.moveTo(-17, 1);
    shoePath.bezierCurveTo(-19, -4, -17, -10, -14, -12);
    shoePath.quadraticCurveTo(-9, -9, -5, -10);
    shoePath.bezierCurveTo(3, -8, 12, -4, 15, -0.5);
    shoePath.quadraticCurveTo(15, 2.5, 9, 2.5);
    shoePath.lineTo(-4, 2.2);
    shoePath.quadraticCurveTo(-10, 0.8, -17, 1);
    shoePath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.fill(shoePath);

    if (styleMode === 'hatched' && isFarLeg) {
      drawHatchingInPath(shoePath, -22, 18, -15, 5, 3.5, 0.45);
    }

    ctx.strokeStyle = strokeCol(isFarLeg ? 'sub' : 'ink', isFarLeg ? 0.65 : 0.98);
    ctx.lineWidth = isFarLeg ? 1.4 : 1.85;
    ctx.stroke(shoePath);

    if (!isFarLeg) {
      const solePath = new Path2D();
      solePath.moveTo(-16, 0.2);
      solePath.lineTo(13, 1.2);
      ctx.strokeStyle = strokeCol('sub', 0.7);
      ctx.lineWidth = 1.0;
      ctx.stroke(solePath);

      const cleatPath = new Path2D();
      cleatPath.roundRect(-5, 2.2, 10, 3.2, 1.2);
      ctx.fillStyle = strokeCol('ink', 0.9);
      ctx.fill(cleatPath);
    }

    ctx.restore();
  }

  /**
   * 繪製高框碳纖板輪 (50mm Deep-Section Carbon Aero Wheel)
   * 採用三角函數直接計算輪框環形排線，完全避免 evenodd 裁切反轉風險
   */
  function drawAeroWheel(wx, wy, wheelR, rimDepth, styleMode) {
    ctx.save();
    ctx.translate(wx, wy);

    const innerRimR = wheelR - rimDepth;

    // 1. 動態旋轉輻條 (Spokes)
    ctx.save();
    ctx.rotate(wheelPhase);
    const numSpokes = styleMode === 'blueprint' ? 12 : 16;
    const spokesPath = new Path2D();
    for (let i = 0; i < numSpokes; i++) {
      const a = (i * Math.PI * 2) / numSpokes;
      const offsetHub = (i % 2 === 0 ? 1 : -1) * 3.5;
      spokesPath.moveTo(Math.cos(a + 0.4) * offsetHub, Math.sin(a + 0.4) * offsetHub);
      spokesPath.lineTo(Math.cos(a) * innerRimR, Math.sin(a) * innerRimR);
    }
    ctx.strokeStyle = strokeCol('faint', styleMode === 'blueprint' ? 0.55 : 0.42);
    ctx.lineWidth = 0.85;
    ctx.stroke(spokesPath);
    ctx.restore();

    // 2. 50mm 高框碳纖板輪環形遮罩 (外圓順時針 + 內圓逆時針)
    const rimAnnulus = new Path2D();
    rimAnnulus.arc(0, 0, wheelR, 0, Math.PI * 2, false);
    rimAnnulus.arc(0, 0, innerRimR, 0, Math.PI * 2, true);
    ctx.fillStyle = getBgColor();
    ctx.fill(rimAnnulus);

    // 模式 B：直接以三角函數在 innerRimR 與 wheelR 之間繪製斜向版畫刻線，不依賴 clip('evenodd')
    if (styleMode === 'hatched') {
      const rimTicks = new Path2D();
      const tickCount = 56;
      for (let i = 0; i < tickCount; i++) {
        const a1 = (i * Math.PI * 2) / tickCount;
        const a2 = a1 + 0.085;
        rimTicks.moveTo(Math.cos(a1) * (innerRimR + 0.8), Math.sin(a1) * (innerRimR + 0.8));
        rimTicks.lineTo(Math.cos(a2) * (wheelR - 0.8), Math.sin(a2) * (wheelR - 0.8));
      }
      ctx.strokeStyle = strokeCol('sub', 0.40);
      ctx.lineWidth = 0.85;
      ctx.stroke(rimTicks);
    }

    // 外胎主輪廓線
    const outerCircle = new Path2D();
    outerCircle.arc(0, 0, wheelR, 0, Math.PI * 2);
    ctx.strokeStyle = strokeCol('ink', 0.96);
    ctx.lineWidth = 2.2;
    ctx.stroke(outerCircle);

    // 板輪內圈輪廓線
    const innerCircle = new Path2D();
    innerCircle.arc(0, 0, innerRimR, 0, Math.PI * 2);
    ctx.strokeStyle = strokeCol('sub', 0.8);
    ctx.lineWidth = 1.4;
    ctx.stroke(innerCircle);

    // 胎壁細線
    const tireWall = new Path2D();
    tireWall.arc(0, 0, wheelR - 2.6, 0, Math.PI * 2);
    ctx.strokeStyle = strokeCol('faint', 0.45);
    ctx.lineWidth = 0.8;
    ctx.stroke(tireWall);

    // 3. 公路車碟煞碟盤與花鼓軸心
    const rotorPath = new Path2D();
    rotorPath.arc(0, 0, 11.5, 0, Math.PI * 2);
    ctx.strokeStyle = strokeCol('sub', 0.65);
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 3]);
    ctx.stroke(rotorPath);
    ctx.setLineDash([]);

    const hubPath = new Path2D();
    hubPath.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol('ink', 0.95);
    ctx.lineWidth = 1.8;
    ctx.fill(hubPath);
    ctx.stroke(hubPath);

    ctx.restore();
  }

  /**
   * 繪製高階空力彎把公路車車架與彎把 (Aero Road Frame & Drop Bar)
   */
  function drawAeroRoadBikeFrame(styleMode) {
    const rearX = -74, frontX = 74, wheelY = -46;
    const bbX = -10, bbY = -42;
    const seatClusterX = -39, seatClusterY = -103;
    const saddleX = -44, saddleY = -115;
    const headTopX = 48, headTopY = -106;
    const headBotX = 53, headBotY = -85;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 下管與立管雙水壺
    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol('sub', 0.72);
    ctx.lineWidth = 1.3;

    ctx.save();
    ctx.translate(15, -69);
    ctx.rotate(-0.82);
    const bottle1 = new Path2D();
    bottle1.roundRect(-5.5, -13, 11, 23, 3);
    ctx.fill(bottle1);
    ctx.stroke(bottle1);
    ctx.restore();

    ctx.save();
    ctx.translate(-21, -67);
    ctx.rotate(-0.30);
    const bottle2 = new Path2D();
    bottle2.roundRect(-5, -11, 10, 20, 3);
    ctx.fill(bottle2);
    ctx.stroke(bottle2);
    ctx.restore();

    // 2. 後三角 (後下叉 Chainstays + 低風阻後上叉 Dropped Seatstays)
    const rearTriangle = new Path2D();
    rearTriangle.moveTo(rearX, wheelY - 2.5);
    rearTriangle.lineTo(bbX, bbY - 4.5);
    rearTriangle.lineTo(bbX, bbY + 3.5);
    rearTriangle.lineTo(rearX, wheelY + 2.5);
    rearTriangle.closePath();

    rearTriangle.moveTo(rearX + 1, wheelY - 2);
    rearTriangle.lineTo(-35, -88);
    rearTriangle.lineTo(-33, -83);
    rearTriangle.lineTo(rearX + 3, wheelY + 1);
    rearTriangle.closePath();

    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol('ink', 0.96);
    ctx.lineWidth = 1.85;
    ctx.fill(rearTriangle);
    ctx.stroke(rearTriangle);

    // 3. 破風主車架外框 (Main Aero Frame Outer Polygon)
    const mainFrameOuter = new Path2D();
    mainFrameOuter.moveTo(headTopX - 3, headTopY);
    mainFrameOuter.lineTo(headTopX + 4, headTopY);
    mainFrameOuter.lineTo(headBotX + 4, headBotY);
    mainFrameOuter.lineTo(bbX + 5, bbY + 4);
    mainFrameOuter.lineTo(bbX - 6, bbY + 2);
    mainFrameOuter.lineTo(seatClusterX - 4, seatClusterY);
    mainFrameOuter.lineTo(saddleX - 2, saddleY + 3);
    mainFrameOuter.lineTo(saddleX + 4, saddleY + 3);
    mainFrameOuter.lineTo(seatClusterX + 3, seatClusterY);
    mainFrameOuter.closePath();

    ctx.fill(mainFrameOuter);
    if (styleMode === 'hatched') {
      drawHatchingInPath(mainFrameOuter, -50, 60, -120, -35, 3.8, 0.35);
    }
    ctx.stroke(mainFrameOuter);

    // 車架前三角內孔 (以背景色填滿，形成雙線管材厚度)
    const innerCutout = new Path2D();
    innerCutout.moveTo(seatClusterX + 4.5, seatClusterY + 6.5);
    innerCutout.lineTo(headTopX - 4.5, headTopY + 6.5);
    innerCutout.lineTo(headBotX - 4.5, headBotY - 2);
    innerCutout.lineTo(bbX + 1, bbY - 6);
    innerCutout.lineTo(bbX - 2.5, bbY - 6);
    innerCutout.closePath();

    ctx.fillStyle = getBgColor();
    ctx.fill(innerCutout);
    ctx.strokeStyle = strokeCol('ink', 0.92);
    ctx.lineWidth = 1.65;
    ctx.stroke(innerCutout);

    // 4. 空力前叉 (Aero Carbon Fork Blade)
    const forkPath = new Path2D();
    forkPath.moveTo(headBotX - 3, headBotY);
    forkPath.lineTo(headBotX + 4.5, headBotY);
    forkPath.lineTo(frontX + 2.5, wheelY);
    forkPath.lineTo(frontX - 2.5, wheelY);
    forkPath.closePath();
    ctx.fill(forkPath);
    ctx.stroke(forkPath);

    // 5. 競賽座墊 (Racing Saddle)
    const saddlePath = new Path2D();
    saddlePath.moveTo(saddleX - 16, saddleY - 1.5);
    saddlePath.quadraticCurveTo(saddleX - 2, saddleY - 3, saddleX + 14, saddleY - 1);
    saddlePath.quadraticCurveTo(saddleX + 4, saddleY + 2.5, saddleX - 13, saddleY + 3);
    saddlePath.closePath();
    ctx.fill(saddlePath);
    ctx.strokeStyle = strokeCol('ink', 0.98);
    ctx.lineWidth = 1.8;
    ctx.stroke(saddlePath);

    // 6. 一體式龍頭、彎把 (Drop Bar) 與 STI 雙控煞變把
    const barPath = new Path2D();
    barPath.moveTo(headTopX, headTopY - 2);
    barPath.lineTo(66, -109);
    barPath.lineTo(75, -109);
    barPath.bezierCurveTo(86, -109, 87, -87, 67, -87);
    ctx.strokeStyle = strokeCol('ink', 0.98);
    ctx.lineWidth = 3.2;
    ctx.stroke(barPath);

    const hoodPath = new Path2D();
    hoodPath.moveTo(75, -109);
    hoodPath.quadraticCurveTo(81, -112, 85, -118);
    ctx.lineWidth = 2.6;
    ctx.stroke(hoodPath);

    const leverPath = new Path2D();
    leverPath.moveTo(83, -113);
    leverPath.quadraticCurveTo(86, -102, 83, -94);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = strokeCol('sub', 0.85);
    ctx.stroke(leverPath);

    ctx.restore();
  }

  /**
   * 繪製大盤齒片、鏈條與曲柄 (Drivetrain)
   */
  function drawDrivetrain(pedalX, pedalY) {
    const rearX = -74, wheelY = -46;
    const bbX = -10, bbY = -42;
    const ringR = 13.5;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const chainPath = new Path2D();
    chainPath.moveTo(rearX, wheelY - 5.5);
    chainPath.lineTo(bbX, bbY - ringR);
    chainPath.moveTo(bbX, bbY + ringR);
    chainPath.lineTo(rearX + 4, wheelY + 13);
    chainPath.lineTo(rearX - 2, wheelY + 6);
    ctx.strokeStyle = strokeCol('sub', 0.65);
    ctx.lineWidth = 1.1;
    ctx.stroke(chainPath);

    const pulleyPath = new Path2D();
    pulleyPath.arc(rearX + 3, wheelY + 11, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol('ink', 0.85);
    ctx.lineWidth = 1.4;
    ctx.fill(pulleyPath);
    ctx.stroke(pulleyPath);

    const ringPath = new Path2D();
    ringPath.arc(bbX, bbY, ringR, 0, Math.PI * 2);
    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol('ink', 0.92);
    ctx.lineWidth = 1.6;
    ctx.fill(ringPath);
    ctx.stroke(ringPath);

    ctx.save();
    ctx.translate(bbX, bbY);
    ctx.rotate(pedalPhase);
    const spiderPath = new Path2D();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      spiderPath.arc(0, 0, ringR - 3.5, a + 0.25, a + 1.15);
    }
    ctx.strokeStyle = strokeCol('sub', 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke(spiderPath);
    ctx.restore();

    const dx = pedalX - bbX;
    const dy = pedalY - bbY;
    const angle = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);

    ctx.save();
    ctx.translate(bbX, bbY);
    ctx.rotate(angle);
    const crankPath = new Path2D();
    crankPath.moveTo(0, -3.6);
    crankPath.lineTo(dist, -2.2);
    crankPath.arc(dist, 0, 2.2, -Math.PI / 2, Math.PI / 2);
    crankPath.lineTo(0, 3.6);
    crankPath.arc(0, 0, 3.6, Math.PI / 2, -Math.PI / 2);
    crankPath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.strokeStyle = strokeCol('ink', 0.98);
    ctx.lineWidth = 1.7;
    ctx.fill(crankPath);
    ctx.stroke(crankPath);
    ctx.restore();

    ctx.restore();
  }

  /**
   * 繪製解剖學破風軀幹、車衣口袋、手臂與破風安全帽 (Aero Torso, Arms & Helmet)
   */
  function drawTorsoArmsAndHead(hipX, hipY, breatheOffset, styleMode) {
    const shoulderX = 24;
    const shoulderY = -148 + breatheOffset;
    const handX = 81;
    const handY = -114;
    const elbowX = 48;
    const elbowY = -115 + breatheOffset * 0.5;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 遠側手臂
    const farArm = new Path2D();
    farArm.moveTo(shoulderX + 3, shoulderY + 2);
    farArm.quadraticCurveTo(elbowX + 5, elbowY - 2, handX - 2, handY - 2);
    ctx.strokeStyle = strokeCol('sub', 0.5);
    ctx.lineWidth = 5.5;
    ctx.stroke(farArm);

    // 2. 破風拱背軀幹與車衣輪廓 (獨立 Path2D)
    const torsoPath = new Path2D();
    torsoPath.moveTo(hipX - 12, hipY - 3);
    torsoPath.bezierCurveTo(
      hipX - 8, hipY - 30,
      shoulderX - 25, shoulderY - 6,
      shoulderX + 2, shoulderY - 9
    );
    torsoPath.lineTo(shoulderX + 14, shoulderY - 4);
    torsoPath.lineTo(shoulderX + 8, shoulderY + 11);
    torsoPath.bezierCurveTo(
      shoulderX - 12, shoulderY + 17,
      hipX + 16, hipY - 16,
      hipX + 8, hipY + 3
    );
    torsoPath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.fill(torsoPath);

    if (styleMode === 'hatched') {
      // 僅在胸腹下側暗面排線，先 clip 到 torsoPath 再 clip 到下半部區域
      ctx.save();
      ctx.clip(torsoPath);
      const bellyShadow = new Path2D();
      bellyShadow.moveTo(hipX - 10, hipY);
      bellyShadow.lineTo(shoulderX + 10, shoulderY + 2);
      bellyShadow.lineTo(shoulderX + 10, shoulderY + 22);
      bellyShadow.lineTo(hipX + 10, hipY + 10);
      bellyShadow.closePath();
      drawHatchingInPath(bellyShadow, hipX - 15, shoulderX + 18, shoulderY - 12, hipY + 10, 4.0, 0.38);
      ctx.restore();
    }

    ctx.strokeStyle = strokeCol('ink', 0.98);
    ctx.lineWidth = 2.0;
    ctx.stroke(torsoPath);

    // 車衣後腰口袋與領口細節
    const jerseyDetails = new Path2D();
    jerseyDetails.moveTo(hipX - 4, hipY - 19);
    jerseyDetails.quadraticCurveTo(hipX + 4, hipY - 17, hipX + 6, hipY - 12);
    jerseyDetails.moveTo(hipX - 7, hipY - 11);
    jerseyDetails.lineTo(hipX + 2, hipY - 21);
    jerseyDetails.moveTo(shoulderX + 5, shoulderY - 8);
    jerseyDetails.quadraticCurveTo(shoulderX + 8, shoulderY, shoulderX + 12, shoulderY - 3);
    ctx.strokeStyle = strokeCol('sub', 0.72);
    ctx.lineWidth = 1.2;
    ctx.stroke(jerseyDetails);

    // 3. 頸部、側臉輪廓、運動風鏡與水滴型破風安全帽
    const headX = shoulderX + 22;
    const headY = shoulderY - 11;

    const facePath = new Path2D();
    facePath.moveTo(shoulderX + 9, shoulderY - 6);
    facePath.lineTo(headX - 8, headY + 2);
    facePath.lineTo(headX + 13, headY + 1);
    facePath.lineTo(headX + 11, headY + 6);
    facePath.quadraticCurveTo(headX + 7, headY + 10, headX + 1, headY + 8);
    facePath.lineTo(shoulderX + 13, shoulderY + 1);
    facePath.closePath();
    ctx.fillStyle = getBgColor();
    ctx.fill(facePath);
    ctx.strokeStyle = strokeCol('ink', 0.95);
    ctx.lineWidth = 1.65;
    ctx.stroke(facePath);

    // 運動大風鏡 (Sunglasses)
    const visorPath = new Path2D();
    visorPath.moveTo(headX + 1, headY - 2);
    visorPath.lineTo(headX + 14, headY - 2);
    visorPath.quadraticCurveTo(headX + 14, headY + 4, headX + 6, headY + 3.5);
    visorPath.quadraticCurveTo(headX + 2, headY + 2, headX + 1, headY - 2);
    visorPath.closePath();
    ctx.fillStyle = strokeCol('ink', 0.85);
    ctx.fill(visorPath);

    // 破風安全帽 (Aero Helmet with Teardrop Tail)
    const helmetPath = new Path2D();
    helmetPath.moveTo(headX + 16, headY - 3);
    helmetPath.bezierCurveTo(
      headX + 14, headY - 17,
      headX - 10, headY - 18,
      headX - 19, headY - 7
    );
    helmetPath.lineTo(headX - 10, headY - 2);
    helmetPath.quadraticCurveTo(headX + 2, headY - 4, headX + 16, headY - 3);
    helmetPath.closePath();
    ctx.fillStyle = getBgColor();
    ctx.fill(helmetPath);
    ctx.strokeStyle = strokeCol('ink', 0.98);
    ctx.lineWidth = 2.0;
    ctx.stroke(helmetPath);

    // 安全帽透氣導流孔與帽帶
    const ventsPath = new Path2D();
    ventsPath.moveTo(headX + 8, headY - 9);
    ventsPath.quadraticCurveTo(headX, headY - 11, headX - 7, headY - 8);
    ventsPath.moveTo(headX + 3, headY - 13);
    ventsPath.lineTo(headX - 9, headY - 11);
    ctx.strokeStyle = strokeCol('sub', 0.8);
    ctx.lineWidth = 1.3;
    ctx.stroke(ventsPath);

    const strapPath = new Path2D();
    strapPath.moveTo(headX - 3, headY - 2);
    strapPath.lineTo(headX + 1, headY + 7);
    strapPath.lineTo(headX + 4, headY - 2);
    ctx.strokeStyle = strokeCol('faint', 0.7);
    ctx.lineWidth = 1.0;
    ctx.stroke(strapPath);

    // 4. 近側解剖學手臂 (獨立 Path2D)
    const pArmTop = { x: shoulderX - 4, y: shoulderY - 4 };
    const pArmBot = { x: shoulderX + 4, y: shoulderY + 6 };

    const armPath = new Path2D();
    armPath.moveTo(pArmTop.x, pArmTop.y);
    armPath.quadraticCurveTo(shoulderX + 7, shoulderY - 5, shoulderX + 9, shoulderY + 2);
    armPath.lineTo(elbowX + 4, elbowY - 3);
    armPath.lineTo(handX - 2, handY - 4);
    armPath.quadraticCurveTo(handX + 5, handY - 3, handX + 4, handY + 2);
    armPath.lineTo(handX - 4, handY + 2);
    armPath.quadraticCurveTo((elbowX + handX) * 0.5, elbowY + 4, elbowX - 3, elbowY + 4);
    armPath.quadraticCurveTo((shoulderX + elbowX) * 0.5 - 3, (shoulderY + elbowY) * 0.5 + 4, pArmBot.x, pArmBot.y);
    armPath.closePath();

    ctx.fillStyle = getBgColor();
    ctx.fill(armPath);
    if (styleMode === 'hatched') {
      drawHatchingInPath(armPath, shoulderX - 8, handX + 8, shoulderY - 8, elbowY + 8, 4.5, 0.28);
    }
    ctx.strokeStyle = strokeCol('ink', 0.98);
    ctx.lineWidth = 1.85;
    ctx.stroke(armPath);

    // 車衣短袖袖口線
    const cuff1 = mapLimbPoint(shoulderX, shoulderY, elbowX, elbowY, 0.56, 4.6);
    const cuff2 = mapLimbPoint(shoulderX, shoulderY, elbowX, elbowY, 0.56, -4.4);
    const cuffPath = new Path2D();
    cuffPath.moveTo(cuff1.x, cuff1.y);
    cuffPath.lineTo(cuff2.x, cuff2.y);
    ctx.strokeStyle = strokeCol('sub', 0.8);
    ctx.lineWidth = 1.3;
    ctx.stroke(cuffPath);

    ctx.restore();
  }

  /**
   * 模式 C：工程藍圖結構覆蓋層 (CAD Biomechanical & Aero Blueprint Overlay)
   */
  function drawBlueprintAnnotations(joints) {
    const { rearX, frontX, wheelY, bbX, bbY, hipX, hipY, kneeNear, ankleNear, shoulderX, shoulderY, elbowX, elbowY } = joints;

    ctx.save();
    ctx.font = `500 ${(13 / riderScale).toFixed(2)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = strokeCol('accent', 0.92);
    ctx.strokeStyle = strokeCol('accent', 0.58);
    ctx.lineWidth = 0.9;

    // 1. 曲柄軌跡圓與幾何基準虛線
    ctx.setLineDash([3, 3]);
    const guidePath = new Path2D();
    guidePath.arc(bbX, bbY, 23, 0, Math.PI * 2);
    guidePath.moveTo(rearX, wheelY);
    guidePath.lineTo(frontX, wheelY);
    guidePath.moveTo(hipX - 35, hipY);
    guidePath.lineTo(shoulderX + 55, hipY);
    guidePath.moveTo(hipX, hipY);
    guidePath.lineTo(shoulderX, shoulderY);
    guidePath.moveTo(bbX, bbY);
    guidePath.lineTo(hipX, hipY);
    ctx.stroke(guidePath);

    // 2. 車架立管角與背部破風傾角標註
    ctx.setLineDash([]);
    const arcPath = new Path2D();
    arcPath.arc(hipX, hipY, 32, -0.34, 0);
    ctx.stroke(arcPath);
    ctx.fillText('AERO 16.8°', hipX + 36, hipY - 4);
    ctx.fillText('73.5° SEAT', bbX - 48, bbY - 26);

    // 3. 生物力學 IK 關節軸心標記
    const nodes = [
      { x: hipX, y: hipY, label: 'HIP' },
      { x: kneeNear.x, y: kneeNear.y, label: 'KNEE' },
      { x: ankleNear.x, y: ankleNear.y, label: 'ANKLE' },
      { x: shoulderX, y: shoulderY, label: 'SHLDR' },
      { x: elbowX, y: elbowY, label: '' },
      { x: bbX, y: bbY, label: 'BB' }
    ];

    nodes.forEach(n => {
      const nodeOuter = new Path2D();
      nodeOuter.arc(n.x, n.y, 4.2, 0, Math.PI * 2);
      ctx.stroke(nodeOuter);

      const nodeInner = new Path2D();
      nodeInner.arc(n.x, n.y, 1.5, 0, Math.PI * 2);
      ctx.fill(nodeInner);

      if (n.label) {
        ctx.fillText(n.label, n.x + 6, n.y - 5);
      }
    });

    // 4. 迎風流體網格標尺与即時數據
    const rulerPath = new Path2D();
    rulerPath.moveTo(frontX + 54, -175);
    rulerPath.lineTo(frontX + 54, 0);
    for (let y = -170; y <= -10; y += 20) {
      rulerPath.moveTo(frontX + 50, y);
      rulerPath.lineTo(frontX + 54, y);
    }
    ctx.strokeStyle = strokeCol('faint', 0.45);
    ctx.stroke(rulerPath);

    const rpm = Math.round(currentSpeed * 2.68);
    const watts = Math.round(85 + Math.pow(currentSpeed / 10, 2.55) * 7.2);
    ctx.fillText(`${rpm} RPM · ${watts}W`, bbX - 24, bbY + 36);
    ctx.fillText('CdA 0.214', frontX + 16, -162);

    ctx.restore();
  }

  /**
   * 模式 D：流體風洞動線模式 (Aero Ribbons)
   */
  function drawRibbonCyclist(joints, time) {
    const { rearX, frontX, wheelY, wheelR, bbX, bbY, hipX, hipY, kneeNear, ankleNear, pedalNearX, pedalNearY, kneeFar, ankleFar, shoulderX, shoulderY } = joints;
    const headX = shoulderX + 22;
    const headY = shoulderY - 11;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 雙輪尾流旋風絲帶
    [rearX, frontX].forEach(wx => {
      ctx.save();
      ctx.translate(wx, wheelY);
      for (let r = 0; r < 4; r++) {
        const rad = wheelR - r * 3.2;
        const startA = wheelPhase * (1 - r * 0.15) + r * 1.4;
        const arcRibbon = new Path2D();
        arcRibbon.arc(0, 0, rad, startA, startA + Math.PI * 1.45);
        ctx.strokeStyle = strokeCol(r === 0 ? 'ink' : 'sub', 0.85 - r * 0.18);
        ctx.lineWidth = 2.2 - r * 0.35;
        ctx.stroke(arcRibbon);
      }
      ctx.restore();
    });

    // 2. 車架極簡流體雙弦線
    const frameRibbon = new Path2D();
    frameRibbon.moveTo(rearX, wheelY);
    frameRibbon.quadraticCurveTo(bbX, bbY + 4, 52, -92);
    frameRibbon.lineTo(frontX, wheelY);
    frameRibbon.moveTo(-42, -112);
    frameRibbon.bezierCurveTo(0, -104, 45, -108, 82, -114);
    ctx.strokeStyle = strokeCol('sub', 0.7);
    ctx.lineWidth = 1.6;
    ctx.stroke(frameRibbon);

    // 3. 遠側與近側踩踏動線絲帶
    const farLegRibbon = new Path2D();
    farLegRibbon.moveTo(hipX, hipY);
    farLegRibbon.quadraticCurveTo(kneeFar.x + 8, kneeFar.y - 6, ankleFar.x, ankleFar.y);
    ctx.strokeStyle = strokeCol('faint', 0.55);
    ctx.lineWidth = 2.2;
    ctx.stroke(farLegRibbon);

    for (let s = -1; s <= 1; s++) {
      const nearLegRibbon = new Path2D();
      nearLegRibbon.moveTo(hipX + s * 4, hipY + s * 2);
      nearLegRibbon.quadraticCurveTo(kneeNear.x + 11 + s * 3, kneeNear.y - 5, ankleNear.x + s * 2, ankleNear.y);
      nearLegRibbon.lineTo(pedalNearX + 12, pedalNearY + 2);
      ctx.strokeStyle = strokeCol(s === 0 ? 'ink' : 'sub', s === 0 ? 0.95 : 0.55);
      ctx.lineWidth = s === 0 ? 2.6 : 1.2;
      ctx.stroke(nearLegRibbon);
    }

    // 4. 風洞破風包覆流線 (由安全帽切開空氣，滑過拱背向後延展消散)
    for (let i = 0; i < 6; i++) {
      const offset = (i - 2.5) * 4.2;
      const wave = Math.sin(time * 0.005 + i) * 4;
      const aeroStream = new Path2D();
      aeroStream.moveTo(headX + 20, headY - 2 + offset * 0.4);
      aeroStream.bezierCurveTo(
        headX + 2, headY - 19 + offset,
        shoulderX - 24, shoulderY - 12 + offset,
        hipX - 18, hipY - 6 + offset * 1.2
      );
      aeroStream.quadraticCurveTo(
        hipX - 65, hipY - 4 + offset * 1.6 + wave,
        hipX - 125 - i * 12, hipY + offset * 1.8 - wave
      );
      ctx.strokeStyle = strokeCol(i === 2 ? 'ink' : 'sub', 0.9 - Math.abs(i - 2) * 0.16);
      ctx.lineWidth = i === 2 ? 2.4 : 1.2;
      ctx.stroke(aeroStream);
    }

    // 手臂流線
    const armRibbon = new Path2D();
    armRibbon.moveTo(shoulderX, shoulderY);
    armRibbon.quadraticCurveTo(48, -113, 82, -114);
    ctx.strokeStyle = strokeCol('ink', 0.85);
    ctx.lineWidth = 1.8;
    ctx.stroke(armRibbon);

    ctx.restore();
  }

  /**
   * 黃昏與黑夜專屬：彎把公路車破風頭燈光束與尾燈 (Synchronized across Styles A / B / C / D)
   */
  function drawCyclistNightLights(styleMode, time) {
    const nightStrength = Math.max(currentPalette.nightFactor, currentPalette.duskFactor * 0.75);
    if (nightStrength <= 0.12) return;

    const headLampX = 83, headLampY = -105; // 彎把下方破風碼表延伸座車燈位置
    const tailLampX = -48, tailLampY = -104; // 座管後方尾燈位置

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 頭燈光束 (Front Headlight Beam)
    const beamCone = new Path2D();
    beamCone.moveTo(headLampX, headLampY);
    beamCone.lineTo(headLampX + 265, -24);
    beamCone.lineTo(headLampX + 285, 2);
    beamCone.lineTo(headLampX + 115, 2);
    beamCone.closePath();

    if (styleMode === 'sculpted') {
      // 模式 A：柔和幾何光束輪廓與地面橢圓光斑
      ctx.strokeStyle = strokeCol('accent', nightStrength * 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke(beamCone);

      const innerBeam = new Path2D();
      innerBeam.moveTo(headLampX, headLampY);
      innerBeam.lineTo(headLampX + 230, -10);
      ctx.strokeStyle = strokeCol('ink', nightStrength * 0.35);
      ctx.lineWidth = 0.85;
      ctx.stroke(innerBeam);
    } else if (styleMode === 'hatched') {
      // 模式 B：獨立 Path2D 裁切之版畫斜線光束 (絕不外溢)
      drawHatchingInPath(beamCone, headLampX, headLampX + 290, headLampY - 5, 5, 6.0, nightStrength * 0.45);
      ctx.strokeStyle = strokeCol('sub', nightStrength * 0.5);
      ctx.lineWidth = 1.0;
      ctx.stroke(beamCone);
    } else if (styleMode === 'blueprint') {
      // 模式 C：CAD 光學照度錐與距離標尺
      ctx.strokeStyle = strokeCol('accent', nightStrength * 0.75);
      ctx.lineWidth = 0.95;
      ctx.setLineDash([5, 4]);
      ctx.stroke(beamCone);
      ctx.setLineDash([]);

      for (let r = 70; r <= 210; r += 70) {
        const arcRing = new Path2D();
        arcRing.arc(headLampX, headLampY, r, 0.22, 0.54);
        ctx.strokeStyle = strokeCol('accent', nightStrength * 0.5);
        ctx.stroke(arcRing);
      }
      ctx.font = `500 ${(13 / riderScale).toFixed(2)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = strokeCol('accent', nightStrength * 0.95);
      ctx.fillText('850 LM · FOV 16°', headLampX + 68, headLampY + 18);
    } else if (styleMode === 'ribbon') {
      // 模式 D：流體光子波紋絲帶
      for (let i = 0; i < 4; i++) {
        const waveRibbon = new Path2D();
        waveRibbon.moveTo(headLampX, headLampY);
        const targetY = -20 + i * 7;
        const waveOffset = Math.sin(time * 0.008 + i) * 6;
        waveRibbon.quadraticCurveTo(headLampX + 120, headLampY + 35 + waveOffset, headLampX + 250 - i * 20, targetY);
        ctx.strokeStyle = strokeCol(i === 0 ? 'accent' : 'sub', nightStrength * (0.72 - i * 0.14));
        ctx.lineWidth = 1.6 - i * 0.25;
        ctx.stroke(waveRibbon);
      }
    }

    // 頭燈燈頭亮點
    const lampDot = new Path2D();
    lampDot.arc(headLampX, headLampY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol('ink', nightStrength * 0.95);
    ctx.fill(lampDot);

    // 2. 座管尾燈脈衝光圈与拖尾光跡 (Rear Taillight Pulse & Trail)
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.01);
    const tailTrail = new Path2D();
    tailTrail.moveTo(tailLampX, tailLampY);
    tailTrail.lineTo(tailLampX - 58 - pulse * 25, tailLampY);
    ctx.strokeStyle = strokeCol('accent', nightStrength * 0.75);
    ctx.lineWidth = 2.0;
    ctx.stroke(tailTrail);

    const tailRing = new Path2D();
    tailRing.arc(tailLampX, tailLampY, 3.0 + pulse * 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = strokeCol('accent', nightStrength * 0.85);
    ctx.lineWidth = 1.2;
    ctx.stroke(tailRing);

    ctx.restore();
  }

  /**
   * 整合繪製騎士與彎把公路車主函式
   */
  function drawMasterCyclist(cx, cy, scale, time) {
    riderScale = scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const bounce = Math.sin(pedalPhase * 2) * 1.1;
    ctx.translate(0, bounce);

    // 黃昏與夜間車燈光束（繪製於車輛底層）
    drawCyclistNightLights(cyclistStyle, time);

    const wheelR = 46;
    const rimDepth = 9.5;
    const rearX = -74, frontX = 74, wheelY = -wheelR;
    const bbX = -10, bbY = -42;
    const hipX = -42, hipY = -126;
    const crankR = 23;
    const thighLen = 54, calfLen = 52;

    function computeLegKinematics(phase) {
      const px = bbX + Math.cos(phase) * crankR;
      const py = bbY + Math.sin(phase) * crankR;
      const footAngle = 0.22 + 0.14 * Math.sin(phase - 0.6);
      const ax = px - Math.cos(footAngle) * 11 + Math.sin(footAngle) * 10;
      const ay = py - Math.sin(footAngle) * 11 - Math.cos(footAngle) * 10;
      const knee = solveTwoBoneIK(hipX, hipY, ax, ay, thighLen, calfLen);
      return { px, py, ax, ay, footAngle, knee };
    }

    const nearLeg = computeLegKinematics(pedalPhase);
    const farLeg = computeLegKinematics(pedalPhase + Math.PI);

    const joints = {
      rearX, frontX, wheelY, wheelR, bbX, bbY, hipX, hipY,
      kneeNear: nearLeg.knee, ankleNear: { x: nearLeg.ax, y: nearLeg.ay },
      pedalNearX: nearLeg.px, pedalNearY: nearLeg.py,
      kneeFar: farLeg.knee, ankleFar: { x: farLeg.ax, y: farLeg.ay },
      shoulderX: 24, shoulderY: -148, elbowX: 48, elbowY: -115
    };

    if (cyclistStyle === 'ribbon') {
      drawRibbonCyclist(joints, time);
      ctx.restore();
      return;
    }

    // 1. 遠側腿 (置於車架後方)
    drawAnatomicalCalf(farLeg.knee.x, farLeg.knee.y, farLeg.ax, farLeg.ay, true, cyclistStyle);
    drawAnatomicalThigh(hipX, hipY, farLeg.knee.x, farLeg.knee.y, true, cyclistStyle);
    drawCyclingShoe(farLeg.px, farLeg.py, farLeg.footAngle, true, cyclistStyle);

    // 2. 前後 50mm 高框碳纖板輪
    drawAeroWheel(rearX, wheelY, wheelR, rimDepth, cyclistStyle);
    drawAeroWheel(frontX, wheelY, wheelR, rimDepth, cyclistStyle);

    // 3. 空力彎把公路車車架與傳動大盤
    drawAeroRoadBikeFrame(cyclistStyle);
    drawDrivetrain(nearLeg.px, nearLeg.py);

    // 4. 破風軀幹、手臂與空力安全帽
    drawTorsoArmsAndHead(hipX, hipY, bounce * 0.4, cyclistStyle);

    // 5. 近側腿 (置於最前景：小腿 -> 大腿壓疊膝蓋 -> 卡鞋)
    drawAnatomicalCalf(nearLeg.knee.x, nearLeg.knee.y, nearLeg.ax, nearLeg.ay, false, cyclistStyle);
    drawAnatomicalThigh(hipX, hipY, nearLeg.knee.x, nearLeg.knee.y, false, cyclistStyle);
    drawCyclingShoe(nearLeg.px, nearLeg.py, nearLeg.footAngle, false, cyclistStyle);

    // 6. 模式 C：工程藍圖結構覆蓋層
    if (cyclistStyle === 'blueprint') {
      drawBlueprintAnnotations(joints);
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 4. 公路地面標線與空氣流線繪製（依畫風切換：A極簡標線 / B銅版畫路基斜線 / C工程距離刻度尺 / D高速地面流體帶）
   * ============================================================================
   */
  function drawRoadAndStreamlines(w, h, roadY) {
    ctx.save();

    // 遮擋路面以下之山稜與風車底部
    ctx.fillStyle = getBgColor();
    ctx.fillRect(0, roadY, w, h - roadY);

    if (cyclistStyle === 'ribbon') {
      // 模式 D【流體風洞動線】：地面化為 5 道高速平行滑流絲帶
      for (let r = 0; r < 5; r++) {
        const ry = roadY + r * 9;
        const roadRibbon = new Path2D();
        for (let x = 0; x <= w; x += 20) {
          const wave = Math.sin((x + roadOffset * (1 + r * 0.15)) * 0.012 + r) * (r * 0.8);
          if (x === 0) roadRibbon.moveTo(x, ry + wave);
          else roadRibbon.lineTo(x, ry + wave);
        }
        ctx.strokeStyle = strokeCol(r === 0 ? 'ink' : 'sub', 0.82 - r * 0.15);
        ctx.lineWidth = r === 0 ? 1.8 : 1.0;
        ctx.stroke(roadRibbon);
      }
    } else {
      // 模式 A / B / C 共用主地平線
      const mainRoad = new Path2D();
      mainRoad.moveTo(0, roadY);
      mainRoad.lineTo(w, roadY);
      ctx.strokeStyle = strokeCol('ink', 0.88);
      ctx.lineWidth = 1.7;
      ctx.stroke(mainRoad);
    }

    if (cyclistStyle === 'hatched') {
      // 模式 B【版畫排線插畫】：地平線下方路基 45° 密集版畫斜線紋理 (Roadbed Engraving Hatching)
      const roadHatch = new Path2D();
      const stepX = 8;
      const shift = (roadOffset * 0.65) % stepX;
      for (let x = -shift; x < w + 24; x += stepX) {
        roadHatch.moveTo(x, roadY);
        roadHatch.lineTo(x - 14, roadY + 13);
      }
      // 次級水平版畫路基線
      roadHatch.moveTo(0, roadY + 13);
      roadHatch.lineTo(w, roadY + 13);

      ctx.strokeStyle = strokeCol('sub', 0.52);
      ctx.lineWidth = 0.85;
      ctx.stroke(roadHatch);
    } else if (cyclistStyle === 'blueprint') {
      // 模式 C【工程藍圖結構】：路面工程距離刻度尺 (Engineering Distance Ruler Ticks & Meter Labels)
      const rulerTicks = new Path2D();
      const tickSpacing = 20;
      const shift = roadOffset % (tickSpacing * 5);
      ctx.font = '500 13px "JetBrains Mono", monospace';
      ctx.fillStyle = strokeCol('accent', 0.78);

      for (let x = -shift; x < w + 100; x += tickSpacing) {
        const worldTickIndex = Math.round((x + roadOffset) / tickSpacing);
        const isMajor = worldTickIndex % 5 === 0;
        const tickH = isMajor ? 12 : 5.5;
        rulerTicks.moveTo(x, roadY);
        rulerTicks.lineTo(x, roadY + tickH);

        if (isMajor && x > 20 && x < w - 40) {
          const distMeters = (worldTickIndex * 2) % 1000;
          ctx.fillText(`${distMeters}m`, x + 3, roadY + 12);
        }
      }
      ctx.strokeStyle = strokeCol('accent', 0.62);
      ctx.lineWidth = 0.9;
      ctx.stroke(rulerTicks);
    }

    // 高速路面虛線標線 (A / B / C 顯示)
    if (cyclistStyle !== 'ribbon') {
      const dashRoad = new Path2D();
      dashRoad.moveTo(0, roadY + 26);
      dashRoad.lineTo(w, roadY + 26);
      ctx.strokeStyle = strokeCol('sub', 0.45);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([32, 56]);
      ctx.lineDashOffset = -roadOffset;
      ctx.stroke(dashRoad);

      const tickRoad = new Path2D();
      tickRoad.moveTo(0, roadY + 46);
      tickRoad.lineTo(w, roadY + 46);
      ctx.strokeStyle = strokeCol('faint', 0.35);
      ctx.lineWidth = 1.0;
      ctx.setLineDash([6, 48]);
      ctx.lineDashOffset = -roadOffset * 1.35;
      ctx.stroke(tickRoad);
      ctx.setLineDash([]);
    }

    // 空氣微粒流線
    const speedFactor = currentSpeed / 30;
    ctx.lineCap = 'round';
    for (const s of windStreaks) {
      s.x -= s.speed * speedFactor * 3.2;
      if (s.x + s.len < 0) {
        s.x = w + Math.random() * 80;
        s.y = h * 0.25 + Math.random() * (roadY - h * 0.28);
      }
      const streakPath = new Path2D();
      streakPath.moveTo(s.x, s.y);
      streakPath.lineTo(s.x + s.len, s.y);
      ctx.strokeStyle = strokeCol(cyclistStyle === 'blueprint' ? 'accent' : 'faint', s.alpha);
      ctx.lineWidth = cyclistStyle === 'ribbon' ? 1.1 : 0.75;
      ctx.stroke(streakPath);
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 5. 主動畫迴圈 (Main Animation Loop)
   * ============================================================================
   */
  function animate(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // 更新日夜循環調色盤與 24h 時間
    updateDayNightPalette(dt);

    const w = VW;
    const h = VH;
    const roadY = h - Math.min(54, h * 0.2);

    currentSpeed += (targetSpeed - currentSpeed) * Math.min(1, dt * 4);
    const cadenceRpm = currentSpeed * 2.68;
    const watts = Math.round(85 + Math.pow(currentSpeed / 10, 2.55) * 7.2);

    pedalPhase += (cadenceRpm / 60) * Math.PI * 2 * dt;
    wheelPhase += (currentSpeed * 0.58) * Math.PI * 2 * dt;

    const baseScroll = currentSpeed * dt * 15;
    ridgeOffsets[0] += baseScroll * 0.14;
    ridgeOffsets[1] += baseScroll * 0.34;
    ridgeOffsets[2] += baseScroll * 0.68;
    ridgeOffsets[3] += baseScroll * 0.07; // 極遠山視差
    roadOffset += baseScroll * 3.1;

    turbines.forEach(t => {
      t.angle += (1.1 * t.speedMult + currentSpeed * 0.012) * dt;
    });

    // 更新海邊船隻與貼地雙向車流
    const vesselSpan = w + 380;
    coastalVessels.forEach(v => {
      v.offset = ((v.offset + v.speed * dt) % vesselSpan + vesselSpan) % vesselSpan;
    });

    const carTrackSpan = w + 420;
    urbanCars.forEach(car => {
      car.offset = ((car.offset + car.relSpeed * dt) % carTrackSpan + carTrackSpan) % carTrackSpan;
    });


    ctx.clearRect(0, 0, w, h);

    const cyclistX = w < 768 ? w * 0.5 : Math.min(w * 0.34, 460);
    const cyclistScale = Math.min(Math.max(0.82, Math.min(1.22, w / 1150)), (roadY - h * 0.2) / 205);

    // 景深第 0 層：日夜天體運行（太陽/弦月/星座）與全局環境層（CAD 正交網格 / 版畫天空微風 / CFD 風洞層流線）
    drawCelestialAndSky(w, h, roadY, cyclistX, now);

    // 景深第 1~3 層：依場景模式繪製（城市 / 山城混合 / 群山 / 海邊）
    if (sceneMode === 'coast') {
      drawCoastAndOffshoreScene(w, roadY, now);
    } else {
      // 極遠景第 4 層高山（群山專屬：營造層層山巒疊合感）
      if (sceneMode === 'mountain') {
        drawMountainLayer(w, roadY, 235, -1, ridgeOffsets[3]);
      }

      // 遠景層 (Layer 0)
      if (sceneMode === 'mountain' || sceneMode === 'hybrid') {
        drawMountainLayer(w, roadY, 175, 0, ridgeOffsets[0]);
        drawMountainForestsAndBuildings(w, roadY, 175, 0, ridgeOffsets[0], now);
      }
      if (sceneMode === 'city') {
        drawCitySkylineLayer(w, roadY, 0, ridgeOffsets[0], now);
      }

      // 中景層 (Layer 1)
      if (sceneMode === 'mountain' || sceneMode === 'hybrid') {
        drawMountainLayer(w, roadY, 105, 1, ridgeOffsets[1]);
      }
      if (sceneMode === 'mountain') {
        drawMountainForestsAndBuildings(w, roadY, 105, 1, ridgeOffsets[1], now);
      }
      if (sceneMode === 'city' || sceneMode === 'hybrid') {
        drawCitySkylineLayer(w, roadY, 1, ridgeOffsets[1], now);
      }

      // 近景層 (Layer 2)
      if (sceneMode === 'mountain') {
        drawMountainLayer(w, roadY, 45, 2, ridgeOffsets[2]);
        drawMountainForestsAndBuildings(w, roadY, 45, 2, ridgeOffsets[2], now);
      }
      if (sceneMode === 'city' || sceneMode === 'hybrid') {
        drawCitySkylineLayer(w, roadY, 2, ridgeOffsets[2], now);
      }
    }

    // 景深第 4 層：公路與氣流絲線 + 城市貼地動態汽車與路燈
    drawRoadAndStreamlines(w, h, roadY);
    if (sceneMode === 'city' || sceneMode === 'hybrid') {
      drawUrbanCarsAndStreetlights(w, roadY, ridgeOffsets[2], now);
    }

    // 景深第 5 層：彎把公路車與騎士（含夜間自動頭尾燈）
    drawMasterCyclist(cyclistX, roadY, cyclistScale, now);

    if (running) raf = requestAnimationFrame(animate);
  }


  resizeCanvas();
  const ro = new ResizeObserver(() => { resizeCanvas(); if (!running) drawStill(); });
  ro.observe(canvas);
  function drawStill() { running = false; lastTime = performance.now(); animate(lastTime); }
  const TIME = { day: 10.5, dusk: 17.6, night: 22.5 };
  return {
    play() { if (running) return; running = true; lastTime = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(animate); },
    pause() { running = false; cancelAnimationFrame(raf); },
    still() {
      cancelAnimationFrame(raf);
      if (dayNightMode !== 'auto') timeOfDay = targetTimeOfDay;
      drawStill();
    },
    set(o) {
      if (o.style) cyclistStyle = o.style;
      if (o.scene) sceneMode = o.scene;
      if (o.time) { dayNightMode = o.time; if (TIME[o.time]) targetTimeOfDay = TIME[o.time]; }
      if (o.opacity != null) lineOpacity = o.opacity;
      if (o.speed != null) targetSpeed = o.speed;
      if (!running) this.still();
    },
    get state() { return { style: cyclistStyle, scene: sceneMode, time: dayNightMode, timeOfDay }; },
  };
}
