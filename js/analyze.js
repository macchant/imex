// js/analyze.js
// Stage 1 — deterministic image analysis. No models, no network. Pure JS.
// Output is the most reliable part of the schema and grounds the VLM downstream.

const MAX_DIM = 384; // downscale for analysis; perceptual signals don't need full res

/** Load an image file into a downscaled Canvas + ImageData. */
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { url, img, canvas: cv, ctx, data, w0, h0, w, h };
}

// ---------- Aspect ratio ----------
export function aspectRatio(w, h) {
  // common ratios snapped, otherwise simplified fraction
  const candidates = [
    [1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16],
    [16, 10], [10, 16], [21, 9], [9, 21], [5, 4], [4, 5], [7, 5], [5, 7],
  ];
  const r = w / h;
  let best = candidates[0], bestErr = Infinity;
  for (const [a, b] of candidates) {
    const err = Math.abs(r - a / b) / (a / b);
    if (err < bestErr) { bestErr = err; best = [a, b]; }
  }
  if (bestErr < 0.03) return `${best[0]}:${best[1]}`;
  // gcd-simplify
  const g = (a, b) => b ? g(b, a % b) : a;
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

// ---------- Color space helpers ----------
function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  ];
}
function xyzToLab(X, Y, Z) {
  // D65
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(X / xn), fy = f(Y / yn), fz = f(Z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function rgbToLab(r, g, b) { const [X, Y, Z] = rgbToXyz(r, g, b); return xyzToLab(X, Y, Z); }
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
}

// ---------- Palette: k-means in LAB ----------
export function extractPalette(imgData, k = 6, iters = 8) {
  const { data, width, height } = imgData;
  // Sample on a grid for speed
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  const points = []; // [L,a,b,r,g,b]
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 24) continue; // ignore near-transparent
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [L, A, B] = rgbToLab(r, g, b);
      points.push([L, A, B, r, g, b]);
    }
  }
  if (points.length === 0) return [];

  // k-means++ init
  const centroids = [points[Math.floor(Math.random() * points.length)].slice(0, 3)];
  while (centroids.length < k) {
    const dists = points.map(p => Math.min(...centroids.map(c => sqd(p, c))));
    const sum = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum, idx = 0;
    for (let i = 0; i < dists.length; i++) { r -= dists[i]; if (r <= 0) { idx = i; break; } }
    centroids.push(points[idx].slice(0, 3));
  }

  const assignments = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    // assign
    for (let i = 0; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = sqd(points[i], centroids[c]);
        if (d < bd) { bd = d; best = c; }
      }
      assignments[i] = best;
    }
    // update
    const sums = centroids.map(() => [0, 0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const a = assignments[i], p = points[i], s = sums[a];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2];
      s[3] += p[3]; s[4] += p[4]; s[5] += p[5]; s[6]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      const s = sums[c];
      if (s[6] > 0) centroids[c] = [s[0] / s[6], s[1] / s[6], s[2] / s[6], s[3] / s[6], s[4] / s[6], s[5] / s[6]];
    }
  }

  // Build palette with weights and avg RGB per cluster
  const counts = new Array(centroids.length).fill(0);
  const rgbSums = centroids.map(() => [0, 0, 0]);
  for (let i = 0; i < points.length; i++) {
    counts[assignments[i]]++;
    const p = points[i], r = rgbSums[assignments[i]];
    r[0] += p[3]; r[1] += p[4]; r[2] += p[5];
  }
  const palette = centroids.map((c, i) => {
    const n = Math.max(1, counts[i]);
    const r = rgbSums[i][0] / n, g = rgbSums[i][1] / n, bb = rgbSums[i][2] / n;
    return {
      hex: rgbToHex(r, g, bb),
      rgb: [Math.round(r), Math.round(g), Math.round(bb)],
      lab: c,
      weight: counts[i] / points.length,
      name: nameColor(c, [r, g, bb]),
    };
  }).sort((a, b) => b.weight - a.weight);

  return palette;
}

