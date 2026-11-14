import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function dataDirectory(custom = process.env.LITERATURE_DATA_DIR || "data") {
  return resolve(custom);
}

export function openStorage(directory = dataDirectory()) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(directory, "literature.sqlite3"), { timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const existing = db.prepare("PRAGMA user_version").get().user_version;
  if (existing === 0) {
    transaction(db, () => {
      if (db.prepare("PRAGMA user_version").get().user_version === 1) return;
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin','editor','commenter','viewer')), disabled INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX one_admin ON users(role) WHERE role = 'admin';

        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf TEXT NOT NULL, expires INTEGER NOT NULL
        );
        CREATE INDEX sessions_user ON sessions(user_id);

        CREATE TABLE reviews (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
          document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
          public INTEGER NOT NULL DEFAULT 0, public_pdfs INTEGER NOT NULL DEFAULT 0, touched INTEGER NOT NULL
        );

        CREATE TABLE attachments (
          id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
          paper_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL, created INTEGER NOT NULL
        );
        CREATE INDEX attachments_paper ON attachments(review_id, paper_id);

        CREATE TABLE comments (
          id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('paper','claim','draft')), target TEXT NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created INTEGER NOT NULL
        );
        CREATE INDEX comments_target ON comments(review_id, kind, target, created);

        PRAGMA user_version = 1;
      `);
    });
  } else if (existing !== 1) {
    db.close();
    throw new Error("This database needs a newer version of Review Desk.");
  }
  return db;
}

export function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
