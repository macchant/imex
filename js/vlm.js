// js/vlm.js
// Stage 2a — Frontier VLM caller (BYO API key).
// Supports OpenAI, Anthropic, Gemini. Returns the strict SCHEMA shape from vocab.js.

import { SCHEMA, buildVlmInstructions } from './vocab.js';

/** Convert a File/Blob to a base64 data URL (without the data: prefix returned separately). */
async function toBase64(blobOrFile) {
  const buf = await blobOrFile.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Resize a File to a max dimension to keep token cost down. Returns a new Blob (jpeg). */
async function downscaleImage(file, maxDim = 1024, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // White matte for transparency to keep JPEG happy
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function callVLM({ provider, apiKey, model, file, stage1 }) {
  if (!provider || provider === 'none' || !apiKey) {
    throw new Error('VLM disabled (no provider/key configured)');
  }
  const blob = await downscaleImage(file, 1024, 0.85);
  const b64 = await toBase64(blob);
  const instructions = buildVlmInstructions(stage1);

  if (provider === 'openai') return callOpenAI({ apiKey, model, b64, instructions });
  if (provider === 'anthropic') return callAnthropic({ apiKey, model, b64, instructions });
  if (provider === 'gemini') return callGemini({ apiKey, model, b64, instructions });
  if (provider === 'groq') return callGroq({ apiKey, model, b64, instructions });
  throw new Error(`Unknown provider: ${provider}`);
}

// ---------- OpenAI ----------
async function callOpenAI({ apiKey, model, b64, instructions }) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reverse-engineer this image into the JSON schema. Return ONLY the JSON.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: SCHEMA.name, strict: true, schema: SCHEMA.schema },
    },
    temperature: 0.2,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');
  return JSON.parse(content);
}

// ---------- Anthropic ----------
async function callAnthropic({ apiKey, model, b64, instructions }) {
  // Use tool_use to force a JSON shape (Anthropic's reliable pattern).
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model: model || 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system: instructions,
    tools: [{
      name: 'submit_schema',
      description: 'Submit the reverse-engineered prompt schema for the image.',
      input_schema: SCHEMA.schema,
    }],
    tool_choice: { type: 'tool', name: 'submit_schema' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: 'Reverse-engineer this image. Call submit_schema with the result.' },
      ],
    }],
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const toolUse = j.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('Anthropic returned no tool_use input');
  return toolUse.input;
}

// ---------- Gemini ----------
async function callGemini({ apiKey, model, b64, instructions }) {
  const m = model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // Gemini supports responseSchema directly. Strip enum-only fields it can choke on if needed.
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: instructions }] },
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        { text: 'Reverse-engineer this image into the JSON schema. Return ONLY the JSON.' },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: simplifyForGemini(SCHEMA.schema),
      temperature: 0.2,
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty content');
  return JSON.parse(text);
}

// Gemini's responseSchema doesn't support `additionalProperties`; strip recursively.
function simplifyForGemini(s) {
  if (Array.isArray(s)) return s.map(simplifyForGemini);
  if (s && typeof s === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 'additionalProperties') continue;
      out[k] = simplifyForGemini(v);
    }
    return out;
  }
  return s;
}

// ---------- Groq (OpenAI-compatible, free tier) ----------
// Uses meta-llama/llama-4-scout-17b-16e-instruct by default — multimodal, fast,
// free up to ~30 RPM. Strict JSON schema isn't reliable across all Groq models,
// so we use json_object mode + inline schema-in-prompt. Same shape comes back.
async function callGroq({ apiKey, model, b64, instructions }) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const m = model || 'meta-llama/llama-4-scout-17b-16e-instruct';

  // Inline a compact textual description of the schema so the model emits the right shape.
  const schemaInstructions = instructions + `

You MUST return a SINGLE JSON object that exactly matches this schema (no markdown, no code fences, no commentary):

{
  "subject": { "primary": <string, 2-6 words>, "secondary": <string[]>, "count": <int>, "confidence": <0..1> },
  "style": { "primary": <one of: ${enumList(SCHEMA.schema.properties.style.properties.primary.enum)}>, "modifiers": <string[]>, "confidence": <0..1> },
  "linework": { "type": <one of: ${enumList(SCHEMA.schema.properties.linework.properties.type.enum)}>, "confidence": <0..1> },
  "medium": { "primary": <one of: ${enumList(SCHEMA.schema.properties.medium.properties.primary.enum)}>, "techniques": <string[]>, "confidence": <0..1> },
  "lighting": { "primary": <one of: ${enumList(SCHEMA.schema.properties.lighting.properties.primary.enum)}>, "confidence": <0..1> },
  "mood": { "tags": <string[] from: ${enumList(SCHEMA.schema.properties.mood.properties.tags.items.enum)}>, "confidence": <0..1> },
  "composition": { "framing": <one of: ${enumList(SCHEMA.schema.properties.composition.properties.framing.enum)}>, "confidence": <0..1> },
  "narrative": <string, 2-4 concrete sentences>,
  "text_in_image": <verbatim string, "" if none>,
  "negatives": <string[]>
}`;

  const body = {
    model: m,
    messages: [
      { role: 'system', content: schemaInstructions },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reverse-engineer this image into the JSON schema above. Return ONLY the JSON object.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 1500,
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    // Surface common issues helpfully
    if (r.status === 401) throw new Error('Groq 401: invalid API key (must start with gsk_)');
    if (r.status === 429) throw new Error('Groq 429: rate limit hit (free tier ~30 RPM). Wait a minute and retry.');
    if (r.status === 413 || /image/i.test(txt)) throw new Error(`Groq image error: ${txt}`);
    throw new Error(`Groq ${r.status}: ${txt}`);
  }
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned empty content');
  // Some models still wrap output in ``` fences; strip defensively
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

function enumList(arr) {
  if (!arr) return '';
  return arr.map(x => `"${x}"`).join(', ');
}