function sqd(a, b) {
  const d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

// Cheap perceptual color naming. Not exhaustive — gives the LLM useful seeds.
function nameColor(lab, rgb) {
  const [L, A, B] = lab;
  const [r, g, b] = rgb;
  const C = Math.sqrt(A * A + B * B); // chroma
  const h = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360; // hue angle

  // Neutrals
  if (C < 8) {
    if (L > 92) return 'off-white';
    if (L > 75) return 'light grey';
    if (L > 50) return 'mid grey';
    if (L > 25) return 'charcoal';
    return 'near black';
  }

  let hueName = 'red';
  if (h < 20) hueName = 'red';
  else if (h < 45) hueName = 'orange';
  else if (h < 70) hueName = 'yellow';
  else if (h < 100) hueName = 'lime';
  else if (h < 160) hueName = 'green';
  else if (h < 200) hueName = 'teal';
  else if (h < 250) hueName = 'blue';
  else if (h < 290) hueName = 'purple';
  else if (h < 330) hueName = 'magenta';
  else hueName = 'pink';

  const tone = L > 75 ? 'pale ' : L > 55 ? '' : L > 30 ? 'deep ' : 'dark ';
  const sat = C < 25 ? 'muted ' : C > 60 ? 'vivid ' : '';
  return (tone + sat + hueName).trim();
}

// ---------- Background isolation detector ----------
// Sample border pixels; if low variance + (white | transparent | black), mark isolated.
export function detectIsolation(imgData) {
  const { data, width, height } = imgData;
  const samples = [];
  let transparentBorder = 0, total = 0;
  const sampleEdge = (x, y) => {
    const i = (y * width + x) * 4;
    total++;
    if (data[i + 3] < 32) { transparentBorder++; return; }
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  const step = Math.max(1, Math.floor(width / 40));
  for (let x = 0; x < width; x += step) { sampleEdge(x, 0); sampleEdge(x, height - 1); }
  for (let y = 0; y < height; y += step) { sampleEdge(0, y); sampleEdge(width - 1, y); }

  const transparentRatio = transparentBorder / total;
  if (transparentRatio > 0.6) {
    return { isolated: true, kind: 'transparent', confidence: 0.95, bgColor: null };
  }
  if (samples.length === 0) return { isolated: false, kind: 'unknown', confidence: 0.2, bgColor: null };

  // Mean & variance
  const mean = [0, 0, 0];
  for (const s of samples) { mean[0] += s[0]; mean[1] += s[1]; mean[2] += s[2]; }
  mean[0] /= samples.length; mean[1] /= samples.length; mean[2] /= samples.length;
  let varr = 0;
  for (const s of samples) {
    varr += (s[0] - mean[0]) ** 2 + (s[1] - mean[1]) ** 2 + (s[2] - mean[2]) ** 2;
  }
  varr /= samples.length;

  const lum = 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2];
  const lowVar = varr < 400; // tight threshold

  let kind = 'scene';
  if (lowVar && lum > 235) kind = 'white';
  else if (lowVar && lum < 20) kind = 'black';
  else if (lowVar) kind = 'flat';

  const isolated = lowVar;
  return {
    isolated,
    kind,
    confidence: isolated ? 0.85 : 0.4,
    bgColor: lowVar ? rgbToHex(mean[0], mean[1], mean[2]) : null,
  };
}

// ---------- Vector-likeness ----------
// Combines: unique-color count after quantization, gradient sharpness, alpha presence.
export function vectorLikeness(imgData) {
  const { data, width, height } = imgData;
  // Quantize each channel to 5 bits => 32^3 buckets, count unique
  const seen = new Set();
  let alphaCount = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    if (data[i + 3] < 250) alphaCount++;
    const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3;
    seen.add((r << 10) | (g << 5) | b);
  }
  const uniqueRatio = seen.size / Math.min(total, 32768);

  // Sobel-ish gradient sharpness sample
  const stride = 4;
  let sharpEdges = 0, softEdges = 0, edgeCount = 0;
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const i = (y * width + x) * 4;
      const il = i - 4, ir = i + 4;
      const it = i - width * 4, ib = i + width * 4;
      const gx = (data[ir] - data[il]) + (data[ir + 1] - data[il + 1]) + (data[ir + 2] - data[il + 2]);
      const gy = (data[ib] - data[it]) + (data[ib + 1] - data[it + 1]) + (data[ib + 2] - data[it + 2]);
      const m = Math.abs(gx) + Math.abs(gy);
      if (m > 60) {
        edgeCount++;
        if (m > 220) sharpEdges++; else softEdges++;
      }
    }
  }
  const sharpRatio = edgeCount ? sharpEdges / edgeCount : 0;
  const alphaRatio = alphaCount / total;

  // Score: fewer unique colors + sharper edges + alpha presence => more vector-like
  const colorScore = 1 - Math.min(1, uniqueRatio * 8);   // 0..1, high = few colors
  const score = colorScore * 0.5 + sharpRatio * 0.35 + Math.min(1, alphaRatio * 4) * 0.15;

  let label = 'photo / 3D render';
  if (score > 0.75) label = 'flat vector';
  else if (score > 0.55) label = 'stylized illustration';
  else if (score > 0.35) label = 'painterly / digital art';

  return {
    score: Math.round(score * 100) / 100,
    label,
    uniqueColors: seen.size,
    sharpEdgeRatio: Math.round(sharpRatio * 100) / 100,
    hasAlpha: alphaRatio > 0.01,
  };
}

// ---------- Edge density (linework signal) ----------
export function edgeDensity(imgData) {
  const { data, width, height } = imgData;
  let edges = 0, total = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const il = i - 4, ir = i + 4;
      const it = i - width * 4, ib = i + width * 4;
      const gx = (data[ir] - data[il]);
      const gy = (data[ib] - data[it]);
      if (Math.abs(gx) + Math.abs(gy) > 80) edges++;
      total++;
    }
  }
  const density = edges / total;
  let label = 'low';
  if (density > 0.18) label = 'high';
  else if (density > 0.08) label = 'medium';
  return { density: Math.round(density * 1000) / 1000, label };
}

// ---------- EXIF (lazy import of exifr from CDN) ----------
export async function readExif(file) {
  try {
    const exifr = await import('https://esm.sh/exifr@7.1.3');
    const out = await exifr.default.parse(file, { tiff: true, xmp: true, icc: false, iptc: true, exif: true, gps: false });
    if (!out) return null;
    // Look for AI generator hints
    const aiHints = [];
    const blob = JSON.stringify(out).toLowerCase();
    for (const k of ['midjourney', 'stable diffusion', 'dall-e', 'dalle', 'leonardo', 'ideogram', 'flux', 'sdxl', 'comfyui', 'automatic1111', 'firefly', 'imagen']) {
      if (blob.includes(k)) aiHints.push(k);
    }
    return { ...out, _aiHints: aiHints };
  } catch (e) {
    console.warn('EXIF parse failed', e);
    return null;
  }
}
