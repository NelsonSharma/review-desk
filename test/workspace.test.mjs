import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import test from "node:test";
import { makeApp } from "../server/app.mjs";
import { hashPassword } from "../server/security.mjs";
import { openStorage } from "../server/storage.mjs";
import { bibliography, blankReview, citationKey, exportReview, newPaper, parseImport, pastedKey, reviewSchema } from "../src/model.ts";

test("BibTeX uses the pasted entry and resolves a stable key", () => {
  const paper = { ...newPaper(), title: "Climate & Cities", bibtex: '@incollection{river2025, title={A {Nested} Title}, year="2025"}' };
  assert.equal(citationKey(paper), "river2025");
  assert.equal(bibliography([paper]), paper.bibtex + "\n");
  assert.equal(pastedKey('@misc(key, title="A ) title")'), "key");
  assert.equal(pastedKey("@misc{key, title={First}} @misc{second, title={Second}}"), "");
  assert.match(bibliography([{ ...paper, bibtex: "", citeKey: "sample" }]), /Climate \\& Cities/);
});

test("import migrates a legacy MAPO review without losing fields or citations", () => {
  const original = blankReview();
  const record = { ...newPaper(), title: "Original paper", tags: ["Baseline"], problem: "Old question", citeKey: "paper-1" };
  const { info, review } = parseImport({ papers: [record], profile: { name: "Approach", source: "Manuscript", problem: "Old approach" },
    drafts: { ...original.drafts, related: "\\cite{paper-1}" }, claims: [] }, "Original review");
  assert.equal(review.papers[0].values.problem, "Old question");
  assert.equal(review.profile.values.problem, "Old approach");
  assert.equal(review.drafts.related, "\\cite{paper-1}");
  assert.deepEqual(review.tags, ["Baseline"]);
  assert.deepEqual(parseImport(exportReview(info, review), ""), { info, review });
});

