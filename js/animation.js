// ─── animation-utils から取得 ────────────────────────────
const {
  COLORS,
  PHASE_DURATIONS,
  STAGE_PHASES,
  HOLD_PHASES,
  STAGE_AUTOPLAY,
  easeInOut,
  easeOut,
  easeIn,
  lerp,
  shiftShimmer,
  lineShapeOffset,
  buildRingSegments,
  createArcs,
  createLines,
  createWaves,
  createSparkles,
} = window.ReAnimUtils;

// ─── Canvas セットアップ ─────────────────────────────────
const canvas = document.getElementById("bg");
const ctx = canvas.getContext("2d");
const timerArc = document.getElementById("timerArc");
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 50;

// ─── アニメーション状態 ──────────────────────────────────
let stage = 0;
let rafId = 0;
let holdStart = 0;
let holdDuration = STAGE_AUTOPLAY[0];
let advanceRequested = false;
let lastResizeAt = 0;
let prevW = 0;
let prevH = 0;

const state = {
  phase: "SPARKLE",
  phaseStart: 0,
  arcs: [],
  lines: [],
  lateLines: [],
  waves: [],
  sparkles: [],
  convergeRadius: 0,
  ringRotation: 0,
  ringRotSpeed: 0.008,
};

// ─── ユーティリティ ──────────────────────────────────────
function getSize() {
  const rect = canvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function maxRadiusForSize(w, h) {
  return Math.min(w / 2, h / 2) * 1.25;
}

// ─── リサイズ対応 ────────────────────────────────────────
function scaleScene(oldW, oldH, newW, newH) {
  if (!oldW || !oldH) return;
  const sx = newW / oldW;
  const sy = newH / oldH;
  const sxy = Math.min(sx, sy);
  const newMaxR = maxRadiusForSize(newW, newH);

  state.arcs.forEach((a) => {
    a.radius = Math.min(a.radius * sxy, newMaxR * 0.98);
    a.snapRadius = Math.min(a.snapRadius * sxy, newMaxR * 0.98);
    a.ringRadius = Math.min(a.ringRadius * sxy, newMaxR * 0.98);
  });

  state.lines.forEach((l) => {
    l.y *= sy;
    l.targetY *= sy;
    l.width *= sx;
    l.lineHeight = Math.max(1, l.lineHeight * sy);
    l.floatOffset *= sx;
    l.bumpOffset = (l.bumpOffset || 0) * sx;
    if (l.replacement) {
      l.replacement.width *= sx;
      l.replacement.floatOffset *= sx;
    }
  });

  state.lateLines.forEach((ll) => {
    ll.y *= sy;
    ll.width *= sx;
    ll.lineHeight = Math.max(1, ll.lineHeight * sy);
    ll.headX *= sx;
  });

  state.waves.forEach((wv) => {
    wv.targetY *= sy;
    wv.amplitude *= sy;
    if (wv.snapAmplitude) wv.snapAmplitude *= sy;
    wv.lineWidth = Math.max(1, wv.lineWidth * sxy);
  });
}

function resize() {
  const { w, h } = getSize();
  const oldW = prevW;
  const oldH = prevH;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!oldW || !oldH) {
    state.arcs = createArcs(w / 2, h / 2);
    state.lines = createLines(w, h);
  } else {
    scaleScene(oldW, oldH, w, h);
  }

  if (
    state.phase === "ARCS_CONVERGE" ||
    state.phase === "RING_SPIN" ||
    state.phase === "RING_OUT"
  ) {
    const cx = w / 2;
    const cy = h / 2;
    state.convergeRadius = Math.min(cx * 0.9, cy * 0.9);
    buildRingSegments(
      state.arcs.filter((a) => a.chosen),
      state.convergeRadius,
    );
  }

  prevW = w;
  prevH = h;
  lastResizeAt = performance.now();
}

