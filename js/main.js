// js/main.js
// UI controller. Owns DOM state and orchestrates the full pipeline.

import {
  loadImage, aspectRatio, extractPalette,
  detectIsolation, vectorLikeness, edgeDensity, readExif,
} from './analyze.js';
import { callVLM } from './vlm.js';
import { runTagger } from './tagger.js';
import { fuse } from './fusion.js';
import { synthesize } from './synthesize.js';

// ---------- State ----------
const state = {
  file: null,
  img: null,
  stage1: null,
  vlmResult: null,
  taggerResult: null,
  schema: null,
  settings: loadSettings(),
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('extract.settings') || '{}');
  } catch { return {}; }
}
function saveSettings(s) { localStorage.setItem('extract.settings', JSON.stringify(s)); }

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('file-input');
const preview = $('preview');
const dropzoneEmpty = $('dropzone-empty');
const extractBtn = $('extract-btn');
const extractLabel = $('extract-label');
const extractSpinner = $('extract-spinner');
const statusEl = $('status');
const targetSel = $('target-model');
const finalPrompt = $('final-prompt');
const promptMeta = $('prompt-meta');
const copyBtn = $('copy-btn');
const regenBtn = $('regenerate-btn');
const optIso = $('opt-isolated');
const optKnol = $('opt-knolling');
const optType = $('opt-typography');
const optVec = $('opt-vector');

// Settings modal
const settingsBtn = $('settings-btn');
const settingsModal = $('settings-modal');
const settingsClose = $('settings-close');
const settingsSave = $('settings-save');
const providerSel = $('provider');
const apiKeyInput = $('api-key');
const modelInput = $('model-name');
const optLocal = $('opt-local-models');

// Brand UI
const providerPill = $('provider-pill');
const providerPillLabel = $('provider-pill-label');
const onboarding = $('onboarding');
const onboardingDismiss = $('onboarding-dismiss');
const onboardingOpen = $('onboarding-open');
const heroEl = $('hero');
const stage1Time = $('stage1-time');

// Init settings UI
providerSel.value = state.settings.provider || 'none';
apiKeyInput.value = state.settings.apiKey || '';
modelInput.value = state.settings.model || '';
optLocal.checked = !!state.settings.useLocal;
updateProviderPill();
maybeShowOnboarding();

const openSettings = () => settingsModal.classList.remove('hidden');
const closeSettings = () => settingsModal.classList.add('hidden');
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) closeSettings(); });

settingsSave.addEventListener('click', () => {
  state.settings = {
    provider: providerSel.value,
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    useLocal: optLocal.checked,
  };
  saveSettings(state.settings);
  closeSettings();
  updateProviderPill();
  maybeShowOnboarding();
  setStatus('Settings saved.');
});

if (onboardingOpen) onboardingOpen.addEventListener('click', openSettings);
if (onboardingDismiss) onboardingDismiss.addEventListener('click', () => {
  localStorage.setItem('imex.onboarding.dismissed', '1');
  onboarding.classList.add('hidden');
});

function updateProviderPill() {
  if (!providerPill) return;
  const p = state.settings.provider;
  const labels = {
    none: 'free mode',
    groq: 'groq · llama 4',
    openai: 'openai',
    anthropic: 'anthropic',
    gemini: 'gemini',
  };
  providerPillLabel.textContent = state.settings.apiKey && p && p !== 'none'
    ? labels[p] || p
    : 'free mode';
  providerPill.classList.remove('hidden');
}

function maybeShowOnboarding() {
  if (!onboarding) return;
  const hasKey = state.settings.apiKey && state.settings.provider && state.settings.provider !== 'none';
  const dismissed = localStorage.getItem('imex.onboarding.dismissed') === '1';
  if (!hasKey && !dismissed) onboarding.classList.remove('hidden');
  else onboarding.classList.add('hidden');
}

// Drag-drop
['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
});

// Paste support
window.addEventListener('paste', e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) handleFile(item.getAsFile());
});

extractBtn.addEventListener('click', () => runExtraction());
regenBtn.addEventListener('click', () => renderPrompt());
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(finalPrompt.value);
  copyBtn.textContent = 'Copied ✓';
  setTimeout(() => copyBtn.textContent = 'Copy', 1200);
});
targetSel.addEventListener('change', () => renderPrompt());
[optIso, optKnol, optType, optVec].forEach(el => el.addEventListener('change', () => renderPrompt()));