test("SQLite workspace serves papers, PDFs, and comments with server-side role checks", async t => {
  const work = await mkdtemp(join(tmpdir(), "literature-desk-test-"));
  await mkdir(join(work, "data"));
  const db = openStorage(join(work, "data"));
  const password = "test-case-password";
  db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,?)").run("owner", await hashPassword(password), "admin");
  const metadataRequests = [];
  const server = makeApp(db, { metadataSearch: async input => {
    metadataRequests.push(input);
    return { results: [], warnings: [] };
  } }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); await rm(work, { recursive: true, force: true }); });

  function client() {
    let cookie, csrf;
    return async (path, { method = "GET", data, originHeader = origin, token = true, status = 200 } = {}) => {
      const headers = { Origin: originHeader };
      if (cookie) headers.Cookie = cookie;
      const form = data instanceof FormData;
      if (method !== "GET") {
        headers["X-Review-Request"] = "1";
        if (csrf && token) headers["X-CSRF-Token"] = csrf;
      }
      if (data !== undefined && !form) headers["Content-Type"] = "application/json";
      const res = await fetch(origin + "/api" + path, {
        method, headers, body: data === undefined ? undefined : form ? data : JSON.stringify(data),
      });
      const result = res.headers.get("content-type")?.includes("application/json") ? await res.json() : await res.text();
      assert.equal(res.status, status, method + " " + path + ": " + JSON.stringify(result));
      const session = res.headers.get("set-cookie");
      if (session) cookie = session.split(";")[0];
      if (result?.csrf) csrf = result.csrf;
      return { result, res };
    };
  }
  const visitor = client(), owner = client(), reader = client(), reviewer = client(), editor = client();
  assert.deepEqual((await visitor("/state")).result.reviews, []);
  await owner("/login", { method: "POST", data: { username: "owner", password }, originHeader: "https://external.invalid", status: 403 });
  await visitor("/metadata/search", { method: "POST", data: { query: "a paper", sources: ["crossref"] }, status: 401 });
  await owner("/login", { method: "POST", data: { username: "owner", password } });
  await owner("/metadata/search", { method: "POST", data: { query: "a paper", sources: [] }, status: 400 });
  await owner("/metadata/search", { method: "POST", data: { query: "a paper", sources: ["https://evil.invalid"] }, status: 400 });
  await owner("/metadata/search", { method: "POST", data: { query: "a paper", sources: ["crossref"] } });
  assert.deepEqual(metadataRequests, [{ query: "a paper", sources: ["crossref"] }]);
  await owner("/metadata/search", { method: "POST", data: { query: "another", sources: ["arxiv"] }, status: 429 });
  const created = (await owner("/reviews", { method: "POST", data: { title: "Study design", description: "Compare research methods" }, status: 201 })).result.review;
  const path = "/reviews/" + created.id;
  await visitor(path, { status: 404 });
  await owner(path + "/access", { method: "PATCH", data: { public: true, publicPdfs: true }, token: false, status: 403 });

  const passwords = {};
  for (const role of ["viewer", "commenter", "editor"]) {
    passwords[role] = (await owner("/admin/users", { method: "POST", data: { username: role, role, password }, status: 201 })).result.user;
  }
  await reader("/login", { method: "POST", data: { username: "viewer", password } });
  await reviewer("/login", { method: "POST", data: { username: "commenter", password } });
  await editor("/login", { method: "POST", data: { username: "editor", password } });
  await reader("/metadata/search", { method: "POST", data: { query: "a paper", sources: ["crossref"] }, status: 403 });
  const { review } = (await reader(path)).result;
  const field = { id: "design", label: "Study design", description: "Describe the design", paper: true, profile: true };
  const relation = { id: "replication", label: "Replication", description: "", color: "green" };
  const paper = { ...newPaper(), title: "Comparison study", authors: "Jordan Lee", year: 2025,
    bibtex: "@article{lee2025, title={Comparison study}, year={2025}}", tags: ["Trial"], relation: relation.id, values: { design: "Panel design" } };
  const content = reviewSchema.parse({ ...review, fields: [...review.fields, field], relations: [...review.relations, relation], tags: ["Trial"],
    papers: [paper], profile: { ...review.profile, values: { design: "Survey design" } },
    claims: [{ id: "scope", title: "Replicability", category: "Design", status: "Draft", statement: "Compare matched designs.",
      evidence: [{ paperId: paper.id, role: "Closest comparator", note: "The paper compares similar study designs." }] }],
    drafts: { ...review.drafts, related: "Prior evidence~\\cite{lee2025}." } });
  await reader(path, { method: "PUT", data: { review: content, revision: 0 }, status: 403 });
  await reviewer(path, { method: "PUT", data: { review: content, revision: 0 }, status: 403 });
  await editor(path, { method: "PUT", data: { review: content, revision: 0 } });
  await editor(path, { method: "PUT", data: { review: content, revision: 0 }, status: 409 });
  await editor(path + "/access", { method: "PATCH", data: { public: true, publicPdfs: true }, status: 403 });
  await editor("/admin", { status: 403 });
  await visitor(path, { status: 404 });

  const comments = path + "/comments/paper/" + paper.id;
  const files = path + "/papers/" + paper.id + "/attachments";
  await reader(comments, { method: "POST", data: { body: "Read only" }, status: 403 });
  const comment = (await reviewer(comments, { method: "POST", data: { body: "Check the sample sizes." }, status: 201 })).result.comment;
  await editor(comments + "/" + comment.id, { method: "DELETE", status: 403 });

  const invalid = new FormData();
  invalid.append("pdf", new File(["not a PDF"], "fake.pdf", { type: "application/pdf" }));
  await editor(files, { method: "POST", data: invalid, status: 400 });
  const valid = new FormData();
  const bytes = "%PDF-1.7\n%%EOF";
  valid.append("pdf", new File([bytes], "study.pdf", { type: "application/pdf" }));
  const file = (await editor(files, { method: "POST", data: valid, status: 201 })).result.file;
  const pdfPath = file.url.slice(4);
  assert.equal((await reader(pdfPath)).result, bytes);

  await owner(path + "/access", { method: "PATCH", data: { public: true, publicPdfs: false } });
  assert.equal((await visitor(path)).result.review.papers[0].values.design, "Panel design");
  assert.equal((await visitor(comments)).result.comments[0].body, "Check the sample sizes.");
  assert.deepEqual((await visitor(files)).result.files, []);
  await visitor(pdfPath, { status: 404 });
  await visitor(comments, { method: "POST", data: { body: "Anonymous" }, status: 401 });
  await owner(path + "/access", { method: "PATCH", data: { public: true, publicPdfs: true } });
  const publicFile = await visitor(pdfPath);
  assert.equal(publicFile.result, bytes);
  assert.match(publicFile.res.headers.get("content-disposition"), /^attachment/);
  assert.match(publicFile.res.headers.get("cache-control"), /no-store/);
  await owner("/admin/users/" + passwords.commenter.id, { method: "PATCH", data: { role: "viewer", disabled: false } });
  await reviewer(comments, { method: "POST", data: { body: "Revoked access" }, status: 401 });
  const previewBackup = join(work, "saved.sqlite3");
  await backup(db, previewBackup);
  const saved = new DatabaseSync(previewBackup, { readOnly: true });
  assert.equal(saved.prepare("SELECT COUNT(*) AS n FROM attachments").get().n, 1);
  assert.equal(saved.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 1);
  assert.equal(saved.prepare("SELECT COUNT(*) AS n FROM reviews").get().n, 1);
  saved.close();
  const restored = (await editor("/reviews/import", { method: "POST", status: 201, data: { data: exportReview(created, content) } })).result.review;
  const duplicate = (await editor("/reviews/" + restored.id)).result;
  assert.equal(duplicate.info.public, false);
  assert.equal(duplicate.review.profile.values.design, "Survey design");
  assert.match(duplicate.review.drafts.related, /lee2025/);

  await editor(path, { method: "PUT", data: { revision: 1, review: { ...content, papers: [], claims: [] } } });
  await visitor(pdfPath, { status: 404 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attachments").get().n, 0);
});