// ─── フェーズ開始時の初期化 ──────────────────────────────
function onEnter() {
  const { w, h } = getSize();
  const s = state;

  if (s.phase === "SPARKLE") {
    s.sparkles = createSparkles(w, h);
  }

  if (s.phase === "SPARKLE_OUT") {
    // SPARKLE終了時点での各スパークルの opacity を記録
    const spTotal = PHASE_DURATIONS["SPARKLE"];
    s.sparkles.forEach((sp) => {
      const spElapsed = spTotal - sp.delay;
      if (spElapsed <= 0) { sp.transitionAlpha = 0; return; }
      const cycleInterval = sp.duration + sp.gap;
      const cycleT = spElapsed % cycleInterval;
      if (cycleT > sp.duration) { sp.transitionAlpha = 0; return; }
      const progress = cycleT / sp.duration;
      sp.transitionAlpha = sp.peakOpacity * Math.sin(progress * Math.PI);
    });
  }

  if (s.phase === "LINES_IN") {
    s.lines.forEach((l) => {
      l.floatOffset = 0;
      l.bumpOffset = 0;
      l.replacement = undefined;
    });
  }

  if (s.phase === "LINES_HOLD") {
    const count = s.lines.length;
    function pickUniq(n) {
      const idx = [];
      while (idx.length < n) {
        const r = Math.floor(Math.random() * count);
        if (!idx.includes(r)) idx.push(r);
      }
      return idx;
    }
    function makeBatch(idxs, waveOffset) {
      const total = idxs.length;
      return idxs.map((i, batchIdx) => {
        const line = s.lines[i];
        const even = batchIdx / (total - 1);
        const jitter = (Math.random() - 0.5) * (0.9 / total);
        const arrivalDelay =
          waveOffset + Math.min(Math.max(even * 0.92 + jitter, 0), 0.94);
        return {
          targetLineIdx: i,
          y: line.targetY,
          width: line.width,
          lineHeight: line.lineHeight,
          gradType: (() => { const _r = Math.random(); return _r < 0.10 ? 0 : _r < 0.20 ? 1 : 2; })(),
          baseOpacity: 1,
          shimmerSpeed: 0.00004 + Math.random() * 0.00007,
          shimmerOffset: Math.random(),
          shimmerWidth: 0.02 + Math.random() * 0.06,
          lightCount: Math.random() < 0.5 ? 1 : 2,
          arrivalDelay,
          headX: -line.width,
          arrived: false,
        };
      });
    }
    s.lateLines = [...makeBatch(pickUniq(45), 0.02)];
  }

  if (s.phase === "LINES_OUT") {
    s.lateLines = [];
    s.lines.forEach((l) => {
      l.bumpOffset = 0;
      l.replacement = undefined;
    });
  }

  if (s.phase === "WAVES") {
    s.waves = createWaves(h);
    const maxR = maxRadiusForSize(w, h);
    s.arcs.forEach((arc, i) => {
      arc.radius = maxR * (0.15 + (i / 24) * 0.65);
      arc.startAngle = Math.random() * Math.PI * 2;
      arc.endAngle = arc.startAngle + Math.PI * 0.35 + Math.random() * Math.PI * 0.9;
      arc.rotation = Math.random() * Math.PI * 2;
      arc.rotationSpeed = (Math.random() < 0.5 ? 1 : -1) * (0.006 + Math.random() * 0.012);
      arc.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      arc.lineWidth = arc.chosen ? 9 + Math.random() * 5 : 5 + Math.random() * 6;
      const agt = Math.floor(Math.random() * 3);
      arc.gradType = agt;
      arc.shimmerWidth = 0.02 + Math.random() * (agt === 2 ? 0.08 : 0.05);
      arc.lightCount = Math.random() < 0.5 ? 1 : 2;
    });
  }

  if (s.phase === "WAVES_OUT") {
    const waveEndElapsed = state.phaseStart - holdStart;
    const center = s.waves[Math.floor(s.waves.length / 2)];
    const refPhase = waveEndElapsed * center.phaseSpeed + center.phaseOffset;
    const refAmplitude = s.waves.reduce((sum, wv) => sum + wv.amplitude, 0) / s.waves.length;
    s.waves.forEach((wv) => {
      wv.snapAmplitude = wv.amplitude;
      wv.snapPhase = waveEndElapsed * wv.phaseSpeed + wv.phaseOffset;
      wv.refPhase = refPhase;
      wv.refAmplitude = refAmplitude;
      wv.refPhaseSpeed = center.phaseSpeed;
    });
  }

  if (s.phase === "ARCS_CONVERGE") {
    const cx = w / 2;
    const cy = h / 2;
    s.convergeRadius = Math.min(cx * 0.9, cy * 0.9);
    s.arcs.forEach((arc) => {
      arc.snapRadius = arc.radius;
      arc.snapStartAngle = arc.startAngle;
      arc.snapArcLen = arc.endAngle - arc.startAngle;
    });
    buildRingSegments(
      s.arcs.filter((a) => a.chosen),
      s.convergeRadius,
    );
    s.ringRotation = 0;
    s.ringRotSpeed = 0.007 + Math.random() * 0.006;
  }
}

// ─── フェーズ遷移 ────────────────────────────────────────
function goTo(phase, now) {
  state.phase = phase;
  state.phaseStart = now;
  if (phase === "LINES_IN") {
    // タイマーは LINES_IN 開始から計測（LINES_HOLD まで継続）
    holdStart = now;
    holdDuration = PHASE_DURATIONS["LINES_IN"] + STAGE_AUTOPLAY[stage];
  } else if (HOLD_PHASES.has(phase) && phase !== "LINES_HOLD") {
    // LINES_HOLD は LINES_IN で設定した holdStart を継続使用
    holdStart = now;
    holdDuration = STAGE_AUTOPLAY[stage];
  }
  onEnter();
}

