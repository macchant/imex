# Extract // IMG → PROMPT

Reverse-engineer any image into a high-fidelity, model-specific AI prompt. Client-side. Free. BYO API key for frontier accuracy.

Standalone companion to [`vectorgen`](https://github.com/macchant/vectorgen) — the schemas/vocabularies are intentionally compatible so output here can be piped straight into vectorgen later.

---

## Why this exists

Most "image-to-prompt" tools use **one** model (usually CLIP Interrogator) and dump raw output. The result: hallucinated artist names, generic captions, wrong target syntax.

This tool is built around four senior-engineering principles:

1. **Ensemble, not single model.** Deterministic pixel analysis + frontier VLM + zero-shot SigLIP against a curated vocabulary, fused into one schema with calibrated confidence per field.
2. **Ground truth wins.** Aspect ratio, palette, isolation, edge density, EXIF — these are computed in pure JS from pixels and *override* whatever the LLM hallucinates. The VLM is told the ground truth before it answers.
3. **Structured schema, not prose.** The VLM emits a strict JSON schema (subject, style, linework, medium, lighting, mood, composition, negatives) so the user can edit individual axes as chips, and downstream synthesizers can target any model precisely.
4. **Model-specific synthesis.** One schema → six different prompt strings (Midjourney v6, Ideogram, Leonardo, Flux, SDXL, DALL·E 3), each with the right syntax (`--ar`, `--no`, `--s` flags; weighted tags; natural-language sentences).

---

## Pipeline

```
┌─────────────┐
│  Image In   │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│ Stage 1 — Deterministic (pure JS, ~50ms)         │
│ • Aspect ratio (snapped to common values)        │
│ • Palette (k-means in CIELAB, perceptual)        │
│ • Background isolation detector                  │
│ • Vector-likeness score                          │
│ • Edge density / linework signal                 │
│ • EXIF + AI-generator fingerprint scan           │
└──────┬───────────────────────────────────────────┘
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
┌──────────────────────┐    ┌────────────────────────────────┐
│ Stage 2a — Frontier  │    │ Stage 2b — Local SigLIP        │
│ VLM (BYO key)        │    │ zero-shot vs curated vocab     │
│ OpenAI / Anthropic / │    │ (transformers.js, in-browser,  │
│ Gemini, returns      │    │  ~80MB cached, FREE)           │
│ strict JSON schema   │    │                                │
└──────┬───────────────┘    └────────────────┬───────────────┘
       │                                     │
       └──────────────┬──────────────────────┘
                      ▼
       ┌──────────────────────────────────┐
       │ Stage 3 — Confidence-weighted    │
       │ fusion. Stage 1 ground truth     │
       │ wins for AR/palette/isolation.   │
       │ VLM wins for narrative/subject.  │
       │ VLM+SigLIP averaged for style.   │
       └──────────────┬───────────────────┘
                      ▼
       ┌──────────────────────────────────┐
       │ Stage 4 — Model-specific         │
       │ synthesis (Midjourney v6,        │
       │ Ideogram, Leonardo, Flux, SDXL,  │
       │ DALL·E 3)                        │
       └──────────────┬───────────────────┘
                      ▼
                ┌────────────┐
                │ Prompt Out │
                └────────────┘
```

### The senior moves most tools skip

- **LAB k-means, not RGB.** RGB averages produce muddy "browns" that don't perceptually exist in the image. CIELAB k-means gives the actual perceived dominant colors.
- **Vector-likeness drives `--no` flags.** If the input has few unique colors, sharp edges, alpha presence → it's vector. We auto-inject `--no shading 3d photo gradient noise` before you even click.
- **EXIF AI-fingerprint scan.** Sometimes the original Midjourney/SD generator leaves its name in the metadata. Free wins. We surface it.
- **VLM is told the ground truth.** Stage 1's measurements are inlined into the system prompt with a "TRUST THIS" instruction. Massively reduces hallucination.
- **Confidence fusion.** When VLM and SigLIP both agree on a style → confidence is bumped above either source alone.

---

## Quickstart

### Run locally

This is a static site — no build step.

```powershell
# from the project root
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000`.

### Use it

1. **Drop or paste an image** (PNG / JPG / WEBP / GIF, up to 20MB).
2. **Free mode** works immediately: pixel analysis runs, then click **Extract** and the in-browser SigLIP tagger matches against the curated vocab.
3. **Frontier mode** (recommended): click **Settings**, paste an OpenAI / Anthropic / Gemini key, save. Now Extract uses the VLM for high-quality narrative + structured schema. Your key is stored only in `localStorage` and only sent directly to the provider.
4. Pick your **target model** (Midjourney / Ideogram / Leonardo / Flux / SDXL / DALL·E 3). Toggle **Isolated**, **Knolling**, **Typography**, **Force vector** as needed. Copy the prompt.

### Deploy to GitHub Pages

```powershell
git init
git add .
git commit -m "feat: extract v1"
git remote add origin https://github.com/macchant/extract.git
git branch -M main
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: `main` / `/ (root)`**. Done. Same setup as `vectorgen`.

---

## Project structure

```
extract/
├── index.html              # UI shell (Tailwind CDN)
├── README.md
└── js/
    ├── main.js             # UI controller + pipeline orchestration
    ├── analyze.js          # Stage 1 — deterministic pixel analysis
    ├── vocab.js            # Curated vocabularies + JSON schema
    ├── vlm.js              # Stage 2a — OpenAI / Anthropic / Gemini
    ├── tagger.js           # Stage 2b — SigLIP zero-shot via transformers.js
    ├── fusion.js           # Stage 3 — confidence-weighted merge
    └── synthesize.js       # Stage 4 — model-specific prompt builders
```

---

## Privacy & security

- **No backend.** Everything runs in your browser.
- **API keys** are stored only in `localStorage` and only sent directly to the provider you choose.
- **Images** never leave your machine in free mode. In frontier mode, they're sent to your chosen VLM provider as a downscaled JPEG (max 1024px) only when you click Extract.
- **No analytics, no tracking.**

---

## Roadmap

- **v1 (this build)**: Stages 1–4, six target models, BYO key, opt-in SigLIP tagger.
- **v2**: WD14 booru-tagger for anime/character recognition. JoyTag for dense general tags.
- **v3**: Round-trip verification — generate an image with the prompt via Flux Schnell, compute DINOv2 cosine similarity vs original, iterate the schema field that drifted.
- **v4**: Direct "Send to vectorgen" handoff via URL params or `postMessage`.
- **v5**: Florence-2 region captioning (per-object bounding boxes) for compound scenes.

---

## License

MIT.
