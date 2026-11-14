import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { dataDirectory, openStorage, transaction } from "../server/storage.mjs";
import { hashPassword, passwordRule, userName } from "../server/security.mjs";

let hidden = false;
const controlled = new Writable({ write(chunk, _encoding, done) {
  if (!hidden) process.stdout.write(chunk);
  done();
} });

let db;
let prompt;
try {
  const operation = process.argv[2];
  if (!["create", "reset"].includes(operation) || process.argv.length > 4) {
    throw new Error("Usage: npm run admin -- create [username] or npm run admin -- reset");
  }
  db = openStorage();
  const admin = db.prepare("SELECT id, username FROM users WHERE role = 'admin'").get();
  if (operation === "create" && admin) throw new Error("The administrator already exists. Use reset to change the password.");
  if (operation === "reset" && !admin) throw new Error("Create the administrator first.");
  let username = admin?.username || process.argv[3];
  const unattended = process.env.LITERATURE_ADMIN_PASSWORD;
  if (!username || !unattended) {
    if (!process.stdin.isTTY) throw new Error("Run this command in a terminal to enter the password.");
    prompt = createInterface({ input: process.stdin, output: controlled, terminal: true });
    prompt.on("SIGINT", () => process.exit(130));
  }
  username = userName.parse(username || await prompt.question("Administrator username: "));
  async function askPassword(label) {
    process.stdout.write(label);
    hidden = true;
    try { return await prompt.question(""); }
    finally { hidden = false; process.stdout.write("\n"); }
  }
  const password = passwordRule.parse(unattended || await askPassword("Password: "));
  if (!unattended && password !== await askPassword("Confirm password: ")) throw new Error("The passwords do not match.");
  const hash = await hashPassword(password);
  if (admin) {
    transaction(db, () => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, admin.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(admin.id);
    });
  } else {
    db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,'admin')").run(username, hash);
  }
  console.log("Administrator " + username + " is ready in " + dataDirectory());
} catch (error) {
  console.error(error.issues?.[0]?.message || error.message);
  process.exitCode = 1;
} finally {
  prompt?.close();
  db?.close();
}