function nextPhase(now) {
  const s = state;
  const cur = s.phase;

  if (HOLD_PHASES.has(cur)) {
    advanceRequested = false;
    stage = (stage + 1) % 4;
    goTo(STAGE_PHASES[stage][0], now);
    return;
  }

  const stagePhasesArr = STAGE_PHASES[stage];
  const idx = stagePhasesArr.indexOf(cur);
  if (idx >= 0 && idx < stagePhasesArr.length - 1) {
    goTo(stagePhasesArr[idx + 1], now);
  } else {
    goTo(stagePhasesArr[0], now);
  }
}

// ─── グラデーション生成 ──────────────────────────────────
// type 0: #C60021(赤) → #76736C(グレー) → #FFFFFF 混合
// type 1: #C60021(赤) → #FFFFFF シンプル
// type 2: Figmaグレー (#E1DFDF → #FEFEFE → #807676)
// type 3: ウェーブ/アーク専用 (#DAD5D5 → #FFFFFF → #76736C)
function makeGrad(type, shimmerOffset, w, shimmerWidth, lightCount, elemX0, elemW) {
  const useElem = type === 0 && elemW !== undefined;
  const tileW = useElem ? elemW : (type === 2 ? w / 3 : w);
  const scaledOffset = useElem ? shimmerOffset * (w / elemW) * 0.15 : shimmerOffset;
  const scroll = (scaledOffset % 1) * tileW;
  const gx0 = (useElem ? (elemX0 || 0) : 0) - scroll;
  const grad = ctx.createLinearGradient(gx0, 0, gx0 + tileW * 3, 0);
  const sw = shimmerWidth || 0.04;
  const lc = lightCount || 1;
  for (let tile = 0; tile < 3; tile++) {
    const o = tile / 3;
    const sv = 1 / 3;
    const c = (v) => Math.min(o + sv * Math.min(Math.max(v, 0.001), 0.998), 0.9999);
    if (type === 1) {
      if (lc === 1) {
        const hw = sw / 2;
        const ls = Math.max(0.01, 0.50 - hw);
        const le = Math.min(0.98, 0.50 + hw);
        grad.addColorStop(c(0.00),  "#c60021");
        grad.addColorStop(c(ls),    "#c60021");
        grad.addColorStop(c(0.50),  "#ffffff");
        grad.addColorStop(c(le),    "#c60021");
        grad.addColorStop(c(0.998), "#c60021");
      } else {
        const hw = sw * 0.45;
        const l1 = 0.28, l2 = 0.72;
        const l1s = Math.max(0.01, l1 - hw), l1e = Math.min(0.48, l1 + hw);
        const l2s = Math.max(0.52, l2 - hw), l2e = Math.min(0.98, l2 + hw);
        grad.addColorStop(c(0.00),  "#c60021");
        grad.addColorStop(c(l1s),   "#c60021");
        grad.addColorStop(c(l1),    "#ffffff");
        grad.addColorStop(c(l1e),   "#c60021");
        grad.addColorStop(c(l2s),   "#c60021");
        grad.addColorStop(c(l2),    "#ffffff");
        grad.addColorStop(c(l2e),   "#c60021");
        grad.addColorStop(c(0.998), "#c60021");
      }
    } else if (type === 2) {
      if (lc === 1) {
        grad.addColorStop(c(0.000), "#e1dfdf");
        grad.addColorStop(c(0.096), "#e9e7e7");
        grad.addColorStop(c(0.200), "#fefefe");
        grad.addColorStop(c(0.695), "#807676");
        grad.addColorStop(c(0.901), "#ebebeb");
        grad.addColorStop(c(0.999), "#e1e0e0");
      } else {
        grad.addColorStop(c(0.000), "#e1dfdf");
        grad.addColorStop(c(0.048), "#e9e7e7");
        grad.addColorStop(c(0.100), "#fefefe");
        grad.addColorStop(c(0.348), "#807676");
        grad.addColorStop(c(0.450), "#ebebeb");
        grad.addColorStop(c(0.500), "#e1e0e0");
        grad.addColorStop(c(0.548), "#e9e7e7");
        grad.addColorStop(c(0.600), "#fefefe");
        grad.addColorStop(c(0.848), "#807676");
        grad.addColorStop(c(0.950), "#ebebeb");
        grad.addColorStop(c(0.999), "#e1e0e0");
      }
    } else if (type === 3) {
      grad.addColorStop(c(0.00),  "#dad5d5");
      grad.addColorStop(c(0.22),  "#dad5d5");
      grad.addColorStop(c(0.27),  "#ffffff");
      grad.addColorStop(c(0.30),  "#76736c");
      grad.addColorStop(c(0.37),  "#dad5d5");
      grad.addColorStop(c(0.70),  "#dad5d5");
      grad.addColorStop(c(0.77),  "#ffffff");
      grad.addColorStop(c(0.82),  "#76736c");
      grad.addColorStop(c(0.90),  "#dad5d5");
      grad.addColorStop(c(0.998), "#dad5d5");
    } else {
      // type 0
      grad.addColorStop(c(0.00),  "#c60021");
      grad.addColorStop(c(0.22),  "#c60021");
      grad.addColorStop(c(0.27),  "#76736c");
      grad.addColorStop(c(0.30),  "#ffffff");
      grad.addColorStop(c(0.37),  "#dddddd");
      grad.addColorStop(c(0.44),  "#c60021");
      grad.addColorStop(c(0.70),  "#c60021");
      grad.addColorStop(c(0.77),  "#76736c");
      grad.addColorStop(c(0.82),  "#ffffff");
      grad.addColorStop(c(0.90),  "#c60021");
      grad.addColorStop(c(0.998), "#c60021");
    }
  }
  return grad;
}

