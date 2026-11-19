import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS workspace_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT OR IGNORE INTO workspace_meta(singleton, revision) VALUES(1, 0);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  current_revision INTEGER NOT NULL CHECK(current_revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_versions (
  document_id TEXT NOT NULL REFERENCES documents(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  body TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  current INTEGER NOT NULL CHECK(current IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(document_id, revision)
);
CREATE INDEX IF NOT EXISTS document_versions_current ON document_versions(current, published_at);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_revision INTEGER NOT NULL,
  candidate_index INTEGER NOT NULL,
  candidate_json TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('pending', 'accepted', 'rejected')),
  review_revision INTEGER NOT NULL DEFAULT 0 CHECK(review_revision >= 0),
  candidate_revision INTEGER NOT NULL DEFAULT 0 CHECK(candidate_revision >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(document_id, document_revision, candidate_index),
  FOREIGN KEY(document_id, document_revision) REFERENCES document_versions(document_id, revision)
);
CREATE INDEX IF NOT EXISTS observations_identity ON observations(identity_key);
CREATE INDEX IF NOT EXISTS observations_decision ON observations(decision);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id),
  revision INTEGER NOT NULL,
  previous_decision TEXT NOT NULL,
  decision TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(observation_id, revision)
);
CREATE INDEX IF NOT EXISTS review_events_observation ON review_events(observation_id, revision);

CREATE TABLE IF NOT EXISTS candidate_events (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id),
  revision INTEGER NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  editor TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(observation_id, revision)
);
CREATE INDEX IF NOT EXISTS candidate_events_observation ON candidate_events(observation_id, revision);

CREATE TABLE IF NOT EXISTS brief_snapshots (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  since TEXT,
  workspace_revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export class IntelligenceDatabase {
  readonly connection: DatabaseSync;

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec(SCHEMA);
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  workspaceRevision(): number {
    const row = this.connection.prepare('SELECT revision FROM workspace_meta WHERE singleton = 1').get() as { revision: number };
    return row.revision;
  }

  advanceWorkspaceRevision(): number {
    this.connection.prepare('UPDATE workspace_meta SET revision = revision + 1 WHERE singleton = 1').run();
    return this.workspaceRevision();
  }

  close(): void {
    this.connection.close();
  }
}
