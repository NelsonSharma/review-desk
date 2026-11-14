import express from "express";
import multer from "multer";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { blankReview, canComment, canEdit, parseImport, reviewInfoSchema, reviewSchema, userRoles } from "../src/model.ts";
import { transaction } from "./storage.mjs";
import { correctPassword, digest, hashPassword, passwordRule, secretToken, sessionAge, sessionToken, userName, validCsrf } from "./security.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const pdfLimit = 25 * 1024 * 1024;
const pdfUpload = multer({ limits: { files: 1, fileSize: pdfLimit, fields: 0, parts: 2, headerPairs: 30 } }).single("pdf");
const reviewWrite = z.object({ revision: z.number().int().nonnegative(), review: reviewSchema });
const updateAccess = z.object({ public: z.boolean(), publicPdfs: z.boolean() });
const loginInput = z.object({ username: userName, password: z.string().min(1).max(200) });
const userInput = z.object({ username: userName, role: z.enum(userRoles), password: passwordRule });
const accountUpdate = z.object({ role: z.enum(userRoles), disabled: z.boolean(), password: passwordRule.optional() });
const commentInput = z.object({ body: z.string().trim().min(1, "Write a comment before posting.").max(4000) });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function summary(row) {
  const { id, title, description } = row;
  return { id, title, description, public: Boolean(row.public), publicPdfs: Boolean(row.public_pdfs) };
}

function userRecord(row) {
  return { id: row.id, username: row.username, role: row.role };
}

function problem(status, message) { throw new HttpError(status, message); }

