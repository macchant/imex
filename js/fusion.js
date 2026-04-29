// js/fusion.js
// Stage 3 — Merge Stage 1 (deterministic) + Stage 2a (VLM) + Stage 2b (tagger)
// into one canonical schema with calibrated confidence.

/**
 * Stage-1 ground truth always wins for: aspect ratio, palette, isolation, EXIF.
 * VLM wins for: subject, narrative, text_in_image, mood (semantic stuff).
 * Tagger and VLM are averaged for: style, linework, medium, lighting, composition.
 */
export function fuse({ stage1, vlm, tagger }) {
  const out = {
    subject: vlm?.subject ?? { primary: 'unknown subject', secondary: [], count: 1, confidence: 0.3 },
    narrative: vlm?.narrative ?? '',
    text_in_image: vlm?.text_in_image ?? '',
    palette: stage1.palette,
    aspect_ratio: stage1.ar,
    background: stage1.bg,
    vector_likeness: stage1.vector,
    edges: stage1.edges,
    exif_ai_hints: stage1.exif?._aiHints ?? [],
  };

  out.style = mergeField(vlm?.style, tagger?.style, 'primary', 'modifiers');
  out.linework = mergeSimple(vlm?.linework, tagger?.linework, 'type');
  out.medium = mergeField(vlm?.medium, tagger?.medium, 'primary', 'techniques');
  out.lighting = mergeSimple(vlm?.lighting, tagger?.lighting, 'primary');
  out.composition = mergeSimple(vlm?.composition, tagger?.composition, 'framing');
  out.mood = mergeMood(vlm?.mood, tagger?.mood);

  // Reconcile vector-likeness with style claims
  if (stage1.vector.score > 0.7) {
    out.negatives = uniq([...(vlm?.negatives ?? []), 'photorealistic', '3d render', 'shading', 'gradient', 'noise']);
    out.style.primary = nudgeTowardVector(out.style.primary);
  } else if (stage1.vector.score < 0.3) {
    out.negatives = uniq([...(vlm?.negatives ?? [])]);
  } else {
    out.negatives = vlm?.negatives ?? [];
  }

  // Inject isolation into composition
  if (stage1.bg.isolated && !/(die-cut|isolated|on white|on transparent)/i.test(out.composition.framing || '')) {
    out.composition.framing = stage1.bg.kind === 'transparent'
      ? 'die-cut on transparent'
      : (stage1.bg.kind === 'white' ? 'die-cut on white' : out.composition.framing);
    out.composition.confidence = Math.max(out.composition.confidence ?? 0, 0.9);
  }

  return out;
}

function mergeField(vlm, tag, primaryKey, modifiersKey) {
  if (!vlm && !tag) return { [primaryKey]: '', [modifiersKey]: [], confidence: 0 };
  if (!vlm) return tag;
  if (!tag) return vlm;
  // If both pick the same primary → high confidence
  const samePrimary = (vlm[primaryKey] || '').toLowerCase() === (tag[primaryKey] || '').toLowerCase();
  return {
    [primaryKey]: vlm[primaryKey] || tag[primaryKey],
    [modifiersKey]: uniq([...(vlm[modifiersKey] || []), ...(tag[modifiersKey] || []), ...(samePrimary ? [] : [tag[primaryKey]].filter(Boolean))]),
    confidence: samePrimary
      ? Math.min(0.99, ((vlm.confidence || 0.5) + (tag.confidence || 0.5)) / 2 + 0.15)
      : ((vlm.confidence || 0.5) * 0.7 + (tag.confidence || 0.5) * 0.3),
  };
}

function mergeSimple(vlm, tag, key) {
  if (!vlm && !tag) return { [key]: '', confidence: 0 };
  if (!vlm) return tag;
  if (!tag) return vlm;
  const same = (vlm[key] || '').toLowerCase() === (tag[key] || '').toLowerCase();
  return {
    [key]: vlm[key] || tag[key],
    confidence: same
      ? Math.min(0.99, ((vlm.confidence || 0.5) + (tag.confidence || 0.5)) / 2 + 0.15)
      : (vlm.confidence || 0.5),
  };
}

function mergeMood(vlm, tag) {
  if (!vlm && !tag) return { tags: [], confidence: 0 };
  if (!vlm) return tag;
  if (!tag) return vlm;
  return {
    tags: uniq([...(vlm.tags || []), ...(tag.tags || [])]).slice(0, 4),
    confidence: ((vlm.confidence || 0.5) + (tag.confidence || 0.5)) / 2,
  };
}

function nudgeTowardVector(s) {
  if (!s) return 'flat vector';
  const lower = s.toLowerCase();
  if (lower.includes('photo') || lower.includes('render') || lower.includes('photorealistic')) return 'flat vector';
  return s;
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = (x || '').toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
