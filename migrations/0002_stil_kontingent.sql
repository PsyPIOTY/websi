-- Stil-Gedächtnis und Einstellungen (z. B. Tageslimits fürs Kontingent).
CREATE TABLE IF NOT EXISTS style_rules (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS style_site ON style_rules(site_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value))
);
