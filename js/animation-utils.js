(function () {
  // ─── 定数 ───────────────────────────────────────────────
  const COLORS = [
    "#8b1a1a",
    "#cc2929",
    "#e8630a",
    "#c0c0c0",
    "#ffffff",
    "#a01020",
    "#d44025",
    "#e87a20",
    "#c43c2a",
  ];

  const ARC_COUNT = 24;
  const CHOSEN_COUNT = 12;

  const PHASE_DURATIONS = {
    ARCS_CONVERGE: 2200,
    RING_SPIN: 10000,
    RING_OUT: 900,
    BLANK_1: 400,
    SPARKLE: 4500,
    SPARKLE_OUT: 1400,
    LINES_IN: 1500,
    LINES_HOLD: 10000,
    LINES_OUT: 2500,
    BLANK_3: 400,
    WAVES: 10000,
    WAVES_OUT: 2200,
  };

  const STAGE_PHASES = [
    ["RING_OUT", "BLANK_1", "SPARKLE"],
    ["SPARKLE_OUT", "LINES_IN", "LINES_HOLD"],
    ["LINES_OUT", "BLANK_3", "WAVES"],
    ["WAVES_OUT", "ARCS_CONVERGE", "RING_SPIN"],
  ];

  const HOLD_PHASES = new Set([
    "WAVES",
    "RING_SPIN",
    "SPARKLE",
    "LINES_HOLD",
  ]);

  const STAGE_AUTOPLAY = [4500, 4500, 5000, 5500];

  // ─── 数学ユーティリティ ──────────────────────────────────
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeIn(t) {
    return t * t * t;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function shiftShimmer(offset, speed) {
    let next = offset - speed * 16;
    if (next < 0) next += 1;
    return next;
  }

  // ─── ジオメトリ計算 ──────────────────────────────────────
  function lineShapeOffset(targetY, cy, h) {
    const distNorm = Math.abs(targetY - cy) / (h * 0.55);
    const isSp = window.innerWidth <= 768;
    const factor = window.innerWidth * (isSp ? 0.18 : 0.15);
    return factor * (1 - 2 * distNorm);
  }

  function buildRingSegments(chosenArcs, ringRadius) {
    const count = chosenArcs.length;
    const rawArcs = Array.from({ length: count }, () => 0.5 + Math.random());
    const sumArcs = rawArcs.reduce((a, b) => a + b, 0);
    const arcLens = rawArcs.map((a) => (a / sumArcs) * Math.PI * 2);
    let angle = 0;
    chosenArcs.forEach((arc, idx) => {
      arc.ringStartAngle = angle;
      arc.ringArcLen = arcLens[idx];
      arc.ringRadius = ringRadius;
      angle += arcLens[idx];
    });
  }

  // ─── データ生成 ──────────────────────────────────────────
  function createArcs(cx, cy) {
    const maxR = Math.min(cx, cy) * 1.05;
    return Array.from({ length: ARC_COUNT }, (_, i) => {
      const arcLen = Math.PI * 0.35 + Math.random() * Math.PI * 0.9;
      const startAngle = Math.random() * Math.PI * 2;
      const chosen = i < CHOSEN_COUNT;
      const gt = Math.floor(Math.random() * 3);
      return {
        id: i,
        chosen,
        radius: (i / ARC_COUNT) * maxR * 0.3,
        startAngle,
        endAngle: startAngle + arcLen,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed:
          (Math.random() < 0.5 ? 1 : -1) * (0.006 + Math.random() * 0.012),
        color: COLORS[i % COLORS.length],
        lineWidth: chosen ? 9 + Math.random() * 5 : 5 + Math.random() * 6,
        baseOpacity: 1,
        shimmerSpeed: 0.00004 + Math.random() * 0.00007,
        shimmerOffset: Math.random(),
        gradType: gt,
        shimmerWidth: 0.02 + Math.random() * (gt === 2 ? 0.08 : 0.05),
        lightCount: Math.random() < 0.5 ? 1 : 2,
        snapRadius: 0,
        snapStartAngle: 0,
        snapArcLen: 0,
        ringStartAngle: 0,
        ringArcLen: 0,
        ringRadius: 0,
      };
    });
  }

  function createLines(w, h) {
    const count = 100;
    const cy = h / 2;
    const isSp = window.innerWidth <= 768;
    const spread = isSp ? h * 0.9 : h * 1.1;
    const lineHeight = Math.ceil((spread / (count - 1)) * 0.6) + 1;
    return Array.from({ length: count }, (_, i) => {
      const frac = i / (count - 1);
      const targetY = cy - spread / 2 + frac * spread;
      const _gr = Math.random();
      const gt = _gr < 0.10 ? 0 : _gr < 0.20 ? 1 : 2;
      return {
        y: targetY,
        targetY,
        lineHeight,
        width: w * 0.18,
        color: COLORS[i % COLORS.length],
        gradType: gt,
        offsetX: 0,
        baseOpacity: 1,
        shimmerSpeed: 0.00004 + Math.random() * 0.00007,
        shimmerOffset: Math.random(),
        shimmerWidth: 0.02 + Math.random() * (gt === 2 ? 0.08 : 0.05),
        lightCount: Math.random() < 0.5 ? 1 : 2,
        shotDelay: Math.random() * 0.6,
        floatVx: 0,
        floatOffset: 0,
        bumpOffset: 0,
        replacement: undefined,
      };
    });
  }

  function createWaves(h) {
    const count = 10;
    const cy = h / 2;
    const spread = h * 0.34;
    const baseFreq = 1.1;
    const baseSpeed = 0.00155;
    return Array.from({ length: count }, (_, i) => {
      const frac = i / (count - 1);
      const targetY = cy - spread / 2 + frac * spread;
      const phaseOffset = (frac - 0.5) * 0.25 + (Math.random() - 0.5) * 0.08;
      return {
        targetY,
        amplitude: h * 0.070 + Math.random() * h * 0.025,
        frequency: baseFreq + (Math.random() - 0.5) * 0.15,
        phaseOffset,
        phaseSpeed: baseSpeed + (Math.random() - 0.5) * 0.0002,
        color: COLORS[i % COLORS.length],
        lineWidth: 5 + Math.random() * 4,
        baseOpacity: 1,
        shimmerSpeed: 0.00004 + Math.random() * 0.00007,
        shimmerOffset: Math.random(),
        gradType: 0,
        shimmerWidth: 0.02 + Math.random() * 0.05,
        lightCount: 2,
        arrivalDelay: frac * 0.22,
        snapAmplitude: 0,
        snapPhase: 0,
      };
    });
  }

  function createSparkles(w, h) {
    const sparkleColors = ["#c60021", "#76736c", "#ffffff"];
    return Array.from({ length: 22 }, () => ({
      x: w * 0.05 + Math.random() * w * 0.90,
      y: h * 0.05 + Math.random() * h * 0.90,
      size: 16 + Math.random() * 36,
      delay: Math.random() * 1800,
      duration: 1000 + Math.random() * 600,
      gap: 400 + Math.random() * 700,
      peakOpacity: 0.55 + Math.random() * 0.45,
      baseRotation: Math.random() * Math.PI * 2,
      color: sparkleColors[Math.floor(Math.random() * sparkleColors.length)],
    }));
  }

  // ─── エクスポート ────────────────────────────────────────
  window.ReAnimUtils = {
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
  };
})();
