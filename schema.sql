CREATE TABLE IF NOT EXISTS trend_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot INTEGER NOT NULL,
  raw_response TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(date, slot)
);
