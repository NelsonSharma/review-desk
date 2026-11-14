import { backup, DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, openSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { dataDirectory } from "../server/storage.mjs";

const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) {
  console.error("Usage: npm run backup -- path/to/backup.sqlite3");
  process.exit(1);
}
const target = resolve(destination);
const source = join(dataDirectory(), "literature.sqlite3");
if (target === source || target === source + "-wal" || target === source + "-shm") {
  console.error("Choose a different filename for the backup.");
  process.exit(1);
}
let db;
let created = false;
try {
  closeSync(openSync(target, "wx", 0o600));
  created = true;
  db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  await backup(db, target);
  chmodSync(target, 0o600);
  console.log("Backup saved to " + target);
} catch (error) {
  if (created) rmSync(target, { force: true });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
