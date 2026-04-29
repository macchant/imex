// js/synthesize.js
// Stage 4 — Convert the fused schema into a model-specific prompt string.
// Mirrors vectorgen's Multi-Model Syntax Engine.

export function synthesize(schema, target, options = {}) {
  const fns = { midjourney, ideogram, leonardo, flux, kreaflux, nanobananapro, imagen4, recraftv3, sdxl, dalle3 };
  const fn = fns[target] || midjourney;
  return fn(schema, options);
}

// ---------- helpers ----------
function joinClean(parts) {
  return parts.filter(Boolean).map(s => String(s).trim()).filter(Boolean).join(', ');
}

function styleClause(s) {
  if (!s?.primary) return '';
  const mods = (s.modifiers || []).filter(m => m && m.toLowerCase() !== s.primary.toLowerCase());
  return joinClean([s.primary, ...mods.slice(0, 2)]);
}

function paletteClause(palette) {
  if (!palette?.length) return '';
  const top = palette.slice(0, 4);
  return `color palette ${top.map(p => `${p.name} (${p.hex})`).join(' / ')}`;
}

function isolationClause(schema, options) {
  const wantsIso = options.isolated || schema.background?.isolated;
  if (!wantsIso) return '';
  const transparent = schema.background?.kind === 'transparent';
  return transparent ? 'die-cut, transparent background, centered' : 'die-cut, white background, centered';
}

function knollingClause(options) {
  return options.knolling ? 'knolling layout, sticker sheet grid, evenly spaced, top-down flat lay' : '';
}

// ---------- Midjourney v6 ----------
function midjourney(s, options) {
  const subject = s.subject?.primary || 'subject';
  const secondary = (s.subject?.secondary || []).slice(0, 3).join(', ');
  const style = styleClause(s.style);
  const linework = s.linework?.type;
  const medium = s.medium?.primary;
  const lighting = s.lighting?.primary;
  const mood = (s.mood?.tags || []).slice(0, 2).join(', ');
  const composition = s.composition?.framing;
  const palette = paletteClause(s.palette);
  const iso = isolationClause(s, options);
  const knol = knollingClause(options);

  const main = joinClean([
    subject,
    secondary,
    style,
    medium,
    linework,
    composition,
    iso,
    knol,
    lighting,
    mood,
    palette,
  ]);

  const flags = [];
  if (s.aspect_ratio) flags.push(`--ar ${s.aspect_ratio}`);

  // Auto-inject --no based on negatives + vector mode
  const nos = new Set();
  const wantsVector = options.forceVector || (s.vector_likeness?.score ?? 0) > 0.6;
  if (wantsVector) ['shading', '3d', 'photo', 'gradient', 'noise'].forEach(x => nos.add(x));
  for (const n of (s.negatives || [])) {
    const lc = n.toLowerCase();
    if (lc.includes('photo')) nos.add('photo');
    if (lc.includes('3d') || lc.includes('render')) nos.add('3d');
    if (lc.includes('shading')) nos.add('shading');
    if (lc.includes('gradient')) nos.add('gradient');
    if (lc.includes('noise') || lc.includes('grain')) nos.add('noise');
    if (lc.includes('text') || lc.includes('watermark')) nos.add('text');
  }
  if (nos.size) flags.push(`--no ${[...nos].join(' ')}`);

  // Stylization based on confidence
  const styleConf = s.style?.confidence ?? 0.5;
  if (wantsVector) flags.push('--s 50');
  else if (styleConf > 0.8) flags.push('--s 250');

  return `${main} ${flags.join(' ')}`.trim();
}

// ---------- Ideogram (typography mode) ----------
function ideogram(s, options) {
  const subject = s.subject?.primary || 'subject';
  const text = s.text_in_image && s.text_in_image.trim();
  const style = styleClause(s.style);
  const medium = s.medium?.primary;
  const palette = paletteClause(s.palette);
  const iso = isolationClause(s, options);
  const composition = s.composition?.framing;
  const lighting = s.lighting?.primary;

  const parts = [];
  if (text || options.typography) {
    parts.push(text ? `with the text "${text}"` : 'with bold typography');
  }
  parts.push(subject, style, medium, composition, iso, lighting, palette);
  return joinClean(parts);
}

