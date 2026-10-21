-- WEBSI Grundschema. Der Worker legt die Tabellen bei Bedarf auch selbst an.
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_site ON requests(site_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS visibility_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  score INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX IF NOT EXISTS reports_site ON visibility_reports(site_id, scanned_at DESC);

CREATE TABLE IF NOT EXISTS directories (
  site_id TEXT NOT NULL,
  directory_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, directory_id)
);
