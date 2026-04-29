// js/tagger.js
// Stage 2b — Opt-in in-browser zero-shot tagging.
// Uses transformers.js + SigLIP to match the image against our curated vocab.
// Free, private, ~80MB one-time model download. Disabled by default.

import { STYLES, LINEWORK, MEDIUMS, LIGHTING, MOODS, COMPOSITIONS } from './vocab.js';

let _pipelinePromise = null;
let _transformers = null;

async function getTransformers() {
  if (_transformers) return _transformers;
  _transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');
  _transformers.env.allowLocalModels = false;
  _transformers.env.useBrowserCache = true;
  return _transformers;
}

async function getPipeline(progressCb) {
  if (_pipelinePromise) return _pipelinePromise;
  _pipelinePromise = (async () => {
    const t = await getTransformers();
    return t.pipeline('zero-shot-image-classification', 'Xenova/siglip-base-patch16-224', {
      progress_callback: progressCb,
    });
  })();
  return _pipelinePromise;
}

async function topK(pipe, imgUrl, labels, k = 3, prefix = '') {
  const candidates = labels.map(l => prefix ? `${prefix} ${l}` : l);
  const result = await pipe(imgUrl, candidates);
  // Strip the prefix back off the labels
  return result.slice(0, k).map(r => ({
    label: prefix ? r.label.slice(prefix.length).trim() : r.label,
    score: r.score,
  }));
}

/**
 * Run grounded zero-shot tagging across all our vocabularies.
 * Returns a partial schema with confidences derived from cosine similarity.
 */
export async function runTagger(imageUrl, progressCb = () => {}) {
  const pipe = await getPipeline(progressCb);

  // Run sequentially to avoid hammering the runtime; each call is fast (~150-400ms).
  const [styleR, lineworkR, mediumR, lightingR, moodR, compositionR] = [
    await topK(pipe, imageUrl, STYLES, 3, 'an image in the style of'),
    await topK(pipe, imageUrl, LINEWORK, 2, 'an image with'),
    await topK(pipe, imageUrl, MEDIUMS, 2, 'an image of'),
    await topK(pipe, imageUrl, LIGHTING, 2, 'an image with'),
    await topK(pipe, imageUrl, MOODS, 3, 'an image that feels'),
    await topK(pipe, imageUrl, COMPOSITIONS, 2, 'an image with'),
  ];

  return {
    style: { primary: styleR[0]?.label, modifiers: styleR.slice(1).map(r => r.label), confidence: styleR[0]?.score ?? 0 },
    linework: { type: lineworkR[0]?.label, confidence: lineworkR[0]?.score ?? 0 },
    medium: { primary: mediumR[0]?.label, techniques: mediumR.slice(1).map(r => r.label), confidence: mediumR[0]?.score ?? 0 },
    lighting: { primary: lightingR[0]?.label, confidence: lightingR[0]?.score ?? 0 },
    mood: { tags: moodR.slice(0, 2).map(r => r.label), confidence: moodR[0]?.score ?? 0 },
    composition: { framing: compositionR[0]?.label, confidence: compositionR[0]?.score ?? 0 },
  };
}