// ---------- Leonardo.ai (natural language, no flags) ----------
function leonardo(s, options) {
  const narrative = s.narrative || '';
  const style = styleClause(s.style);
  const medium = s.medium?.primary;
  const linework = s.linework?.type;
  const palette = paletteClause(s.palette);
  const iso = isolationClause(s, options);
  const lighting = s.lighting?.primary;
  const mood = (s.mood?.tags || []).slice(0, 2).join(', ');

  const tail = joinClean([style, medium, linework, lighting, mood, palette, iso]);
  return narrative ? `${narrative.trim()} Style: ${tail}.` : tail;
}

// ---------- Flux / Whisk (dense descriptive) ----------
function flux(s, options) {
  const narrative = s.narrative || s.subject?.primary || '';
  const subject = s.subject?.primary;
  const secondary = (s.subject?.secondary || []).slice(0, 4).join(', ');
  const style = styleClause(s.style);
  const medium = s.medium?.primary;
  const linework = s.linework?.type;
  const lighting = s.lighting?.primary;
  const composition = s.composition?.framing;
  const palette = paletteClause(s.palette);
  const iso = isolationClause(s, options);
  const techniques = (s.medium?.techniques || []).slice(0, 3).join(', ');

  return joinClean([
    narrative,
    subject !== narrative ? subject : null,
    secondary,
    style,
    medium,
    techniques,
    linework,
    composition,
    iso,
    lighting,
    palette,
  ]);
}

// ---------- Nano Banana Pro (Gemini 3 Pro Image) ----------
// Best practices: dense conversational scene description, verbatim quoted text,
// explicit material/lighting language, named palette, aspect ratio in plain English.
// No --flags, no weighted tags, no negative-prompt section.
function nanobananapro(s, options) {
  const arWord = arToWord(s.aspect_ratio);
  const subject = s.subject?.primary || 'a subject';
  const secondary = (s.subject?.secondary || []).slice(0, 4);

  // Lead sentence — always anchored in the aspect ratio + medium
  const medium = s.medium?.primary || 'illustration';
  const head = `A ${arWord} ${medium} of ${subject}` + (secondary.length ? `, with ${secondary.join(', ')}` : '') + '.';

  // Style sentence — describe rather than tag
  const styleParts = [s.style?.primary, ...(s.style?.modifiers || []).slice(0, 2)].filter(Boolean);
  const styleSentence = styleParts.length
    ? ` Rendered in a ${styleParts.join(', ')} aesthetic${s.linework?.type ? ` with ${s.linework.type}` : ''}.`
    : '';

  // Scene / narrative — Nano Banana Pro loves rich descriptive prose here
  const narrativeSentence = s.narrative ? ` ${s.narrative.trim()}` : '';

  // Composition + isolation
  const compSentence = s.composition?.framing ? ` Composition: ${s.composition.framing}.` : '';
  const iso = isolationClause(s, options);
  const isoSentence = iso ? ` ${iso}.` : '';
  const knol = knollingClause(options);
  const knolSentence = knol ? ` ${knol}.` : '';

  // Lighting + mood — concrete language
  const lightingSentence = s.lighting?.primary ? ` Lighting: ${s.lighting.primary}.` : '';
  const moodTags = (s.mood?.tags || []).slice(0, 3);
  const moodSentence = moodTags.length ? ` Overall mood is ${moodTags.join(' and ')}.` : '';

  // Palette — named colors with hex hints (Nano Banana Pro respects hex)
  const palSentence = (s.palette || []).length
    ? ` Color palette focused on ${s.palette.slice(0, 5).map(p => `${p.name} (${p.hex})`).join(', ')}.`
    : '';

  // Verbatim text rendering — Nano Banana Pro is excellent at typography
  const textSentence = s.text_in_image && s.text_in_image.trim()
    ? ` The image must include the exact text "${s.text_in_image.trim()}" rendered cleanly and legibly.`
    : (options.typography ? ' If text is included, render it cleanly and legibly.' : '');

  // Explicit "do not" — phrased as positive constraint, since Nano Banana ignores classic negatives
  const negs = (s.negatives || []).slice(0, 5);
  const negSentence = negs.length
    ? ` Avoid ${negs.join(', ')}.`
    : '';

  return `${head}${styleSentence}${narrativeSentence}${compSentence}${isoSentence}${knolSentence}${lightingSentence}${moodSentence}${palSentence}${textSentence}${negSentence}`.trim().replace(/\s+/g, ' ');
}

