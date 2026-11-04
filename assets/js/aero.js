/*
 * 背景騎乘動畫：三層山稜視差、風車與彎把公路車騎士（Canvas）。
 * 改寫自使用者提供的 AERO CYCLING 線稿頁（獨立頁在 aero/），
 * 這裡改成可嵌入的模組：畫在指定 canvas 的大小內，顏色跟網站一致，文字 ≥13px。
 */
const PAPER = '#F5F5F2';

export function mountAero(canvas, opts = {}) {
  let VW = 0; let VH = 0; let raf = 0; let running = false;
  /**
   * ============================================================================
   * AERO CYCLING — 三層山稜視差與 Path2D 解剖學彎把公路車騎士引擎
   * ============================================================================
   */
  const ctx = canvas.getContext('2d');

  // 狀態管理
  const isDark = false;
  let cyclistStyle = opts.style || 'sculpted'; // 'sculpted' | 'hatched' | 'blueprint' | 'ribbon'
  let lineOpacity = opts.opacity ?? 0.75;
  let targetSpeed = opts.speed ?? 34.0;
  let currentSpeed = targetSpeed;

  // 動畫時間與物理相位
  let lastTime = performance.now();
  let pedalPhase = 0;
    let riderScale = 1;
  let wheelPhase = 0;
  let roadOffset = 0;
  let ridgeOffsets = [0, 0, 0]; // 遠山、中山、近丘陵水平視差位移

  // 三層景深風力發電機配置 (layer: 0=遠山, 1=中山, 2=近景平原)
  const turbines = [
    { xRatio: 0.10, scale: 0.34, layer: 0, angle: 0.4, speedMult: 0.72 },
    { xRatio: 0.35, scale: 0.39, layer: 0, angle: 2.1, speedMult: 0.78 },
    { xRatio: 0.63, scale: 0.32, layer: 0, angle: 4.0, speedMult: 0.68 },
    { xRatio: 0.88, scale: 0.36, layer: 0, angle: 1.2, speedMult: 0.75 },

    { xRatio: 0.22, scale: 0.62, layer: 1, angle: 1.5, speedMult: 0.92 },
    { xRatio: 0.54, scale: 0.58, layer: 1, angle: 3.4, speedMult: 0.88 },
    { xRatio: 0.79, scale: 0.66, layer: 1, angle: 5.1, speedMult: 0.96 },

    { xRatio: 0.07, scale: 0.96, layer: 2, angle: 0.8, speedMult: 1.12 },
    { xRatio: 0.68, scale: 1.04, layer: 2, angle: 2.9, speedMult: 1.08 }
  ];

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
  }

  // 取得當前主題與畫風對應之背景色与線條色彩
  function getBgColor() { return PAPER; }

  function strokeCol(tier = 'ink', alpha = 1) {
    let rgb = '11, 15, 26';
    if (cyclistStyle === 'blueprint') {
      if (tier === 'ink') rgb = isDark ? '210, 238, 255' : '15, 58, 92';
      else if (tier === 'sub') rgb = isDark ? '110, 178, 225' : '38, 102, 148';
      else if (tier === 'faint') rgb = isDark ? '52, 108, 155' : '115, 162, 198';
      else if (tier === 'accent') rgb = isDark ? '56, 189, 248' : '2, 132, 199';
    } else {
      if (tier === 'sub') rgb = isDark ? '161, 161, 170' : '82, 82, 91';
      if (tier === 'faint') rgb = isDark ? '82, 82, 91' : '161, 161, 170';
      if (tier === 'accent') rgb = '255, 59, 31';
    }
    const finalAlpha = Math.max(0.03, Math.min(1, alpha * lineOpacity));
    return `rgba(${rgb}, ${finalAlpha})`;
  }

  /**
   * ============================================================================
   * 0. 全局天空與背景環境層（依畫風切換：CAD 正交工程網格 / 版畫天空微風 / CFD 風洞層流線）
   * ============================================================================
   */
  function drawSkyAndEnvironmentBackdrop(w, h, roadY, cyclistX, time) {
    ctx.save();

    if (cyclistStyle === 'blueprint') {
      // 模式 C：全畫面 CAD 正交工程方格網 (Ortho Grid) 與十字準星 (+)
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

      // 交點十字準星 (+) 與座標標記
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
      // 模式 B：版畫天空雲層與微風平行短刻線 (Etched Sky Breeze Clusters)
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
      // 模式 D：全畫面連續 CFD 風洞層流線 (Laminar Streamlines)，經過騎士上方時產生流體繞流拱起
      const streamCount = 9;
      const cY = roadY - 95;
      for (let i = 0; i < streamCount; i++) {
        const baseY = h * 0.16 + (i / (streamCount - 1)) * (roadY - h * 0.20);
        const streamPath = new Path2D();
        for (let x = 0; x <= w; x += 16) {
          const dx = x - cyclistX;
          const dy = baseY - cY;
          const distSq = dx * dx + dy * dy * 1.8;
          // 流體力學偶極繞流效應：靠近騎士上方時流線平滑向上拱起繞過
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
   * 1. 三層視差山稜線與山脊支脈線 (依畫風切換：A塊面遮罩 / B銅版畫坡面排線 / C三角網格高程藍圖 / D等高線流體絲帶)
   * ============================================================================
   */
  function getRidgeElevation(worldX, layerIndex) {
    if (layerIndex === 0) {
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
      // 近景丘陵：平緩起伏的海岸丘陵
      const p1 = Math.sin(worldX * 0.0038 + 4.2) * 20;
      const p2 = Math.cos(worldX * 0.0092) * 9;
      return p1 + p2;
    }
  }

  function drawMountainLayer(w, roadY, baseHeightOffset, layerIndex, scrollOffset) {
    const baseY = roadY - baseHeightOffset;
    const step = cyclistStyle === 'blueprint' ? 38 : 10;
    const alphaMap = [0.38, 0.58, 0.78];
    const widthMap = [1.0, 1.35, 1.65];

    ctx.save();

    // 模式 D【流體風洞動線】：山稜轉化為 6 道平行流動的等高線流體絲帶 (Multi-strand Topographic Ribbons)
    if (cyclistStyle === 'ribbon') {
      const strandCount = layerIndex === 0 ? 6 : layerIndex === 1 ? 5 : 4;
      const strandGap = layerIndex === 0 ? 11 : layerIndex === 1 ? 9 : 7;

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
        const strandAlpha = alphaMap[layerIndex] * (1 - s / (strandCount + 1));
        ctx.strokeStyle = strokeCol(s === 0 ? 'sub' : 'faint', strandAlpha);
        ctx.lineWidth = s === 0 ? widthMap[layerIndex] : 0.85;
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

    // 背景色遮罩填色：乾淨遮擋後方山層與遠景風車下半部
    ctx.fillStyle = getBgColor();
    ctx.fill(fillPath);

    // 模式 B【版畫排線插畫】：在山脈背光斜坡與稜線下方以獨立 Path2D 裁切繪製歐系銅版畫斜線
    if (cyclistStyle === 'hatched') {
      ctx.save();
      ctx.clip(fillPath); // 嚴格鎖定在山體內部

      const slopeHatchPath = new Path2D();
      const hatchSpacing = layerIndex === 0 ? 7.5 : layerIndex === 1 ? 6.0 : 5.0;

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const slope = (p2.y - p1.y) / (p2.x - p1.x || 1);

        // 背光坡面（向右下降之坡面 slope > -0.05）繪製深邃銅版畫斜線，向陽坡繪製短稜線刻線
        const isShadowSlope = slope > -0.04;
        const hatchDepth = isShadowSlope
          ? (layerIndex === 0 ? 88 : layerIndex === 1 ? 64 : 36) + slope * 95
          : (layerIndex === 0 ? 22 : 15);

        for (let hx = p1.x; hx < p2.x; hx += hatchSpacing) {
          const t = (hx - p1.x) / (p2.x - p1.x || 1);
          const topY = p1.y + (p2.y - p1.y) * t;
          const botY = Math.min(roadY, topY + hatchDepth);
          const slantX = isShadowSlope ? -(botY - topY) * 0.55 : (botY - topY) * 0.3;
          slopeHatchPath.moveTo(hx, topY);
          slopeHatchPath.lineTo(hx + slantX, botY);
        }

        // 背光坡雙重交叉排線 (Cross-hatching near ridge crest)
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

      ctx.strokeStyle = strokeCol(layerIndex === 0 ? 'faint' : 'sub', alphaMap[layerIndex] * 0.62);
      ctx.lineWidth = layerIndex === 0 ? 0.75 : 0.9;
      ctx.stroke(slopeHatchPath);
      ctx.restore();
    }

    // 模式 C【工程藍圖結構】：繪製多邊形三角網格 (Wireframe Triangulated Mesh) 與山峰高程標註
    if (cyclistStyle === 'blueprint') {
      const meshPath = new Path2D();
      const nodeDots = new Path2D();
      const dropH = layerIndex === 0 ? 62 : layerIndex === 1 ? 45 : 26;

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const midX = (p1.x + p2.x) * 0.5;
        const lowY1 = Math.min(roadY, p1.y + dropH + ((i % 2) * 14));
        const lowY2 = Math.min(roadY, p2.y + dropH + (((i + 1) % 2) * 14));

        // 三角網格連線
        meshPath.moveTo(p1.x, p1.y);
        meshPath.lineTo(p1.x, lowY1);
        meshPath.lineTo(p2.x, lowY2);
        meshPath.lineTo(p1.x, p1.y);
        meshPath.moveTo(p2.x, p2.y);
        meshPath.lineTo(p1.x, lowY1);

        // 節點圓點
        nodeDots.moveTo(p1.x + 2, p1.y);
        nodeDots.arc(p1.x, p1.y, 2, 0, Math.PI * 2);

        // 於顯著山峰處標註工程海拔高程與坡度
        if (i > 0 && i < points.length - 2) {
          const prev = points[i - 1];
          if (p1.y < prev.y && p1.y <= p2.y && Math.floor(p1.wx / 220) !== Math.floor(prev.wx / 220)) {
            const elevMeters = Math.round(780 - layerIndex * 210 - (p1.y - baseY) * 2.4);
            const slopePct = Math.abs(((p2.y - p1.y) / step) * 18).toFixed(1);
            ctx.font = '500 13px "JetBrains Mono", monospace';
            ctx.fillStyle = strokeCol('accent', alphaMap[layerIndex] * 1.15);
            ctx.fillText(`▲ EL.${elevMeters}m (${slopePct}%)`, p1.x - 28, p1.y - 8);
          }
        }
      }

      ctx.strokeStyle = strokeCol('faint', alphaMap[layerIndex] * 0.52);
      ctx.lineWidth = 0.75;
      ctx.stroke(meshPath);

      ctx.fillStyle = strokeCol('accent', alphaMap[layerIndex] * 0.85);
      ctx.fill(nodeDots);
    }

    // 描繪主山稜線
    ctx.strokeStyle = strokeCol(layerIndex === 0 ? 'faint' : 'sub', alphaMap[layerIndex]);
    ctx.lineWidth = widthMap[layerIndex];
    ctx.lineJoin = cyclistStyle === 'blueprint' ? 'miter' : 'round';
    ctx.stroke(contourPath);

    // 模式 A 與 模式 B：描繪山峰向下延伸的山脊支脈線 (Ridge Spurs) 與次級等高線
    if (cyclistStyle === 'sculpted' || cyclistStyle === 'hatched') {
      const spurPath = new Path2D();
      for (let i = 2; i < points.length - 2; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];

        const isLocalPeak = curr.y < prev.y && curr.y <= next.y;
        const isSpurPoint = Math.floor(curr.wx / 95) !== Math.floor(prev.wx / 95);

        if (isLocalPeak || (layerIndex < 2 && isSpurPoint)) {
          const spurLen = layerIndex === 0 ? 48 : layerIndex === 1 ? 32 : 18;
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
      ctx.strokeStyle = strokeCol('faint', alphaMap[layerIndex] * 0.55);
      ctx.lineWidth = 0.85;
      ctx.stroke(spurPath);

      if (layerIndex <= 1) {
        const echoPath = new Path2D();
        points.forEach((pt, idx) => {
          const echoY = Math.min(roadY, pt.y + 9 + Math.sin(pt.wx * 0.008) * 4);
          if (idx === 0) echoPath.moveTo(pt.x, echoY);
          else echoPath.lineTo(pt.x, echoY);
        });
        ctx.strokeStyle = strokeCol('faint', alphaMap[layerIndex] * 0.32);
        ctx.lineWidth = 0.7;
        ctx.stroke(echoPath);
      }
    }

    ctx.restore();
  }

  /**
   * ============================================================================
   * 2. 多層次視差風力發電機 (依畫風切換：A雙線塊面 / B塔柱葉片版畫刻線 / C掃掠圓藍圖標註 / D螺旋尾流渦流絲帶)
   * ============================================================================
   */
  function drawWindTurbine(x, baseY, scale, angle, layer) {
    const towerH = 225 * scale;
    const bladeLen = 112 * scale;
    const hubY = baseY - towerH;

    const alphaByLayer = [0.40, 0.68, 0.94][layer];
    const lineW = Math.max(0.8, [1.0, 1.4, 1.8][layer] * scale);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 模式 D【流體風洞動線】：繪製風車葉片尖端與輪轂向後延伸的螺旋尾流渦流軌跡 (Helical Wake Vortex Trails)
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

    // 模式 C【工程藍圖結構】：繪製風車葉片掃掠面積虛線圓 (Swept Area Circle)、中心軸線與工程標註
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

    // 模式 B【版畫排線插畫】：於風車塔柱背光側（左側）使用獨立 Path2D 繪製版畫橫向陰影刻線
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

      // 模式 B：葉片內側版畫短排線
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

    // 3. 輪轂中心 (Hub)
    const hubPath = new Path2D();
    hubPath.arc(x, hubY, 4.2 * scale, 0, Math.PI * 2);
    ctx.fillStyle = getBgColor();
    ctx.fill(hubPath);
    ctx.stroke(hubPath);

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
   * 整合繪製騎士與彎把公路車主函式
   */
  function drawMasterCyclist(cx, cy, scale, time) {
      riderScale = scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const bounce = Math.sin(pedalPhase * 2) * 1.1;
    ctx.translate(0, bounce);

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
    roadOffset += baseScroll * 3.1;

    turbines.forEach(t => {
      t.angle += (1.1 * t.speedMult + currentSpeed * 0.012) * dt;
    });


    ctx.clearRect(0, 0, w, h);

    const cyclistX = w < 768 ? w * 0.5 : Math.min(w * 0.34, 460);
    const cyclistScale = Math.min(Math.max(0.82, Math.min(1.22, w / 1150)), (roadY - h * 0.2) / 205);

    // 景深第 0 層：天空背景與全局環境層（CAD 正交網格 / 版畫天空微風 / CFD 風洞層流線）
    drawSkyAndEnvironmentBackdrop(w, h, roadY, cyclistX, now);

    // 景深第 1 層：遠山山稜線 + 遠景風車
    drawMountainLayer(w, roadY, 175, 0, ridgeOffsets[0]);
    turbines.filter(t => t.layer === 0).forEach(t => {
      const span = w * 1.25;
      const x = ((t.xRatio * span - ridgeOffsets[0] * 1.15) % span + span) % span - w * 0.12;
      const ridgeY = (roadY - 175) + getRidgeElevation(x + ridgeOffsets[0], 0);
      drawWindTurbine(x, ridgeY + 18, t.scale, t.angle, 0);
    });

    // 景深第 2 層：中山山稜線 + 中景風車
    drawMountainLayer(w, roadY, 105, 1, ridgeOffsets[1]);
    turbines.filter(t => t.layer === 1).forEach(t => {
      const span = w * 1.3;
      const x = ((t.xRatio * span - ridgeOffsets[1] * 1.2) % span + span) % span - w * 0.15;
      const ridgeY = (roadY - 105) + getRidgeElevation(x + ridgeOffsets[1], 1);
      drawWindTurbine(x, ridgeY + 25, t.scale, t.angle, 1);
    });

    // 景深第 3 層：近景海岸丘陵 + 近景大型風車
    drawMountainLayer(w, roadY, 42, 2, ridgeOffsets[2]);
    turbines.filter(t => t.layer === 2).forEach(t => {
      const span = w * 1.4;
      const x = ((t.xRatio * span - ridgeOffsets[2] * 1.45) % span + span) % span - w * 0.2;
      drawWindTurbine(x, roadY, t.scale, t.angle, 2);
    });

    // 景深第 4 層：公路與氣流絲線
    drawRoadAndStreamlines(w, h, roadY);

    // 景深第 5 層：彎把公路車與騎士
    drawMasterCyclist(cyclistX, roadY, cyclistScale, now);

    if (running) raf = requestAnimationFrame(animate);
  }


  resizeCanvas();
  const ro = new ResizeObserver(() => { resizeCanvas(); if (!running) drawStill(); });
  ro.observe(canvas);
  function drawStill() { running = false; lastTime = performance.now(); animate(lastTime); }
  const api = {
    play() { if (running) return; running = true; lastTime = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(animate); },
    pause() { running = false; cancelAnimationFrame(raf); },
    still() { cancelAnimationFrame(raf); drawStill(); },
    set(o) {
      if (o.style) cyclistStyle = o.style;
      if (o.opacity != null) lineOpacity = o.opacity;
      if (o.speed != null) targetSpeed = o.speed;
      if (!running) drawStill();
    },
  };
  return api;
}