// ---------- Pipeline ----------
async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) { setStatus('Not an image file.'); return; }
  if (file.size > 20 * 1024 * 1024) { setStatus('Image too large (>20MB).'); return; }

  state.file = file;
  state.vlmResult = null;
  state.taggerResult = null;
  state.schema = null;
  resetSchemaUI();
  finalPrompt.value = '';
  promptMeta.textContent = '';

  setStatus('Analyzing pixels…');
  const t0 = performance.now();

  // Show preview
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.classList.remove('hidden');
  dropzoneEmpty.classList.add('hidden');

  // Stage 1
  const loaded = await loadImage(file);
  state.img = loaded;
  const ar = aspectRatio(loaded.w0, loaded.h0);
  const palette = extractPalette(loaded.data, 6);
  const bg = detectIsolation(loaded.data);
  const vec = vectorLikeness(loaded.data);
  const edges = edgeDensity(loaded.data);
  const exif = await readExif(file);

  state.stage1 = { ar, palette, bg, vector: vec, edges, exif };

  // Pre-populate option toggles from analysis
  optIso.checked = !!bg.isolated;
  optVec.checked = vec.score > 0.6;

  renderStage1(state.stage1);
  extractBtn.disabled = false;
  const ms = Math.round(performance.now() - t0);
  if (stage1Time) stage1Time.textContent = `${ms}ms`;
  setStatus(`Pixel analysis done in ${ms}ms. ${state.settings.provider && state.settings.provider !== 'none' && state.settings.apiKey ? 'Click Extract to call the VLM.' : 'No VLM configured — Extract will use in-browser tagger only (Settings → add API key for higher quality).'}`);
}

async function runExtraction() {
  if (!state.file || !state.stage1) return;
  setBusy(true);
  state.vlmResult = null;
  state.taggerResult = null;

  const tasks = [];

  // Stage 2a — VLM
  if (state.settings.provider && state.settings.provider !== 'none' && state.settings.apiKey) {
    setStatus(`Calling ${state.settings.provider}…`);
    tasks.push(
      callVLM({
        provider: state.settings.provider,
        apiKey: state.settings.apiKey,
        model: state.settings.model,
        file: state.file,
        stage1: state.stage1,
      })
        .then(r => { state.vlmResult = r; })
        .catch(e => { console.error(e); setStatus(`VLM error: ${e.message}`); })
    );
  }

  // Stage 2b — local tagger (opt-in OR fallback when no VLM)
  const useLocal = state.settings.useLocal || !(state.settings.provider && state.settings.provider !== 'none' && state.settings.apiKey);
  if (useLocal) {
    setStatus(prev => 'Loading in-browser tagger (first run downloads ~80MB)…');
    tasks.push(
      runTagger(state.img.canvas.toDataURL('image/jpeg', 0.9), p => {
        if (p?.status === 'progress' && p.file) {
          setStatus(`Downloading ${p.file}: ${Math.round((p.progress || 0))}%`);
        }
      })
        .then(r => { state.taggerResult = r; })
        .catch(e => { console.warn('Tagger failed:', e); setStatus(`Tagger error: ${e.message}`); })
    );
  }

  await Promise.allSettled(tasks);

  // Stage 3 — fuse
  state.schema = fuse({ stage1: state.stage1, vlm: state.vlmResult, tagger: state.taggerResult });

  renderSchema(state.schema);
  renderPrompt();
  setBusy(false);

  const sources = [];
  if (state.vlmResult) sources.push(state.settings.provider);
  if (state.taggerResult) sources.push('siglip-local');
  setStatus(`Done. Sources: ${sources.join(' + ') || 'pixel-only'}.`);
}

