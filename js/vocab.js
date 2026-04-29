// js/vocab.js
// Curated tag vocabulary, mirrors and extends vectorgen's Visual Tag Selector.
// Used for: (1) constraining VLM output, (2) zero-shot SigLIP matching, (3) chip UI.

export const STYLES = [
  'flat vector', 'corporate memphis', 'bauhaus', 'pop art', 'kawaii', 'art deco',
  'mid-century modern', 'minimalist', 'maximalist', 'retro 70s', 'retro 80s', 'vaporwave',
  'cyberpunk', 'solarpunk', 'isometric', 'low poly', 'pixel art', 'voxel',
  'cel-shaded anime', 'studio ghibli', 'shonen manga', 'shojo manga',
  'children book illustration', 'storybook gouache', 'watercolor', 'ink wash',
  'risograph', 'screen print', 'woodcut', 'linocut', 'engraving',
  'sticker design', 'die-cut sticker', 'enamel pin', 'embroidered patch',
  't-shirt graphic', 'streetwear graphic', 'tattoo flash', 'old-school tattoo',
  'photorealistic', 'cinematic photography', 'studio product photography',
  'macro photography', 'aerial drone photography',
  '3D render', 'octane render', 'blender eevee', 'clay render', 'plasticine',
  'oil painting', 'acrylic painting', 'pastel drawing', 'charcoal sketch',
  'concept art', 'matte painting', 'comic book', 'graphic novel',
];

export const LINEWORK = [
  'no outline', 'monoline', 'thin outline', 'thick outline', 'variable-weight ink',
  'rough sketchy lines', 'clean vector lines', 'brush stroke lines',
  'stippling', 'cross-hatching', 'halftone dots', 'engraved hatching',
];

export const MEDIUMS = [
  'vector illustration', 'digital painting', 'photograph', '3D render',
  'mixed media', 'collage', 'paper cut', 'papercraft', 'origami',
  'ceramic', 'embroidery', 'knit', 'felt', 'plush', 'clay',
  'pencil sketch', 'ink drawing', 'gouache', 'watercolor wash',
];

export const LIGHTING = [
  'flat lighting', 'soft diffused light', 'golden hour', 'blue hour',
  'studio softbox', 'rim light', 'backlight', 'silhouette',
  'neon glow', 'volumetric god rays', 'cinematic chiaroscuro',
  'overcast daylight', 'harsh midday sun', 'candlelit', 'moonlit',
  'high-key bright', 'low-key moody',
];

export const MOODS = [
  'playful', 'cheerful', 'whimsical', 'cozy', 'serene', 'dreamy',
  'nostalgic', 'melancholic', 'mysterious', 'eerie', 'dramatic',
  'energetic', 'bold', 'minimal', 'elegant', 'edgy', 'corporate',
];

export const COMPOSITIONS = [
  'centered subject', 'rule of thirds', 'symmetrical', 'asymmetrical',
  'isometric perspective', 'top-down flat lay', 'knolling layout', 'sticker sheet grid',
  'close-up portrait', 'wide establishing shot', 'medium shot',
  'die-cut on white', 'die-cut on transparent',
];

export const NEGATIVES = [
  'photorealistic', '3d render', 'shading', 'gradient', 'noise', 'grain',
  'low quality', 'blurry', 'jpeg artifacts', 'watermark', 'signature', 'text',
  'extra fingers', 'deformed hands', 'bad anatomy',
];

// Strict JSON schema returned by the VLM.
export const SCHEMA = {
  name: 'image_prompt_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'subject', 'style', 'linework', 'medium', 'lighting', 'mood',
      'composition', 'narrative', 'text_in_image', 'negatives',
    ],
    properties: {
      subject: {
        type: 'object', additionalProperties: false,
        required: ['primary', 'secondary', 'count', 'confidence'],
        properties: {
          primary: { type: 'string', description: 'The single main subject in 2-6 words.' },
          secondary: { type: 'array', items: { type: 'string' }, description: 'Other notable elements / props.' },
          count: { type: 'integer', description: 'How many distinct subjects/figures are present.' },
          confidence: { type: 'number' },
        },
      },
      style: {
        type: 'object', additionalProperties: false,
        required: ['primary', 'modifiers', 'confidence'],
        properties: {
          primary: { type: 'string', enum: STYLES },
          modifiers: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
      linework: {
        type: 'object', additionalProperties: false,
        required: ['type', 'confidence'],
        properties: {
          type: { type: 'string', enum: LINEWORK },
          confidence: { type: 'number' },
        },
      },
      medium: {
        type: 'object', additionalProperties: false,
        required: ['primary', 'techniques', 'confidence'],
        properties: {
          primary: { type: 'string', enum: MEDIUMS },
          techniques: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
      lighting: {
        type: 'object', additionalProperties: false,
        required: ['primary', 'confidence'],
        properties: {
          primary: { type: 'string', enum: LIGHTING },
          confidence: { type: 'number' },
        },
      },
      mood: {
        type: 'object', additionalProperties: false,
        required: ['tags', 'confidence'],
        properties: {
          tags: { type: 'array', items: { type: 'string', enum: MOODS } },
          confidence: { type: 'number' },
        },
      },
      composition: {
        type: 'object', additionalProperties: false,
        required: ['framing', 'confidence'],
        properties: {
          framing: { type: 'string', enum: COMPOSITIONS },
          confidence: { type: 'number' },
        },
      },
      narrative: {
        type: 'string',
        description: '2-4 sentence dense description of the image. Concrete, no purple prose.',
      },
      text_in_image: { type: 'string', description: 'Any visible text, verbatim. Empty string if none.' },
      negatives: { type: 'array', items: { type: 'string' } },
    },
  },
};

export function buildVlmInstructions(stage1) {
  return `You are a senior prompt engineer reverse-engineering an image into a structured prompt schema.

Rules:
- Use ONLY the enums provided in the JSON schema for style.primary, linework.type, medium.primary, lighting.primary, mood.tags, composition.framing.
- If multiple styles fit, pick the most dominant one for "primary" and put others in "modifiers".
- "narrative" must be 2-4 sentences, concrete, describing what is literally visible. NEVER invent artist names. NEVER use "in the style of <real artist>".
- "text_in_image" must be the exact verbatim text (case-sensitive). Empty string if no text.
- "negatives" should list things explicitly NOT in this image that the model should avoid. For a flat vector, include "photorealistic", "3d render", "shading", "gradient" etc.
- Confidence values are 0..1 floats.
- Do not hallucinate. If unsure, lower confidence.

Deterministic ground truth from pixel analysis (TRUST THIS):
- Aspect ratio: ${stage1.ar}
- Vector-likeness score: ${stage1.vector.score} (label: ${stage1.vector.label})
- Background: ${stage1.bg.kind}${stage1.bg.isolated ? ' (isolated subject)' : ''}
- Edge density: ${stage1.edges.label} (${stage1.edges.density})
- Dominant palette: ${stage1.palette.slice(0, 6).map(p => `${p.hex} ${p.name}`).join(', ')}
${stage1.exif?._aiHints?.length ? `- EXIF AI generator hints: ${stage1.exif._aiHints.join(', ')}` : ''}

Your schema MUST be consistent with this ground truth (e.g. don't say "photorealistic" if vector-likeness is high).`;
}
