import { CURRENT_SAVE_SCHEMA_VERSION } from "./save-schema";

type SaveMigration = (document: Record<string, unknown>) => Record<string, unknown>;

// New schema migrations are registered under the version they migrate from.
export const SAVE_MIGRATIONS: Readonly<Partial<Record<number, SaveMigration>>> = {};

export const migrateSaveDocument = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  let document = value as Record<string, unknown>;
  let version = Number(document.schemaVersion);
  while (Number.isInteger(version) && version >= 2 && version < CURRENT_SAVE_SCHEMA_VERSION) {
    const migration = SAVE_MIGRATIONS[version];
    if (!migration) return null;
    document = migration(document);
    version = Number(document.schemaVersion);
  }
  return document;
};