export function makeApp(db, options = {}) {
  const { staticDirectory = resolve(root, "dist"), trustProxy = false, secureCookies = false } = options;
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", "loopback");

  const sessionByHash = db.prepare(`SELECT users.id, users.username, users.role, sessions.csrf
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires > ? AND users.disabled = 0`);
  const lookupReview = db.prepare("SELECT * FROM reviews WHERE id = ?");
  const lookupUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const lookupUsername = db.prepare("SELECT * FROM users WHERE username = ?");
  const listPublic = db.prepare("SELECT id, title, description, public, public_pdfs FROM reviews WHERE public = 1 ORDER BY touched DESC");
  const listAll = db.prepare("SELECT id, title, description, public, public_pdfs FROM reviews ORDER BY touched DESC");
  // Match comment threads and PDF attachments to an existing record before crossing into SQL.
  function readableReview(req) {
    const row = lookupReview.get(req.params.id);
    if (!row || (!row.public && !req.user)) problem(404, "Review not found.");
    return row;
  }
  function access(action, message) {
    return (req, _res, next) => {
      if (!action(req.user)) return next(new HttpError(req.user ? 403 : 401, message));
      next();
    };
  }
  const editor = access(canEdit, "An editor account is required.");
  const commenter = access(canComment, "A commenter or editor account is required.");
  const admin = access(user => user?.role === "admin", "The administrator account is required.");

  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });
  const api = express.Router();
  app.use("/api", api);
  api.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    const token = sessionToken(req);
    req.session = token ? sessionByHash.get(digest(token), Date.now()) : undefined;
    req.user = req.session ? userRecord(req.session) : null;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("X-Review-Request") !== "1") return next(new HttpError(403, "Open the app to make changes."));
      const origin = req.get("Origin");
      if (origin && origin !== req.protocol + "://" + req.get("Host")) {
        return next(new HttpError(403, "The request origin does not match this server."));
      }
      if (req.session && !validCsrf(req.get("X-CSRF-Token"), req.session.csrf)) {
        return next(new HttpError(403, "Reload the page to refresh your sign-in."));
      }
    }
    next();
  });
  const json = express.json({ limit: "6mb" });
  const smallJson = express.json({ limit: "64kb" });

  api.get("/state", (req, res) => {
    res.json({
      user: req.user, csrf: req.session?.csrf ?? null,
      reviews: (req.user ? listAll : listPublic).all().map(summary),
      adminReady: Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()),
    });
  });

  const failures = new Map();
  let inAuthentication = 0;
  const loginWindow = 15 * 60 * 1000;
  api.post("/login", smallJson, async (req, res) => {
    if (secureCookies && !req.secure) problem(403, "Use the HTTPS address to sign in.");
    const { username, password } = loginInput.parse(req.body);
    const now = Date.now();
    for (const [key, attempt] of failures) if (attempt.expires <= now) failures.delete(key);
    const key = req.ip;
    const attempt = failures.get(key) ?? { count: 0, expires: now + loginWindow };
    if (attempt.count >= 12) {
      res.set("Retry-After", String(Math.ceil((attempt.expires - now) / 1000)));
      problem(429, "Too many attempts. Try again in a few minutes.");
    }
    if (inAuthentication >= 2) problem(429, "Sign-in is busy. Try again shortly.");
    if (failures.size >= 2000 && !failures.has(key)) failures.delete(failures.keys().next().value);
    attempt.count += 1;
    failures.set(key, attempt);
    inAuthentication += 1;
    try {
      const row = lookupUsername.get(username);
      const valid = await correctPassword(password, row?.password_hash);
      const current = row && lookupUser.get(row.id);
      if (!valid || !current || current.disabled || current.password_hash !== row.password_hash) problem(401, "Incorrect username or password.");
      failures.delete(key);
      const token = secretToken();
      const csrf = secretToken();
      transaction(db, () => {
        db.prepare("DELETE FROM sessions WHERE expires <= ? OR token_hash = ?").run(now, digest(sessionToken(req)));
        db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(digest(token), current.id, csrf, now + sessionAge);
      });
      res.cookie("literature_desk", token, { httpOnly: true, sameSite: "lax", secure: req.secure || secureCookies, path: "/", maxAge: sessionAge });
      res.json({ user: userRecord(current), csrf });
    } finally {
      inAuthentication -= 1;
    }
  });

  api.post("/logout", (req, res) => {
    const token = sessionToken(req);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
    res.clearCookie("literature_desk", { httpOnly: true, sameSite: "lax", secure: req.secure || secureCookies, path: "/" }).json({ ok: true });
  });

  function createReview(info, review, res) {
    const id = randomUUID();
    db.prepare("INSERT INTO reviews(id,title,description,document,touched) VALUES (?,?,?,?,?)")
      .run(id, info.title, info.description, JSON.stringify(review), Date.now());
    res.status(201).json({ review: summary(lookupReview.get(id)) });
  }
  api.post("/reviews", editor, smallJson, (req, res) => createReview(reviewInfoSchema.parse(req.body), blankReview(), res));
  api.post("/reviews/import", editor, json, (req, res) => {
    const input = z.object({ data: z.unknown(), title: z.string().max(120).optional() }).parse(req.body);
    let imported;
    try { imported = parseImport(input.data, input.title?.trim() ?? ""); }
    catch (error) {
      problem(400, error instanceof ZodError ? (error.issues[0]?.message ?? "Check the exported review.") : error.message);
    }
    createReview(imported.info, imported.review, res);
  });
  api.get("/reviews/:id", (req, res) => {
    const row = readableReview(req);
    res.json({ info: summary(row), review: JSON.parse(row.document), revision: row.revision });
  });
  api.patch("/reviews/:id/info", editor, smallJson, (req, res) => {
    const row = readableReview(req);
    const info = reviewInfoSchema.parse(req.body);
    db.prepare("UPDATE reviews SET title = ?, description = ? WHERE id = ?").run(info.title, info.description, row.id);
    res.json({ info: summary(lookupReview.get(row.id)) });
  });
  api.patch("/reviews/:id/access", admin, smallJson, (req, res) => {
    const row = readableReview(req);
    const data = updateAccess.parse(req.body);
    db.prepare("UPDATE reviews SET public = ?, public_pdfs = ? WHERE id = ?")
      .run(Number(data.public), Number(data.public && data.publicPdfs), row.id);
    res.json({ info: summary(lookupReview.get(row.id)) });
  });

  api.put("/reviews/:id", editor, json, (req, res) => {
    const row = readableReview(req);
    const input = reviewWrite.parse(req.body);
    if (input.revision !== row.revision) problem(409, "This review changed in another session. Reload to get the latest version.");
    const previous = JSON.parse(row.document);
    const currentPapers = new Set(input.review.papers.map(item => item.id));
    const currentClaims = new Set(input.review.claims.map(item => item.id));
    transaction(db, () => {
      const result = db.prepare("UPDATE reviews SET document = ?, revision = revision + 1, touched = ? WHERE id = ? AND revision = ?")
        .run(JSON.stringify(input.review), Date.now(), row.id, input.revision);
      if (result.changes !== 1) problem(409, "This review changed in another session. Reload to get the latest version.");
      const deleteComments = db.prepare("DELETE FROM comments WHERE review_id = ? AND kind = ? AND target = ?");
      const deleteAttachments = db.prepare("DELETE FROM attachments WHERE review_id = ? AND paper_id = ?");
      for (const paper of previous.papers) if (!currentPapers.has(paper.id)) {
        deleteAttachments.run(row.id, paper.id);
        deleteComments.run(row.id, "paper", paper.id);
      }
      for (const claim of previous.claims) if (!currentClaims.has(claim.id)) deleteComments.run(row.id, "claim", claim.id);
    });
    res.json({ revision: input.revision + 1 });
  });

  function readablePaper(req) {
    const row = readableReview(req);
    if (!JSON.parse(row.document).papers.some(paper => paper.id === req.params.paper)) problem(404, "Paper not found.");
    return row;
  }
  function pdfEntry(req, row) {
    return {
      id: row.id, name: row.name, size: row.size, createdAt: row.created,
      url: "/api/reviews/" + encodeURIComponent(req.params.id) + "/papers/" + encodeURIComponent(req.params.paper) + "/attachments/" + row.id,
    };
  }
  const filesPath = "/reviews/:id/papers/:paper/attachments";
  api.get(filesPath, (req, res) => {
    const row = readablePaper(req);
    const canDownload = req.user || row.public_pdfs;
    const files = canDownload ? db.prepare("SELECT id, name, size, created FROM attachments WHERE review_id = ? AND paper_id = ? ORDER BY created DESC")
      .all(row.id, req.params.paper).map(item => pdfEntry(req, item)) : [];
    res.json({ files });
  });
  let uploads = 0;
  function uploadPdf(req, res, next) {
    readablePaper(req);
    if (uploads >= 2) return next(new HttpError(429, "Uploads are busy. Try again shortly."));
    uploads += 1;
    res.once("close", () => { uploads -= 1; });
    pdfUpload(req, res, next);
  }
  api.post(filesPath, editor, uploadPdf, (req, res) => {
    if (!canEdit(sessionByHash.get(digest(sessionToken(req)), Date.now()))) problem(403, "An editor account is required.");
    const row = readablePaper(req);
    const pdf = req.file;
    if (!pdf || pdf.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") problem(400, "Choose a PDF file.");
    const safeName = basename(pdf.originalname.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim()
      .replace(/\.pdf$/i, "").slice(0, 190) || "paper";
    const file = { id: randomUUID(), name: safeName + ".pdf", size: pdf.size, created: Date.now() };
    db.prepare("INSERT INTO attachments VALUES (?,?,?,?,?,?,?)")
      .run(file.id, row.id, req.params.paper, file.name, file.size, pdf.buffer, file.created);
    res.status(201).json({ file: pdfEntry(req, file) });
  });
  api.get(filesPath + "/:attachment", (req, res) => {
    const row = readablePaper(req);
    if (!req.user && !row.public_pdfs) problem(404, "Attachment not found.");
    const file = db.prepare("SELECT name, content FROM attachments WHERE id = ? AND review_id = ? AND paper_id = ?")
      .get(req.params.attachment, row.id, req.params.paper);
    if (!file) problem(404, "Attachment not found.");
    res.attachment(file.name).type("application/pdf").send(Buffer.from(file.content));
  });
  api.delete(filesPath + "/:attachment", editor, (req, res) => {
    const row = readablePaper(req);
    db.prepare("DELETE FROM attachments WHERE id = ? AND review_id = ? AND paper_id = ?").run(req.params.attachment, row.id, req.params.paper);
    res.json({ ok: true });
  });

  const commentPath = "/reviews/:id/comments/:kind/:target";
  function commentTarget(req) {
    const row = readableReview(req);
    const { kind, target } = req.params;
    const document = JSON.parse(row.document);
    const found = (kind === "paper" && document.papers.some(paper => paper.id === target)) ||
      (kind === "claim" && document.claims.some(claim => claim.id === target)) ||
      (kind === "draft" && ["related", "contribution"].includes(target));
    if (!found) problem(404, "Discussion not found.");
    return row.id;
  }
  function commentDto(item, user) {
    return { id: item.id, body: item.body, createdAt: item.created, author: item.username,
      canDelete: user?.role === "admin" || (canComment(user) && item.user_id === user.id) };
  }
  api.get(commentPath, (req, res) => {
    const id = commentTarget(req);
    const items = db.prepare(`SELECT comments.*, users.username FROM comments JOIN users ON users.id = comments.user_id
      WHERE review_id = ? AND kind = ? AND target = ? ORDER BY created, comments.id`).all(id, req.params.kind, req.params.target);
    res.json({ comments: items.map(item => commentDto(item, req.user)) });
  });
  api.post(commentPath, commenter, smallJson, (req, res) => {
    const review = commentTarget(req);
    const { body } = commentInput.parse(req.body);
    const item = { id: randomUUID(), user_id: req.user.id, username: req.user.username, body, created: Date.now() };
    db.prepare("INSERT INTO comments VALUES (?,?,?,?,?,?,?)").run(item.id, review, req.params.kind, req.params.target, item.user_id, body, item.created);
    res.status(201).json({ comment: commentDto(item, req.user) });
  });
  api.delete(commentPath + "/:comment", commenter, (req, res) => {
    const review = commentTarget(req);
    const item = db.prepare("SELECT user_id FROM comments WHERE id = ? AND review_id = ? AND kind = ? AND target = ?")
      .get(req.params.comment, review, req.params.kind, req.params.target);
    if (!item) problem(404, "Comment not found.");
    if (req.user.role !== "admin" && item.user_id !== req.user.id) problem(403, "Only the author or administrator can remove this comment.");
    db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.comment);
    res.json({ ok: true });
  });

  api.get("/admin", admin, (_req, res) => {
    const users = db.prepare("SELECT id, username, role, disabled FROM users ORDER BY role = 'admin' DESC, username").all()
      .map(row => ({ ...userRecord(row), disabled: Boolean(row.disabled) }));
    res.json({ users, reviews: listAll.all().map(summary) });
  });
  function stillAdmin(req) {
    if (sessionByHash.get(digest(sessionToken(req)), Date.now())?.role !== "admin") problem(403, "The administrator account is required.");
  }
  api.post("/admin/users", admin, smallJson, async (req, res) => {
    const input = userInput.parse(req.body);
    if (lookupUsername.get(input.username)) problem(409, "That username is already in use.");
    const password = await hashPassword(input.password);
    stillAdmin(req);
    if (lookupUsername.get(input.username)) problem(409, "That username is already in use.");
    const result = db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,?)").run(input.username, password, input.role);
    res.status(201).json({ user: { ...userRecord(lookupUser.get(result.lastInsertRowid)), disabled: false } });
  });
  api.patch("/admin/users/:id", admin, smallJson, async (req, res) => {
    const row = lookupUser.get(req.params.id);
    if (!row) problem(404, "User not found.");
    if (row.role === "admin") problem(400, "Use the local admin command to reset the owner password.");
    const input = accountUpdate.parse(req.body);
    const password = input.password ? await hashPassword(input.password) : null;
    stillAdmin(req);
    transaction(db, () => {
      db.prepare("UPDATE users SET role = ?, disabled = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?")
        .run(input.role, Number(input.disabled), password, row.id);
      if (password || input.disabled || input.role !== row.role) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
    });
    res.json({ user: { ...userRecord(lookupUser.get(row.id)), disabled: input.disabled } });
  });
  api.use((_req, _res, next) => next(new HttpError(404, "This API route does not exist.")));

  app.use(express.static(staticDirectory, { index: false, redirect: false, maxAge: "1h", etag: true, dotfiles: "deny",
    setHeaders: (res, path) => { if (["app.js", "app.css", "theme.js", "index.html"].includes(basename(path))) res.setHeader("Cache-Control", "no-cache"); },
  }));
  app.get("/", (_req, res) => res.set("Cache-Control", "no-cache").sendFile(resolve(staticDirectory, "index.html")));
  app.use((_req, _res, next) => next(new HttpError(404, "Page not found.")));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return res.status(400).json({ error: issue.path.length ? issue.path.join(".") + " · " + issue.message : issue.message });
    }
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "PDFs can be up to 25 MiB." });
      return res.status(400).json({ error: "Upload one PDF at a time." });
    }
    if (error.type === "entity.too.large") return res.status(413).json({ error: "This request exceeds the size limit." });
    if (error instanceof URIError) return res.status(400).json({ error: "This address is invalid." });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "This JSON request could not be read." });
    console.error(error.message);
    res.status(500).json({ error: "The server could not complete this request." });
  });
  return app;
}
