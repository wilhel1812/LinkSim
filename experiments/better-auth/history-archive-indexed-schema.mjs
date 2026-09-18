import { readFileSync } from 'node:fs';

// Local synthetic fixture only. Read the real application schema so the cost
// comparison includes its JSON expression and partial history indexes.
export function indexedArchiveSchema() {
  return readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8') + `
ALTER TABLE resource_changes ADD COLUMN archive_key TEXT;
ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;
`;
}
