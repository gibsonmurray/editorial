export type SegmentStatus = 'pending' | 'accepted' | 'rejected';

export interface KeepSegment {
  id: string;
  kind: 'keep';
  text: string;
}

export interface EditSegment {
  id: string;
  kind: 'edit';
  before: string;
  after: string;
  status: SegmentStatus;
}

export type Segment = KeepSegment | EditSegment;

export type EditType = 'delete' | 'replace' | 'insert';

export interface EditOp {
  type: EditType;
  original?: string;
  replacement?: string;
  after?: string;
  text?: string;
}

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'groq' | 'openrouter';
export type ActionId =
  | 'grammar' | 'light' | 'proofread' | 'natural' | 'streamline'
  | 'improve' | 'rewrite' | 'formal' | 'concise' | 'custom';

export interface Provider {
  id: ProviderId;
  label: string;
  defaultModel: string;
}

export interface Action {
  id: ActionId;
  name: string;
  glyph: string;
  hint: string;
  primary?: boolean;
}

export interface Settings {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseURL: string;
}

export interface HistoryEntry {
  id: string;
  actionId: string;
  name: string;
  glyph: string;
  when: string;
  preview: string;
  snapshot: { text: string; segments: Segment[] };
}

export interface Stats {
  words: number;
  chars: number;
}

export interface Snapshot {
  text: string;
  segments: Segment[];
}
