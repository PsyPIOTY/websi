-- Ideen von fremden Websites (Peter 15.11.2026): Text, Link, Foto getrennt, Herkunft bei Paco nur einmal.
CREATE TABLE IF NOT EXISTS ideen (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  quelle TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  bild TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ideen_status ON ideen(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ideen_quelle ON ideen(quelle) WHERE quelle IS NOT NULL
