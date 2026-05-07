import Dexie, { type EntityTable } from 'dexie';
import type { RichDocument, SavedInstruction } from './types';

export const EMPTY_DOCUMENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Start writing, paste rich text, or drop a document here.' }],
    },
  ],
};

const now = () => Date.now();

export const createBlankDocument = (title = 'Untitled manuscript'): RichDocument => ({
  id: crypto.randomUUID(),
  title,
  content: EMPTY_DOCUMENT,
  html: '<p>Start writing, paste rich text, or drop a document here.</p>',
  suggestions: [],
  createdAt: now(),
  updatedAt: now(),
});

export class EditorialDB extends Dexie {
  documents!: EntityTable<RichDocument, 'id'>;
  instructions!: EntityTable<SavedInstruction, 'id'>;

  constructor() {
    super('editorial-rich-documents');
    this.version(1).stores({
      documents: 'id, updatedAt, createdAt, title',
      instructions: 'id, name, updatedAt, lastUsedAt',
    });
  }
}

export const db = new EditorialDB();

export async function ensureInitialDocument() {
  const count = await db.documents.count();
  if (count > 0) return;
  await db.documents.add(createBlankDocument('Clash of the Novice Warriors'));
}

export async function upsertDocument(doc: RichDocument) {
  await db.documents.put({ ...doc, updatedAt: now() });
}

export async function touchInstruction(id: string) {
  await db.instructions.update(id, { lastUsedAt: now(), updatedAt: now() });
}