// ---------- Renderers ----------
function renderStage1(s) {
  $('m-ar').textContent = s.ar;
  $('m-vector').textContent = `${s.vector.score} · ${s.vector.label}`;
  $('m-bg').textContent = s.bg.isolated ? `isolated (${s.bg.kind})` : `scene (${s.bg.kind})`;
  $('m-edge').textContent = `${s.edges.label} (${s.edges.density})`;

  const pal = $('palette');
  pal.innerHTML = '';
  for (const p of s.palette) {
    const el = document.createElement('div');
    el.className = 'flex items-center gap-2';
    el.innerHTML = `<div class="swatch" style="background:${p.hex}"></div><span class="font-mono text-[11px] text-ink-300">${p.hex}</span><span class="text-[11px] text-ink-400">${p.name}</span>`;
    pal.appendChild(el);
  }

  const exifEl = $('exif');
  if (s.exif) {
    const interesting = {};
    for (const k of ['Make', 'Model', 'Software', 'DateTimeOriginal', 'ImageDescription', 'XPComment', 'UserComment', 'parameters']) {
      if (s.exif[k]) interesting[k] = String(s.exif[k]).slice(0, 400);
    }
    if (s.exif._aiHints?.length) interesting['_aiHints'] = s.exif._aiHints.join(', ');
    exifEl.textContent = Object.keys(interesting).length ? JSON.stringify(interesting, null, 2) : '— no useful metadata —';
  } else {
    exifEl.textContent = '— no metadata —';
  }
}

function chip(text, conf = 0.5) {
  const tier = conf > 0.75 ? 'high' : conf > 0.45 ? 'mid' : 'low';
  const span = document.createElement('span');
  span.className = 'chip';
  span.dataset.conf = tier;
  span.textContent = text;
  return span;
}

function fillChips(elId, items) {
  const el = $(elId);
  el.innerHTML = '';
  if (!items?.length) { el.innerHTML = '<span class="text-ink-500">—</span>'; return; }
  for (const { text, conf } of items) el.appendChild(chip(text, conf));
}

function resetSchemaUI() {
  for (const id of ['s-subject', 's-style', 's-linework', 's-medium', 's-lighting', 's-mood', 's-composition', 's-negative']) {
    $(id).innerHTML = '<span class="text-ink-500">—</span>';
  }
  $('s-narrative').textContent = '—';
}

function renderSchema(s) {
  fillChips('s-subject', [
    s.subject?.primary && { text: s.subject.primary, conf: s.subject?.confidence ?? 0.5 },
    ...(s.subject?.secondary || []).map(t => ({ text: t, conf: 0.6 })),
  ].filter(Boolean));

  fillChips('s-style', [
    s.style?.primary && { text: s.style.primary, conf: s.style?.confidence ?? 0.5 },
    ...(s.style?.modifiers || []).map(t => ({ text: t, conf: 0.55 })),
  ].filter(Boolean));

  fillChips('s-linework', s.linework?.type ? [{ text: s.linework.type, conf: s.linework.confidence }] : []);
  fillChips('s-medium', [
    s.medium?.primary && { text: s.medium.primary, conf: s.medium?.confidence ?? 0.5 },
    ...(s.medium?.techniques || []).map(t => ({ text: t, conf: 0.5 })),
  ].filter(Boolean));
  fillChips('s-lighting', s.lighting?.primary ? [{ text: s.lighting.primary, conf: s.lighting.confidence }] : []);
  fillChips('s-mood', (s.mood?.tags || []).map(t => ({ text: t, conf: s.mood?.confidence ?? 0.5 })));
  fillChips('s-composition', s.composition?.framing ? [{ text: s.composition.framing, conf: s.composition.confidence }] : []);
  fillChips('s-negative', (s.negatives || []).map(t => ({ text: t, conf: 0.7 })));

  $('s-narrative').textContent = s.narrative || '—';
}

function renderPrompt() {
  if (!state.schema) return;
  const target = targetSel.value;
  const options = {
    isolated: optIso.checked,
    knolling: optKnol.checked,
    typography: optType.checked,
    forceVector: optVec.checked,
  };
  const out = synthesize(state.schema, target, options);
  finalPrompt.value = out;
  const conf = avgConfidence(state.schema);
  promptMeta.textContent = `target: ${target} · chars: ${out.length} · avg confidence: ${conf.toFixed(2)}`;
}

function avgConfidence(s) {
  const xs = [s.subject?.confidence, s.style?.confidence, s.linework?.confidence, s.medium?.confidence, s.lighting?.confidence, s.mood?.confidence, s.composition?.confidence].filter(v => typeof v === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// ---------- Status / busy ----------
function setStatus(msg) {
  if (typeof msg === 'function') msg = msg(statusEl.textContent);
  statusEl.textContent = msg || '';
}
function setBusy(b) {
  extractBtn.disabled = b;
  extractLabel.textContent = b ? 'Working…' : 'Extract Prompt';
  extractSpinner.classList.toggle('hidden', !b);
}
