-- Consta GT DATA — esquema de snapshot para D1.
-- El worker solo lee estas tablas; la ingesta se ejecuta fuera del request path.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'person', 'agency', 'unknown')),
  display_name TEXT NOT NULL,
  legal_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'probable', 'unresolved', 'no_match')),
  attributes TEXT NOT NULL DEFAULT '{}',
  aliases TEXT NOT NULL DEFAULT '[]',
  channels TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS identifiers (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (entity_id, scheme, value)
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'LEGAL_REP_OF',
      'SHARED_LEGAL_REP',
      'AWARDED_CONTRACT',
      'CONTRACT_WITH',
      'OFFICER_OF',
      'SAME_AS'
    )
  ),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'probable', 'unresolved', 'no_match')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  date TEXT,
  excerpt TEXT,
  license TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('record', 'document', 'dataset')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  channel_id TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  license TEXT NOT NULL,
  content_type TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  date TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  r2_key TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  rows_read INTEGER,
  rows_written INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_identifiers_scheme_value
  ON identifiers (scheme, value);
CREATE INDEX IF NOT EXISTS idx_identifiers_value
  ON identifiers (value);
CREATE INDEX IF NOT EXISTS idx_identifiers_normalized
  ON identifiers (normalized_value);
CREATE INDEX IF NOT EXISTS idx_identifiers_entity
  ON identifiers (entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_from
  ON relationships (from_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to
  ON relationships (to_id);
CREATE INDEX IF NOT EXISTS idx_evidence_channel
  ON evidence (channel_id);
CREATE INDEX IF NOT EXISTS idx_documents_entity
  ON documents (entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_channel
  ON documents (channel_id);
CREATE INDEX IF NOT EXISTS idx_entities_display_name
  ON entities (display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source
  ON sync_runs (source_id, started_at);

-- FTS5 opcional. D1 puede no tener FTS5 habilitado en todas las versiones/regiones.
-- Verificar con: SELECT sqlite_compileoption_used('ENABLE_FTS5');
-- Si devuelve 1, ejecutar manualmente este bloque (no incluirlo en la migración base):
--
-- CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
--   display_name,
--   legal_name,
--   aliases,
--   content = 'entities',
--   content_rowid = 'rowid',
--   tokenize = 'unicode61 remove_diacritics 2'
-- );
--
-- CREATE TRIGGER IF NOT EXISTS entities_fts_ai AFTER INSERT ON entities BEGIN
--   INSERT INTO entities_fts (rowid, display_name, legal_name, aliases)
--   VALUES (new.rowid, new.display_name, new.legal_name, new.aliases);
-- END;
-- CREATE TRIGGER IF NOT EXISTS entities_fts_ad AFTER DELETE ON entities BEGIN
--   INSERT INTO entities_fts (entities_fts, rowid, display_name, legal_name, aliases)
--   VALUES ('delete', old.rowid, old.display_name, old.legal_name, old.aliases);
-- END;
-- CREATE TRIGGER IF NOT EXISTS entities_fts_au AFTER UPDATE ON entities BEGIN
--   INSERT INTO entities_fts (entities_fts, rowid, display_name, legal_name, aliases)
--   VALUES ('delete', old.rowid, old.display_name, old.legal_name, old.aliases);
--   INSERT INTO entities_fts (rowid, display_name, legal_name, aliases)
--   VALUES (new.rowid, new.display_name, new.legal_name, new.aliases);
-- END;
