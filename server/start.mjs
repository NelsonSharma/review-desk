import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { makeApp, pdfLimit } from "./app.mjs";
import { dataDirectory, openStorage } from "./storage.mjs";

if (!existsSync(new URL("../dist/index.html", import.meta.url))) {
  console.error("Run npm run build before starting the server.");
  process.exit(1);
}

const args = new Map();
const allowed = new Set(["--host", "--port", "--strictPort"]);
for (let i = 2; i < process.argv.length; i += 1) {
  const option = process.argv[i];
  if (!allowed.has(option)) {
    console.error("Usage: npm start -- [--host ADDRESS] [--port PORT]");
    process.exit(1);
  }
  if (option !== "--strictPort") args.set(option, process.argv[++i]);
}
const host = args.get("--host") || process.env.HOST || "127.0.0.1";
const port = Number(args.get("--port") || process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Use a port between 1 and 65535.");
  process.exit(1);
}

const db = openStorage();
const app = makeApp(db, {
  trustProxy: process.env.LITERATURE_TRUST_PROXY === "1",
  secureCookies: process.env.LITERATURE_SECURE_COOKIES === "1",
});

const server = createServer({ requestTimeout: 120000, headersTimeout: 15000, maxHeaderSize: 16384 }, (req, res) => {
  if (Number(req.headers["content-length"]) > pdfLimit + 65536) {
    res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify({ error: "This upload exceeds the size limit." }));
    return;
  }
  app(req, res);
});
server.on("error", error => {
  console.error(error.message);
  db.close();
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const address = host.includes(":") ? "[" + host + "]" : host;
  console.log("Review Desk is listening on http://" + address + ":" + port + "/");
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) console.log("Create the owner account with npm run admin -- create");
  console.log("Data directory: " + dataDirectory());
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { server.close(() => db.close()); });
}