function arToWord(ar) {
  if (!ar) return '';
  const map = {
    '1:1': 'square 1:1',
    '4:3': 'landscape 4:3',
    '3:4': 'portrait 3:4',
    '3:2': 'landscape 3:2',
    '2:3': 'portrait 2:3',
    '16:9': 'widescreen 16:9',
    '9:16': 'vertical 9:16',
    '21:9': 'ultrawide 21:9',
    '5:4': 'near-square 5:4',
    '4:5': 'portrait 4:5',
  };
  return map[ar] || `${ar} aspect ratio`;
}

// ---------- Imagen 4 (Google) ----------
// Best practices: dense natural-language paragraph, photographic terminology
// (camera body, lens, aperture, lighting setup) when realistic; otherwise
// painterly/illustration vocabulary. Excellent at text rendering. No flags.
function imagen4(s, options) {
  const arWord = arToWord(s.aspect_ratio);
  const subject = s.subject?.primary || 'a subject';
  const secondary = (s.subject?.secondary || []).slice(0, 4);
  const isPhoto = looksPhotographic(s);
  const medium = s.medium?.primary || (isPhoto ? 'photograph' : 'illustration');

  const head = `A ${arWord} ${medium} of ${subject}` +
    (secondary.length ? `, featuring ${secondary.join(', ')}` : '') + '.';

  // Style sentence
  const styleParts = [s.style?.primary, ...(s.style?.modifiers || []).slice(0, 2)].filter(Boolean);
  const styleSentence = styleParts.length
    ? ` Visual style: ${styleParts.join(', ')}${s.linework?.type && !isPhoto ? `, ${s.linework.type}` : ''}.`
    : '';

  // Camera/lens block — only when realistic. Imagen 4 listens to this.
  const camSentence = isPhoto ? imagen4CameraClause(s) : '';

  // Narrative
  const narrSentence = s.narrative ? ` ${s.narrative.trim()}` : '';

  // Composition
  const compSentence = s.composition?.framing ? ` Shot type: ${imagen4ShotType(s.composition.framing)}.` : '';
  const iso = isolationClause(s, options);
  const isoSentence = iso ? ` ${iso}.` : '';
  const knol = knollingClause(options);
  const knolSentence = knol ? ` ${knol}.` : '';

  // Lighting — Imagen 4 prefers photographic lighting language
  const lightingSentence = s.lighting?.primary
    ? ` Lighting: ${enrichLighting(s.lighting.primary, isPhoto)}.`
    : '';

  // Mood
  const moodTags = (s.mood?.tags || []).slice(0, 3);
  const moodSentence = moodTags.length ? ` Mood: ${moodTags.join(', ')}.` : '';

  // Palette
  const palSentence = (s.palette || []).length
    ? ` Color palette: ${s.palette.slice(0, 5).map(p => p.name).join(', ')} (${s.palette.slice(0, 3).map(p => p.hex).join(' ')}).`
    : '';

  // Verbatim text
  const textSentence = s.text_in_image && s.text_in_image.trim()
    ? ` The image contains the exact text "${s.text_in_image.trim()}", rendered with crisp, legible typography.`
    : '';

  return `${head}${styleSentence}${camSentence}${narrSentence}${compSentence}${isoSentence}${knolSentence}${lightingSentence}${moodSentence}${palSentence}${textSentence}`.replace(/\s+/g, ' ').trim();
}

function looksPhotographic(s) {
  const blob = (s.style?.primary + ' ' + (s.medium?.primary || '')).toLowerCase();
  if (/photo|cinematic|product photography|macro|aerial|drone/.test(blob)) return true;
  if ((s.vector_likeness?.score ?? 0) < 0.3) return true;
  return false;
}

function imagen4CameraClause(s) {
  // Sensible default kit driven by composition / framing
  const framing = (s.composition?.framing || '').toLowerCase();
  if (framing.includes('macro')) return ' Shot on Sony Alpha 7R V with a 90mm f/2.8 macro lens, very shallow depth of field.';
  if (framing.includes('portrait')) return ' Shot on Sony Alpha 7R V with an 85mm f/1.4 prime lens, shallow depth of field, creamy bokeh.';
  if (framing.includes('wide')) return ' Shot on Sony Alpha 7R V with a 24mm f/1.8 wide lens, deep focus.';
  if (framing.includes('top-down') || framing.includes('flat lay')) return ' Shot top-down on Sony Alpha 7R V with a 50mm lens, evenly lit, deep focus.';
  return ' Shot on Sony Alpha 7R V with a 50mm f/1.8 lens, balanced depth of field.';
}