// ─── 描画関数 ────────────────────────────────────────────
function drawWaveLine(wv, _i, x0, x1, y, amplitude, wavePhase, alpha, w, tiltRaise, convCenter, convFactor, sharedOffset) {
  const lineLen = x1 - x0;
  if (lineLen < 1 || alpha <= 0) return;
  const offset = sharedOffset !== undefined
    ? sharedOffset
    : (wv.shimmerOffset = shiftShimmer(wv.shimmerOffset, wv.shimmerSpeed), wv.shimmerOffset);
  const segments = Math.max(20, Math.round(lineLen / 8));
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(alpha, 1));
  ctx.strokeStyle = makeGrad(wv.gradType ?? 0, offset, w, wv.shimmerWidth, wv.lightCount);
  ctx.lineWidth = wv.lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let j = 0; j <= segments; j++) {
    const frac = j / segments;
    const x = x0 + lineLen * frac;
    const xNorm = x / w;
    const baseY = (convCenter != null)
      ? convCenter + (y - convCenter) * (1 - (convFactor || 0) * xNorm)
      : y;
    const yOff = amplitude * Math.sin(wv.frequency * Math.PI * 2 * xNorm + wavePhase);
    const yTilt = tiltRaise ? -tiltRaise * xNorm : 0;
    if (j === 0) ctx.moveTo(x, baseY + yOff + yTilt);
    else ctx.lineTo(x, baseY + yOff + yTilt);
  }
  ctx.stroke();
  ctx.restore();
}

function drawArc(arc, _i, cx, cy, opacity, w) {
  if (arc.radius < 1) return;
  arc.shimmerOffset = shiftShimmer(arc.shimmerOffset, arc.shimmerSpeed);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(arc.rotation);
  ctx.beginPath();
  ctx.arc(0, 0, arc.radius, arc.startAngle, arc.endAngle);
  ctx.strokeStyle = makeGrad(3, arc.shimmerOffset, w, arc.shimmerWidth, arc.lightCount);
  // ctx.globalAlpha = Math.max(0, Math.min(opacity * (arc.baseOpacity || 1), 1));
  ctx.globalAlpha = Math.max(0, Math.min(opacity * 0.3, 1));
  ctx.lineWidth = arc.lineWidth;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.restore();
}

function drawRing(cx, cy, radius, ringRot, opacity, lw, w) {
  state.arcs
    .filter((a) => a.chosen)
    .forEach((arc) => {
      arc.shimmerOffset = shiftShimmer(arc.shimmerOffset, arc.shimmerSpeed);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringRot);
      ctx.beginPath();
      ctx.arc(0, 0, radius, arc.ringStartAngle, arc.ringStartAngle + arc.ringArcLen);
      ctx.strokeStyle = makeGrad(arc.gradType ?? 0, arc.shimmerOffset, w, arc.shimmerWidth, arc.lightCount);
      ctx.globalAlpha = Math.max(0, Math.min(opacity * (arc.baseOpacity || 1), 1));
      ctx.lineWidth = lw || arc.lineWidth;
      ctx.lineCap = "butt";
      ctx.stroke();
      ctx.restore();
    });
}

