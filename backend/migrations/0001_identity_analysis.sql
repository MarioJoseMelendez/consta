-- Investigaciones de identidad y afirmaciones corroboradas.
-- La base es global y compartida: cualquier investigación puede consultar lo
-- guardado con la herramienta `bd`.

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  interest TEXT NOT NULL DEFAULT '',
  candidate_id TEXT,
  candidate_json TEXT,
  who TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  claim_count INTEGER NOT NULL DEFAULT 0,
  entity_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analyses_subject_key ON analyses (subject_key);

CREATE TABLE IF NOT EXISTS saved_entities (
  analysis_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  label_key TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  score REAL,
  confidence TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  profile_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (analysis_id, entity_id)
);

CREATE INDEX IF NOT EXISTS saved_entities_label_key ON saved_entities (label_key);

CREATE TABLE IF NOT EXISTS saved_claims (
  analysis_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  parent_id TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY (analysis_id, claim_id)
);

CREATE INDEX IF NOT EXISTS saved_claims_text_key ON saved_claims (text_key);

-- Una fila por afirmación. `entities` junta las etiquetas de la afirmación
-- para que buscar un nombre encuentre también las conexiones donde aparece.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  analysis_id UNINDEXED,
  claim_id UNINDEXED,
  subject,
  body,
  entities,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Imágenes pixel art por ocupación. Se generan una vez y se reutilizan.
CREATE TABLE IF NOT EXISTS occupation_images (
  occupation_key TEXT PRIMARY KEY,
  occupation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);