function imagen4ShotType(framing) {
  const map = {
    'centered subject': 'centered medium shot',
    'rule of thirds': 'rule-of-thirds composition',
    'symmetrical': 'symmetrical composition',
    'isometric perspective': 'isometric three-quarter view',
    'top-down flat lay': 'top-down flat lay',
    'knolling layout': 'knolling layout, top-down',
    'sticker sheet grid': 'top-down grid layout',
    'close-up portrait': 'close-up portrait',
    'wide establishing shot': 'wide establishing shot',
    'medium shot': 'medium shot',
    'die-cut on white': 'centered subject on pure white background',
    'die-cut on transparent': 'centered subject on transparent background',
  };
  return map[framing] || framing;
}

function enrichLighting(l, isPhoto) {
  if (!isPhoto) return l;
  if (l === 'flat lighting') return 'flat even lighting, large overhead softbox';
  if (l === 'soft diffused light') return 'soft diffused daylight from a north-facing window';
  if (l === 'studio softbox') return 'three-point studio lighting with key softbox and rim light';
  return l;
}

// ---------- Recraft v3 ----------
// Recraft uses an explicit style + substyle taxonomy. Output the prompt body
// PLUS a clearly labeled style block the user can copy into the Recraft UI.
// Concise prompts beat verbose ones on Recraft.
function recraftv3(s, options) {
  const { style, substyle } = recraftStyle(s, options);

  const subject = s.subject?.primary || 'subject';
  const secondary = (s.subject?.secondary || []).slice(0, 3).join(', ');
  const styleWords = (s.style?.modifiers || []).slice(0, 2).join(', ');
  const linework = s.linework?.type;
  const lighting = s.lighting?.primary;
  const composition = s.composition?.framing;
  const mood = (s.mood?.tags || []).slice(0, 2).join(', ');
  const palette = (s.palette || []).slice(0, 4).map(p => p.name).join(', ');
  const iso = isolationClause(s, options);
  const text = s.text_in_image && s.text_in_image.trim();

  // Recraft prefers a tight, comma-separated descriptive prompt
  const body = joinClean([
    subject,
    secondary,
    styleWords,
    linework,
    composition,
    iso,
    lighting,
    mood,
    palette ? `palette: ${palette}` : null,
    text ? `with text "${text}"` : null,
  ]);

  // The style block is what the user pastes into the Recraft style dropdowns
  return `${body}\n\n[Recraft style] ${style}${substyle ? ` / ${substyle}` : ''}\n[Aspect ratio] ${s.aspect_ratio || '1:1'}`;
}

function recraftStyle(s, options) {
  const wantsVector = options.forceVector || (s.vector_likeness?.score ?? 0) > 0.6;
  const medium = (s.medium?.primary || '').toLowerCase();
  const style = (s.style?.primary || '').toLowerCase();
  const isPhoto = /photo|cinematic|product photography|macro|aerial/.test(style + ' ' + medium)
    || (s.vector_likeness?.score ?? 0) < 0.25;

  if (wantsVector || /vector|sticker|t-shirt|enamel pin|patch/.test(style + ' ' + medium)) {
    if (/line|monoline|outline/.test(s.linework?.type || '')) return { style: 'vector_illustration', substyle: 'line_art' };
    if (/sticker|die-cut/.test(style)) return { style: 'vector_illustration', substyle: 'sticker' };
    return { style: 'vector_illustration', substyle: '' };
  }
  if (isPhoto) {
    if (/product/.test(style)) return { style: 'realistic_image', substyle: 'studio_portrait' };
    if (/macro|aerial|natural/.test(style)) return { style: 'realistic_image', substyle: 'natural_light' };
    return { style: 'realistic_image', substyle: '' };
  }
  if (/3d|render|octane|blender|clay|plasticine/.test(style + ' ' + medium)) {
    return { style: 'realistic_image', substyle: 'studio_portrait' };
  }
  if (/pixel/.test(style)) return { style: 'digital_illustration', substyle: 'pixel_art' };
  if (/anime|manga|ghibli/.test(style)) return { style: 'digital_illustration', substyle: '' };
  return { style: 'digital_illustration', substyle: '' };
}

