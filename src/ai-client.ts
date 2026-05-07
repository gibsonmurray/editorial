import type { ActionId, EditOp, ProviderId } from './types';

type CoreActionId = Exclude<ActionId, 'custom'>;

export const ACTION_INSTRUCTIONS: Record<CoreActionId, string> = {
  grammar:    "Fix grammar, spelling, punctuation, and obvious typos. Do not change wording, voice, or sentence structure beyond what's mechanically wrong.",
  light:      "Make a light editorial pass. Fix only clear errors and obvious awkwardness. Preserve voice. Be very conservative.",
  proofread:  "Proofread carefully and thoroughly. Fix grammar, spelling, punctuation, agreement, capitalization, and clear stylistic missteps. Preserve voice and meaning.",
  natural:    "Make the writing sound more natural and human. Smooth out stilted phrasing, awkward constructions, and anything that reads as robotic. Preserve all meaning.",
  streamline: "Streamline the prose. Improve flow and transitions, fix choppy or run-on sentences, and make sentences read more cleanly. Preserve voice and meaning.",
  improve:    "Improve the writing. Strengthen weak verbs, replace vague words with specific ones, vary sentence rhythm, and elevate phrasing. Preserve voice and meaning.",
  rewrite:    "Rewrite for clarity and impact. You may restructure sentences and reword more aggressively, but preserve the author's intent and all factual content.",
  formal:     "Make the writing more formal and professional. Remove contractions, elevate diction, replace colloquialisms with formal equivalents.",
  concise:    "Tighten the prose. Remove filler words, redundancies, and weak hedges. Keep the substance intact.",
};

export const SYSTEM_TEMPLATE = (instruction: string): string =>
  `You are a professional editor. The user will give you text to edit.

Return ONLY a JSON object (no markdown, no explanation, no code fences) in this exact shape:
{
  "edits": [
    { "type": "delete", "original": "text to remove" },
    { "type": "insert", "after": "anchor text", "text": "text to add" },
    { "type": "replace", "original": "old text", "replacement": "new text" }
  ]
}

Rules:
- "original" and "after" must be EXACT substrings of the user's text (preserve casing and whitespace).
- Make small, targeted edits rather than one giant replace covering the whole text.
- Each edit operates on a distinct piece of text. Do not overlap edits.
- If no changes are needed, return {"edits": []}.

Apply this rule: ${instruction}`;

export interface CallAIOptions {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseURL: string;
  systemPrompt: string;
  userText: string;
  signal?: AbortSignal;
}

export async function callAI({ provider, model, apiKey, baseURL, systemPrompt, userText, signal }: CallAIOptions): Promise<string> {
  if (!apiKey) throw new Error('Missing API key.');
  if (!model) throw new Error('Missing model.');

  if (provider === 'anthropic') {
    const url = (baseURL?.trim() || 'https://api.anthropic.com') + '/v1/messages';
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json() as { content?: Array<{ text?: string }> };
    return data?.content?.map(b => b.text ?? '').join('') ?? '';
  }

  const defaultBase: Partial<Record<ProviderId, string>> = {
    openai:      'https://api.openai.com',
    google:      'https://generativelanguage.googleapis.com/v1beta/openai',
    mistral:     'https://api.mistral.ai',
    groq:        'https://api.groq.com/openai',
    openrouter:  'https://openrouter.ai/api',
  };
  const url = (baseURL?.trim() || defaultBase[provider] || 'https://api.openai.com') + '/v1/chat/completions';

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${provider} ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data?.choices?.[0]?.message?.content ?? '';
}

export interface ParseEditsResult {
  edits: EditOp[];
  rawError?: string;
}

export function parseEditsResponse(raw: string): ParseEditsResult {
  if (!raw) return { edits: [], rawError: 'Empty response' };
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s) as { edits?: EditOp[] };
    if (Array.isArray(parsed?.edits)) return { edits: parsed.edits };
    return { edits: [], rawError: 'No edits[] in response' };
  } catch (e) {
    return { edits: [], rawError: 'JSON parse failed: ' + (e as Error).message };
  }
}