// ─── メインループ ────────────────────────────────────────
function draw(now) {
  const s = state;
  const { w, h } = getSize();
  const cx = w / 2;
  const cy = h / 2;
  const maxR = maxRadiusForSize(w, h);
  const isHoldPhase = HOLD_PHASES.has(s.phase);
  const showTimer = s.phase === "LINES_IN" || isHoldPhase;

  const elapsed = now - s.phaseStart;
  const phaseDur = PHASE_DURATIONS[s.phase] || 1000;
  let t = Math.min(elapsed / phaseDur, 1);

  if (showTimer) {
    const progress = Math.min((now - holdStart) / holdDuration, 1);
    if (timerArc) timerArc.style.strokeDashoffset = `${TIMER_CIRCUMFERENCE * (1 - progress)}`;
    if (isHoldPhase && progress >= 1) advanceRequested = true;
    if (advanceRequested) t = 1;
  } else if (timerArc) {
    timerArc.style.strokeDashoffset = `${TIMER_CIRCUMFERENCE}`;
  }

  if (t >= 1) {
    if (isHoldPhase && !advanceRequested) {
      t = 1;
    } else {
      nextPhase(now);
      rafId = requestAnimationFrame(draw);
      return;
    }
  }

  ctx.clearRect(0, 0, w, h);

  const phase = s.phase;

  // ── SPARKLE ──────────────────────────────────────────
  if (phase === "SPARKLE") {
    s.sparkles.forEach((sp) => {
      const spElapsed = elapsed;
      if (spElapsed < 0) return;
      const cycleInterval = sp.duration + sp.gap;
      const cycleT = spElapsed % cycleInterval;
      if (cycleT > sp.duration) return;
      const progress = Math.min(cycleT / (sp.duration * 0.6), 1);
      const alpha = sp.peakOpacity * Math.pow(Math.sin(progress * Math.PI), 6);
      if (alpha <= 0) return;

      const scale = easeOut(Math.min(progress * 2, 1)) * 0.85 + 0.15;
      const rot = sp.baseRotation + progress * Math.PI * 0.3;

      ctx.save();
      ctx.translate(sp.x, sp.y);

      const drawStar = (armLen, tipW, rotation, opacityMul) => {
        ctx.save();
        ctx.globalAlpha = alpha * opacityMul;
        const a = armLen * scale, tw = tipW * scale;
        ctx.fillStyle = sp.color = "#dcdcdc";
        ctx.shadowBlur = sp.size * 0.2;
        ctx.shadowColor = "rgba(255,255,255,0.9)";
        ctx.rotate(rotation);
        ctx.beginPath();
        ctx.moveTo(0, -a);
        ctx.lineTo(tw, -tw);
        ctx.lineTo(a, 0);
        ctx.lineTo(tw, tw);
        ctx.lineTo(0, a);
        ctx.lineTo(-tw, tw);
        ctx.lineTo(-a, 0);
        ctx.lineTo(-tw, -tw);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };

      drawStar(sp.size, sp.size * 0.045, rot, 0.9);
      drawStar(sp.size, sp.size * 0.045, rot + Math.PI / 4, 0.7);
      drawStar(sp.size * 0.54, sp.size * 0.045, -rot * 0.7 + sp.baseRotation, 0.6);

      ctx.restore();
    });
  }

  // ── SPARKLE_OUT: 星→線に変形して右スライド ───────────
  if (phase === "SPARKLE_OUT") {
    s.sparkles.forEach((sp) => {
      const startAlpha = sp.transitionAlpha ?? 0;
      if (startAlpha <= 0) return;

      const morphT = easeInOut(Math.min(elapsed / (phaseDur * 0.55), 1));
      const slideRaw = Math.max(0, (elapsed - phaseDur * 0.30) / (phaseDur * 0.70));
      const slideX = easeIn(slideRaw) * w * 1.5;
      const alpha = startAlpha * Math.max(0, 1 - easeIn(Math.max(0, (elapsed - phaseDur * 0.45) / (phaseDur * 0.55))));
      if (alpha <= 0) return;

      const a = sp.size;
      const tw = sp.size * 0.045;
      const rh = Math.max(2, sp.size * 0.09);
      const lp = (sv, r) => sv * (1 - morphT) + r * morphT;

      // 星の8頂点 → 矩形の8頂点に補間（左右の腕先は固定）
      const pts = [
        [ lp(0,   0),  lp(-a, -rh) ],
        [ lp(tw,  a),  lp(-tw, -rh) ],
        [ lp(a,   a),  lp(0,   0)  ],
        [ lp(tw,  a),  lp(tw,  rh) ],
        [ lp(0,   0),  lp(a,   rh) ],
        [ lp(-tw, -a), lp(tw,  rh) ],
        [ lp(-a,  -a), lp(0,   0)  ],
        [ lp(-tw, -a), lp(-tw, -rh) ],
      ];

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sp.x + slideX, sp.y);
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  // ── WAVES ────────────────────────────────────────────
  if (phase === "WAVES") {
    const elapsed = now - holdStart;
    const ENTER_MS = 3200;
    const ref = s.waves[0];
    if (ref) ref.shimmerOffset = shiftShimmer(ref.shimmerOffset, ref.shimmerSpeed);
    const sharedOffset = ref ? ref.shimmerOffset : 0;
    s.waves.forEach((wv, i) => {
      const waveStart = wv.arrivalDelay * ENTER_MS;
      const waveElapsed = Math.max(0, elapsed - waveStart);
      if (waveElapsed <= 0) return;
      const entryT = easeOut(Math.min(waveElapsed / (ENTER_MS * 0.65), 1));
      const alpha = Math.min(waveElapsed / 280, 1) * wv.baseOpacity;
      const wavePhase = elapsed * wv.phaseSpeed + wv.phaseOffset;
      const breathe = 1 + 0.08 * Math.sin(elapsed * 0.0009 + wv.phaseOffset);
      const amplitude = wv.amplitude * breathe;
      drawWaveLine(wv, i, 0, lerp(0, w, entryT), wv.targetY, amplitude, wavePhase, alpha, w, h * 0.08, cy, 0.30, sharedOffset);
    });
  }

  // ── WAVES_OUT ────────────────────────────────────────
  if (phase === "WAVES_OUT") {
    const CONVERGE_END = 0.30;
    const STRAIGHT_START = 0.52;
    const STRAIGHT_END = 0.70;
    const SHRINK_START = 0.71;
    const outElapsed = now - s.phaseStart;
    const ref = s.waves[0];
    if (ref) ref.shimmerOffset = shiftShimmer(ref.shimmerOffset, ref.shimmerSpeed);
    const sharedOffset = ref ? ref.shimmerOffset : 0;
    s.waves.forEach((wv, i) => {
      const convT = easeOut(Math.min(t / CONVERGE_END, 1));
      const convergedY = lerp(wv.targetY, cy, convT);
      const syncedAmplitude = lerp(wv.snapAmplitude || wv.amplitude, wv.refAmplitude || wv.amplitude, convT);
      const straightT = easeInOut(Math.min(1, Math.max(0, (t - STRAIGHT_START) / (STRAIGHT_END - STRAIGHT_START))));
      const amplitude = syncedAmplitude * (1 - straightT);
      const shrinkT = easeInOut(Math.max(0, (t - SHRINK_START) / (1 - SHRINK_START)));
      const x0 = lerp(0, cx, shrinkT);
      const x1 = lerp(w, cx, shrinkT);
      if (x1 - x0 < 1) return;
      const fadeStart = SHRINK_START * 0.85;
      const alpha = wv.baseOpacity * (1 - easeIn(Math.max(0, (t - fadeStart) / (1 - fadeStart))));
      if (alpha <= 0) return;
      const syncedPhaseSpeed = lerp(wv.phaseSpeed, wv.refPhaseSpeed || wv.phaseSpeed, convT);
      const wavePhase = lerp(wv.snapPhase, wv.refPhase || wv.snapPhase, convT) + outElapsed * syncedPhaseSpeed;
      const tiltFade = 1 - convT;
      drawWaveLine(wv, i, x0, x1, convergedY, amplitude, wavePhase, alpha, w, h * 0.08 * tiltFade, null, null, sharedOffset);
    });
  }

  // ── ARCS_CONVERGE ────────────────────────────────────
  if (phase === "ARCS_CONVERGE") {
    s.ringRotation += s.ringRotSpeed;
    s.arcs.forEach((arc, i) => {
      arc.rotation += arc.rotationSpeed * 5;
      if (arc.chosen) {
        arc.radius = lerp(arc.snapRadius, s.convergeRadius, easeOut(t));
        arc.endAngle = arc.startAngle + lerp(arc.snapArcLen, arc.ringArcLen, easeInOut(t));
        drawArc(arc, i, cx, cy, 1 - easeIn(Math.max(0, (t - 0.7) / 0.3)), w);
      } else {
        arc.radius += 0.6;
        const prog = arc.radius / maxR;
        const opacity =
          (1 - easeInOut(Math.min(t * 1.4, 1))) * (prog < 0.9 ? 1 : 1 - (prog - 0.9) / 0.1);
        drawArc(arc, i, cx, cy, Math.max(0, opacity), w);
      }
    });
    const ringOpacity = easeOut(Math.max(0, (t - 0.55) / 0.45));
    if (ringOpacity > 0) drawRing(cx, cy, s.convergeRadius, s.ringRotation, ringOpacity, 10, w);
  }

  // ── RING_SPIN ────────────────────────────────────────
  if (phase === "RING_SPIN") {
    s.ringRotation += s.ringRotSpeed;
    drawRing(cx, cy, s.convergeRadius, s.ringRotation, 1, 10, w);
  }

  // ── RING_OUT ─────────────────────────────────────────
  if (phase === "RING_OUT") {
    s.ringRotation += s.ringRotSpeed;
    drawRing(
      cx,
      cy,
      s.convergeRadius * (1 + t * 0.12),
      s.ringRotation,
      1 - easeInOut(t),
      lerp(10, 4, t),
      w,
    );
  }

  // ── LINES_IN / LINES_HOLD / LINES_OUT ────────────────
  if (phase === "LINES_IN" || phase === "LINES_HOLD" || phase === "LINES_OUT") {
    if (phase === "LINES_HOLD" && s.lateLines.length > 0) {
      s.lateLines.forEach((ll) => {
        const lt = Math.max(0, (t - ll.arrivalDelay) / (1 - ll.arrivalDelay));
        if (lt <= 0) return;
        const p = easeOut(Math.min(lt * 10, 1));
        const targetLine = s.lines[ll.targetLineIdx];
        if (targetLine) targetLine.bumpOffset = p * (w + targetLine.width);
      });
    }

    s.lines.forEach((line) => {
      const gtype = line.gradType ?? 0;
      let x0, x1, opacity;

      if (phase === "LINES_IN") {
        const shotStart = line.shotDelay * 0.8;
        const lt = Math.max(0, (t - shotStart) / (1 - shotStart));
        if (lt <= 0) return;
        const p = easeOut(Math.min(lt * 1.4, 1));
        const shapeOff = lineShapeOffset(line.targetY, cy, h);
        x0 = lerp(-line.width, cx - line.width / 2 + line.floatOffset + shapeOff, p);
        x1 = lerp(0, cx + line.width / 2 + line.floatOffset + shapeOff, p);
        opacity = Math.min(lt * 4, 1) * (line.baseOpacity || 1);
        if (opacity <= 0) return;
        line.shimmerOffset = shiftShimmer(line.shimmerOffset, line.shimmerSpeed);
        ctx.save();
        ctx.globalAlpha = Math.max(0, opacity) * 0.9;
        ctx.beginPath();
        ctx.moveTo(x0, line.targetY);
        ctx.lineTo(x1, line.targetY);
        ctx.strokeStyle = makeGrad(gtype, line.shimmerOffset, w, line.shimmerWidth, line.lightCount, x0, line.width);
        ctx.lineWidth = line.lineHeight;
        ctx.lineCap = "butt";
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (phase === "LINES_HOLD") {
        const freeze = t > 0.95;
        if (!freeze) line.floatOffset = (line.floatOffset || 0) + line.floatVx;
        const bump = line.bumpOffset || 0;
        const shapeOff = lineShapeOffset(line.targetY, cy, h);
        x0 = cx - line.width / 2 + line.floatOffset + bump + shapeOff;
        x1 = cx + line.width / 2 + line.floatOffset + bump + shapeOff;
        const exitStart = w * 0.7;
        const exitEnd = w * 1.3;
        const bumpFade = bump > exitStart ? 1 - Math.min((bump - exitStart) / (exitEnd - exitStart), 1) : 1;
        opacity = (line.baseOpacity || 1) * bumpFade;
        if (bump >= exitEnd && !line.replacement) {
          const _rr = Math.random();
          const rgt = _rr < 0.10 ? 0 : _rr < 0.20 ? 1 : 2;
          line.replacement = {
            width: line.width,
            gradType: rgt,
            baseOpacity: 1,
            shimmerSpeed: 0.00004 + Math.random() * 0.00007,
            shimmerOffset: Math.random(),
            shimmerWidth: 0.02 + Math.random() * (rgt === 2 ? 0.08 : 0.05),
            lightCount: Math.random() < 0.5 ? 1 : 2,
            floatVx: (Math.random() - 0.5) * 0.315,
            progress: 0,
            floatOffset: 0,
          };
        }
        if (line.replacement) {
          const rep = line.replacement;
          rep.progress = Math.min(rep.progress + 0.008, 1);
          if (!freeze) rep.floatOffset += rep.floatVx;
          const rp = easeOut(rep.progress);
          const rx0 = lerp(-rep.width, cx - rep.width / 2 + rep.floatOffset + shapeOff, rp);
          const rx1 = lerp(0, cx + rep.width / 2 + rep.floatOffset + shapeOff, rp);
          const repOpacity = Math.min(rep.progress * 5, 1) * rep.baseOpacity;
          if (repOpacity > 0) {
            rep.shimmerOffset = shiftShimmer(rep.shimmerOffset, rep.shimmerSpeed);
            ctx.save();
            ctx.globalAlpha = Math.max(0, repOpacity) * 0.9;
            ctx.beginPath();
            ctx.moveTo(rx0, line.targetY);
            ctx.lineTo(rx1, line.targetY);
            ctx.strokeStyle = makeGrad(rep.gradType ?? 0, rep.shimmerOffset, w, rep.shimmerWidth, rep.lightCount, rx0, rep.width);
            ctx.lineWidth = line.lineHeight;
            ctx.lineCap = "butt";
            ctx.stroke();
            ctx.restore();
          }
        }
        if (opacity <= 0) return;
        line.shimmerOffset = shiftShimmer(line.shimmerOffset, line.shimmerSpeed);
        ctx.save();
        ctx.globalAlpha = Math.max(0, opacity) * 0.9;
        ctx.beginPath();
        ctx.moveTo(x0, line.targetY);
        ctx.lineTo(x1, line.targetY);
        ctx.strokeStyle = makeGrad(gtype, line.shimmerOffset, w, line.shimmerWidth, line.lightCount, x0, line.width);
        ctx.lineWidth = line.lineHeight;
        ctx.lineCap = "butt";
        ctx.stroke();
        ctx.restore();
        return;
      }

      // LINES_OUT: 右へスライドアウト
      const shotStart = line.shotDelay * 0.8;
      const lt = Math.max(0, (t - shotStart) / (1 - shotStart));
      if (lt <= 0) {
        const shapeOff = lineShapeOffset(line.targetY, cy, h);
        const lx0 = cx - line.width / 2 + (line.floatOffset || 0) + shapeOff;
        const lx1 = lx0 + line.width;
        line.shimmerOffset = shiftShimmer(line.shimmerOffset, line.shimmerSpeed);
        ctx.save();
        ctx.globalAlpha = (line.baseOpacity || 1) * 0.9;
        ctx.beginPath();
        ctx.moveTo(lx0, line.targetY);
        ctx.lineTo(lx1, line.targetY);
        ctx.strokeStyle = makeGrad(gtype, line.shimmerOffset, w, line.shimmerWidth, line.lightCount, lx0, line.width);
        ctx.lineWidth = line.lineHeight;
        ctx.lineCap = "butt";
        ctx.stroke();
        ctx.restore();
        return;
      }
      const p = easeOut(Math.min(lt * 1.4, 1));
      const shapeOff = lineShapeOffset(line.targetY, cy, h);
      const startX0 = cx - line.width / 2 + (line.floatOffset || 0) + shapeOff;
      x0 = lerp(startX0, w + line.width, p);
      x1 = x0 + line.width;
      opacity = (1 - Math.min(lt * 1.4, 1)) * (line.baseOpacity || 1);
      if (opacity <= 0) return;
      line.shimmerOffset = shiftShimmer(line.shimmerOffset, line.shimmerSpeed);
      ctx.save();
      ctx.globalAlpha = Math.max(0, opacity) * 0.9;
      ctx.beginPath();
      ctx.moveTo(x0, line.targetY);
      ctx.lineTo(x1, line.targetY);
      ctx.strokeStyle = makeGrad(gtype, line.shimmerOffset, w, line.shimmerWidth, line.lightCount, x0, line.width);
      ctx.lineWidth = line.lineHeight;
      ctx.lineCap = "butt";
      ctx.stroke();
      ctx.restore();
    });

    if (phase === "LINES_HOLD" && s.lateLines.length > 0) {
      s.lateLines.forEach((ll) => {
        const lt = Math.max(0, (t - ll.arrivalDelay) / (1 - ll.arrivalDelay));
        if (lt <= 0) return;
        const p = easeOut(Math.min(lt * 10, 1));
        if (p >= 1) ll.arrived = true;
        const llShapeOff = lineShapeOffset(ll.y, cy, h);
        const x0 = ll.arrived ? cx - ll.width / 2 + llShapeOff : lerp(-ll.width, cx - ll.width / 2 + llShapeOff, p);
        const x1 = ll.arrived ? cx + ll.width / 2 + llShapeOff : lerp(0, cx + ll.width / 2 + llShapeOff, p);
        const opacity = ll.arrived ? ll.baseOpacity : Math.min(lt * 10, 1) * (ll.baseOpacity || 1);
        if (opacity <= 0) return;
        ll.shimmerOffset = shiftShimmer(ll.shimmerOffset, ll.shimmerSpeed);
        ctx.save();
        ctx.globalAlpha = Math.max(0, opacity) * 0.9;
        ctx.beginPath();
        ctx.moveTo(x0, ll.y);
        ctx.lineTo(x1, ll.y);
        ctx.strokeStyle = makeGrad(ll.gradType ?? 0, ll.shimmerOffset, w, ll.shimmerWidth, ll.lightCount, x0, ll.width);
        ctx.lineWidth = ll.lineHeight;
        ctx.lineCap = "butt";
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  rafId = requestAnimationFrame(draw);
}

// ─── 初期化・公開API ─────────────────────────────────────
function init() {
  resize();
  if (timerArc) {
    timerArc.style.strokeDasharray = `${TIMER_CIRCUMFERENCE}`;
    timerArc.style.strokeDashoffset = `${TIMER_CIRCUMFERENCE}`;
  }
  window.addEventListener("resize", resize);
  const now = performance.now();
  goTo("SPARKLE", now);
  rafId = requestAnimationFrame(draw);
}

function requestAdvance() {
  advanceRequested = true;
  if (timerArc) timerArc.style.strokeDashoffset = "0";
}

window.reAnimation = {
  requestAdvance,
};

init();

document.querySelectorAll(".js-text").forEach((el) => {
  const wrapChars = (node, state) => {
    if (node.nodeType === 3) {
      const text = node.textContent;
      const frag = document.createDocumentFragment();

      [...text].forEach((char) => {
        if (char === " ") {
          frag.appendChild(document.createTextNode(" "));
        } else if (char === "\n") {
          frag.appendChild(document.createTextNode("\n"));
        } else {
          const span = document.createElement("span");
          span.className = "char";
          span.textContent = char;
          span.style.animationDelay = `${state.delay}s`;
          state.delay += 0.025;
          frag.appendChild(span);
        }
      });

      node.parentNode.replaceChild(frag, node);
      return;
    }

    if (node.nodeType === 1) {
      [...node.childNodes].forEach((child) => wrapChars(child, state));
    }
  };

  wrapChars(el, { delay: 0.8 });
});