// ---------- Krea Flux ----------
// Built on Flux but rewards: dense cinematic scene, named camera/film stocks
// when photo, explicit aesthetic style, and a clean Negative prompt section.
function kreaflux(s, options) {
  const subject = s.subject?.primary || 'subject';
  const secondary = (s.subject?.secondary || []).slice(0, 4).join(', ');
  const narrative = s.narrative ? s.narrative.trim() : '';
  const style = styleClause(s.style);
  const medium = s.medium?.primary;
  const linework = s.linework?.type;
  const lighting = s.lighting?.primary;
  const composition = s.composition?.framing;
  const mood = (s.mood?.tags || []).slice(0, 2).join(', ');
  const palette = paletteClause(s.palette);
  const iso = isolationClause(s, options);
  const isPhoto = looksPhotographic(s);
  const filmHint = isPhoto ? 'shot on Kodak Portra 400, fine grain, cinematic color grading' : '';
  const text = s.text_in_image && s.text_in_image.trim();

  const body = joinClean([
    narrative,
    subject,
    secondary,
    style,
    medium,
    linework,
    composition,
    iso,
    lighting,
    mood,
    palette,
    filmHint,
    text ? `with the text "${text}"` : null,
    'highly detailed, sharp focus',
  ]);

  // Krea respects negative prompts — emit a labeled section
  const negs = uniq([
    ...((s.negatives) || []),
    'low quality', 'blurry', 'jpeg artifacts', 'watermark', 'signature', 'extra fingers', 'deformed hands',
  ]);
  return `${body}\n\nNegative prompt: ${negs.join(', ')}\nAspect ratio: ${s.aspect_ratio || '1:1'}`;
}

// ---------- SDXL / Pony (tag-style, weighted) ----------
function sdxl(s, options) {
  const subject = s.subject?.primary || 'subject';
  const tags = [
    `(${subject}:1.2)`,
    ...(s.subject?.secondary || []).slice(0, 3),
    s.style?.primary && `(${s.style.primary}:1.15)`,
    ...((s.style?.modifiers) || []).slice(0, 2),
    s.medium?.primary,
    s.linework?.type,
    s.lighting?.primary,
    s.composition?.framing,
    ...((s.mood?.tags) || []).slice(0, 2),
    paletteClause(s.palette),
    isolationClause(s, options),
    'masterpiece', 'best quality', 'highly detailed',
  ].filter(Boolean);

  const negatives = uniq([
    ...(s.negatives || []),
    'low quality', 'blurry', 'jpeg artifacts', 'watermark', 'signature',
    'extra fingers', 'deformed hands', 'bad anatomy',
  ]);

  return `${tags.join(', ')}\nNegative prompt: ${negatives.join(', ')}`;
}

// ---------- DALL·E 3 (natural language, full sentences) ----------
function dalle3(s, options) {
  const n = s.narrative || '';
  const subject = s.subject?.primary || 'a subject';
  const style = styleClause(s.style);
  const palette = (s.palette || []).slice(0, 4).map(p => p.name).join(', ');
  const iso = isolationClause(s, options);
  const lighting = s.lighting?.primary;
  const composition = s.composition?.framing;

  const head = n || `An image of ${subject}.`;
  const styleSentence = style ? ` Rendered as ${style}${s.medium?.primary ? `, ${s.medium.primary}` : ''}.` : '';
  const lightSentence = lighting ? ` Lighting: ${lighting}.` : '';
  const compSentence = composition ? ` Composition: ${composition}.` : '';
  const isoSentence = iso ? ` ${iso}.` : '';
  const palSentence = palette ? ` Color palette: ${palette}.` : '';
  return `${head}${styleSentence}${lightSentence}${compSentence}${isoSentence}${palSentence}`.trim();
}

function uniq(arr) {
  const s = new Set(); const o = [];
  for (const x of arr) { const k = (x || '').toLowerCase().trim(); if (k && !s.has(k)) { s.add(k); o.push(x); } }
  return o;
}
