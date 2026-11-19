import { env, http } from './util.js';

/**
 * Minimal Anthropic Messages API client with forced tool use, so the model
 * always returns structured JSON that matches the schema.
 */
export async function callTool({ model, system, user, tool, maxTokens = 8000 }) {
  // Some models reject forced tool_choice, so use "auto" and insist in the prompt; nudge once if needed.
  const messages = [{ role: 'user', content: user }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await http('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      json: {
        model,
        max_tokens: maxTokens,
        system: `${system}\n\nRespond only by calling the \`${tool.name}\` tool exactly once.`,
        tools: [tool],
        tool_choice: { type: 'auto' },
        messages,
      },
      timeout: 300000,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(data.error ?? data)}`);
    const block = data.content?.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (block) return block.input;
    messages.push({ role: 'assistant', content: data.content }, { role: 'user', content: `Call the \`${tool.name}\` tool now with your complete answer.` });
  }
  throw new Error(`Model did not call ${tool.name}`);
}

export const CAROUSEL_TOOL = {
  name: 'carousel',
  description: 'Return the complete carousel post.',
  input_schema: {
    type: 'object',
    required: ['title', 'visual_style', 'cover_art_query', 'art_fallbacks', 'slides', 'cta_line', 'caption', 'risk_notes'],
    properties: {
      title: { type: 'string', description: 'Cover title, max 7 words, works in uppercase.' },
      dek: { type: 'string', description: 'Optional cover subline, max 12 words.' },
      visual_style: { type: 'string', enum: ['painting', 'photo'], description: 'One style for the whole carousel.' },
      cover_art_query: { type: 'string' },
      art_fallbacks: { type: 'array', items: { type: 'string' }, description: '2 or 3 broader on-topic visual searches used when a slide query finds nothing good.' },
      slides: {
        type: 'array',
        items: {
          type: 'object',
          required: ['heading', 'body', 'art_query'],
          properties: {
            heading: { type: 'string' },
            body: { type: 'string' },
            art_query: { type: 'string' },
            flag: { type: 'string', enum: ['', 'Contested', 'Simplified', 'Traditionally dated'], description: 'Accuracy label shown on the slide when a claim is debated or simplified.' },
            source: { type: 'string', description: 'Short source tag, e.g. "Braudel 1979".' },
          },
        },
      },
      cta_line: { type: 'string' },
      caption: { type: 'string' },
      urls: { type: 'array', items: { type: 'string' }, description: 'Every URL mentioned anywhere in the post.' },
      risk_notes: { type: 'array', items: { type: 'string' }, description: 'Claims most likely to be challenged in the comments, with suggested defensive phrasing.' },
    },
  },
};

export const REVIEW_TOOL = {
  name: 'review',
  description: 'Return the expert review.',
  input_schema: {
    type: 'object',
    required: ['issues', 'verdict'],
    properties: {
      verdict: { type: 'string', enum: ['publishable', 'needs_fixes'] },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          required: ['where', 'problem', 'severity', 'fix'],
          properties: {
            where: { type: 'string', description: 'e.g. "slide 3", "caption", "cover"' },
            problem: { type: 'string' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            fix: { type: 'string' },
          },
        },
      },
    },
  },
};
