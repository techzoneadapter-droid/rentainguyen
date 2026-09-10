// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('records', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(),
  payload: text('payload').notNull(), created: text('created').notNull(),
}, t => [index('records_owner_kind').on(t.owner, t.kind)]);
