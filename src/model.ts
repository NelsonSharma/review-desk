import { z } from "zod";

export const colors = ["green", "blue", "purple", "amber", "gray"] as const;
export const evidenceRoles = ["Closest comparator", "Method precedent", "Evaluation baseline", "Context"] as const;
export const claimStatuses = ["Draft", "Needs evidence", "Ready to cite"] as const;
export const userRoles = ["viewer", "commenter", "editor"] as const;
export type UserRole = typeof userRoles[number] | "admin";
export type CommentKind = "paper" | "claim" | "draft";
export type DraftKey = "related" | "contribution";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)
  .refine(value => !Object.hasOwn(Object.prototype, value) && value !== "prototype", "Use a valid record ID.");
const note = z.string().max(12000);
const bibKey = /^[\w:.+/-]{1,100}$/;
const safeUrl = z.string().max(2000).refine(value => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Enter a full http:// or https:// source link.");

export const relationSchema = z.object({
  id, label: z.string().trim().min(1).max(55), description: z.string().trim().max(350), color: z.enum(colors),
});
export const fieldSchema = z.object({
  id, label: z.string().trim().min(1).max(75), description: z.string().trim().max(350),
  paper: z.boolean(), profile: z.boolean(),
}).refine(field => field.paper || field.profile, "Use the field on papers, the reference profile, or both.");
const values = z.record(id, note);

export const paperSchema = z.object({
  id, title: z.string().trim().min(1, "Enter a paper title.").max(500),
  authors: z.string().max(1500), short: z.string().max(120), venue: z.string().max(500),
  year: z.number().int().min(1).max(2999).nullable(), url: safeUrl,
  doi: z.string().trim().max(500).refine(value => !value || /^10\.\d{4,9}\/\S+$/i.test(value), "Enter a DOI such as 10.1234/example.").default(""),
  citeKey: z.string().trim().refine(value => !value || bibKey.test(value), "Use a valid BibTeX citation key."),
  bibtex: z.string().max(20000), tags: z.array(z.string().trim().min(1).max(50)).max(60),
  relation: id, values, added: z.number().int().nonnegative(),
}).superRefine((paper, ctx) => {
  if (!paper.bibtex.trim()) return;
  const key = pastedKey(paper.bibtex);
  if (!key) {
    ctx.addIssue({ code: "custom", message: "Paste one BibTeX entry, such as @article{author2026, …}." });
  } else if (paper.citeKey && paper.citeKey !== key) {
    ctx.addIssue({ code: "custom", message: "The citation key must match the BibTeX entry. Leave it blank to use the entry’s key." });
  }
});

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter an approach name.").max(130), source: note, values,
});

export const claimSchema = z.object({
  id, title: z.string().trim().min(1, "Enter a claim title.").max(160), statement: note,
  category: z.string().trim().max(75), status: z.enum(claimStatuses),
  evidence: z.array(z.object({ paperId: id, role: z.enum(evidenceRoles), note })).max(100),
});

export const reviewSchema = z.object({
  relations: z.array(relationSchema).min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(50)).max(300),
  fields: z.array(fieldSchema).max(100),
  papers: z.array(paperSchema).max(2000),
  profile: profileSchema, claims: z.array(claimSchema).max(300),
  drafts: z.object({ related: z.string().max(120000), contribution: z.string().max(120000) }),
}).superRefine((review, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const unique = (items: string[]) => new Set(items.map(labelKey)).size === items.length;
  if (!unique(review.relations.map(item => item.label)) || !unique(review.relations.map(item => item.id))) fail("Relation names and IDs must be unique.");
  if (!unique(review.fields.map(item => item.label)) || !unique(review.fields.map(item => item.id))) fail("Review field names and IDs must be unique.");
  if (!unique(review.tags)) fail("Tag names must be unique.");
  if (!review.relations.some(relation => relation.id === "unassessed")) fail("Keep a default relation for unclassified papers.");

  const relations = new Set(review.relations.map(item => item.id));
  const tags = new Set(review.tags);
  const paperFields = new Set(review.fields.filter(item => item.paper).map(item => item.id));
  const profileFields = new Set(review.fields.filter(item => item.profile).map(item => item.id));
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const paper of review.papers) {
    if (ids.has(paper.id)) fail("Each paper must have a unique ID.");
    ids.add(paper.id);
    const key = labelKey(citationKey(paper));
    if (keys.has(key)) fail("Each paper must have a unique citation key.");
    keys.add(key);
    if (!relations.has(paper.relation) || paper.tags.some(tag => !tags.has(tag)) || !unique(paper.tags)) fail("Each paper must use the review’s saved relations and tags.");
    if (Object.keys(paper.values).some(key => !paperFields.has(key))) fail("A paper has an unknown review field.");
  }
  if (Object.keys(review.profile.values).some(key => !profileFields.has(key))) fail("The reference profile has an unknown review field.");

  if (!unique(review.claims.map(item => item.id))) fail("Each claim must have a unique ID.");
  for (const claim of review.claims) {
    const references = claim.evidence.map(link => link.paperId);
    if (!unique(references) || references.some(key => !ids.has(key))) fail("Link each paper in a claim at most once.");
  }
});

export const reviewInfoSchema = z.object({
  title: z.string().trim().min(1, "Enter a review title.").max(120),
  description: z.string().trim().max(500),
});

export type Field = z.infer<typeof fieldSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Paper = z.infer<typeof paperSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type ReviewInfo = z.infer<typeof reviewInfoSchema>;
export type ReviewSummary = ReviewInfo & { id: string; public: boolean; publicPdfs: boolean };
export type User = { id: number; username: string; role: UserRole };
export type Attachment = { id: string; name: string; size: number; createdAt: number; url: string };
export type Comment = { id: string; author: string; body: string; createdAt: number; canDelete: boolean };

export const defaultRelations: Relation[] = [
  { id: "same-problem", label: "Same problem", description: "A close comparison that addresses the same research question.", color: "green" },
  { id: "related-problem", label: "Related problem", description: "An overlapping research question with a different scope or setting.", color: "blue" },
  { id: "method-only", label: "Method only", description: "A shared method applied to a different problem.", color: "purple" },
  { id: "background", label: "Background", description: "Context or a survey that frames the research area.", color: "amber" },
  { id: "unassessed", label: "To assess", description: "A paper that still needs to be classified.", color: "gray" },
];

export const defaultFields: Field[] = [
  { id: "problem", label: "Problem addressed", description: "What research question is being answered?", paper: true, profile: true },
  { id: "setting", label: "System setting", description: "What population, environment, or system is studied?", paper: true, profile: true },
  { id: "methodology", label: "Methodology", description: "Describe the method, design, and important methodological choices.", paper: true, profile: true },
  { id: "thesis", label: "Thesis", description: "Summarize the central argument or hypothesis.", paper: true, profile: true },
  { id: "assumptions", label: "Assumptions", description: "What constraints or assumptions shape the work?", paper: true, profile: true },
  { id: "evaluation", label: "Evaluation setup", description: "Record data, metrics, baselines, study design, or other evaluation details.", paper: true, profile: true },
  { id: "relevance", label: "Relation to my work", description: "Which part of your work does this paper inform?", paper: true, profile: false },
  { id: "difference", label: "Difference from my approach", description: "Describe differences you can substantiate.", paper: true, profile: false },
  { id: "notes", label: "Review notes", description: "Keep page numbers, unresolved questions, or follow-up checks.", paper: true, profile: false },
];

export function blankReview(): Review {
  return {
    relations: defaultRelations.map(item => ({ ...item })), fields: defaultFields.map(item => ({ ...item })),
    tags: [], papers: [], claims: [], profile: { name: "My approach", source: "", values: {} },
    drafts: { related: "\\section{Related Work}\n\n", contribution: "\\section{Contribution Positioning}\n\n" },
  };
}

export function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function newPaper(): Paper {
  return { id: newId(), added: Date.now(), title: "", authors: "", short: "", venue: "", year: null, url: "", doi: "",
    citeKey: "", bibtex: "", tags: [], relation: "unassessed", values: {} };
}

export function labelKey(label: string) { return label.normalize("NFKC").trim().toLowerCase(); }

export function pastedKey(bibtex: string) {
  const entry = bibtex.trim();
  const header = entry.match(/^@([a-z]+)\s*([({])\s*([^,\s]+)\s*,/i);
  if (!header || /^(comment|string|preamble)$/i.test(header[1]) || !bibKey.test(header[3])) return "";
  const close = header[2] === "{" ? "}" : ")";
  let braces = 0;
  let quoted = false;
  for (let index = header[0].length; index < entry.length; index += 1) {
    const char = entry[index];
    if (char === "\\") { index += 1; continue; }
    if (char === close && braces === 0 && !quoted) return index === entry.length - 1 ? header[3] : "";
    if (char === "{") braces += 1;
    if (char === "}") braces -= 1;
    if (char === '"' && braces === 0) quoted = !quoted;
    if (braces < 0) return "";
  }
  return "";
}

export function citationKey(paper: Paper) {
  return paper.citeKey || pastedKey(paper.bibtex) || "paper-" + paper.id.slice(0, 12);
}

export function authorLabel(authors: string) {
  const names = authors.split(/\s+and\s+|\s*;\s*/).map(name => name.trim()).filter(Boolean);
  if (names.length > 1) {
    const first = names[0];
    return (first.includes(",") ? first.split(",")[0] : first.split(/\s+/).at(-1)) + " et al.";
  }
  return names[0] || "";
}

export function latexText(value: string) {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
  };
  return value.replace(/[\\{}&%$#_^~]/g, character => replacements[character] ?? "\\" + character);
}

export function bibliography(papers: Paper[]) {
  return papers.map(paper => {
    if (pastedKey(paper.bibtex)) return paper.bibtex.trim() + "\n";
    const doi = paper.doi || paper.url.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d+\/[^?#]+)$/i)?.[1] || "";
    const isArticle = Boolean(doi && paper.venue);
    const fields = [
      ["title", "{" + latexText(paper.title) + "}"], ["author", latexText(paper.authors.replace(/\s*;\s*/g, " and "))],
      ["year", paper.year?.toString() || ""], [isArticle ? "journal" : "howpublished", latexText(paper.venue)],
      ["doi", latexText(doi)], ["url", latexText(paper.url)],
    ].filter(([, value]) => value);
    return (isArticle ? "@article{" : "@misc{") + citationKey(paper) + ",\n" +
      fields.map(([key, value]) => "  " + key + " = {" + value + "}").join(",\n") + "\n}\n";
  }).join("\n");
}

export function exportReview(info: ReviewInfo, review: Review) {
  return { format: "literature-desk", version: 1, title: info.title, description: info.description, review };
}

export function parseImport(input: unknown, title: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose an exported review JSON file.");
  const data = input as Record<string, unknown>;
  if (data.format === "literature-desk") {
    if (data.version !== 1) throw new Error("This export needs a different version of Review Desk.");
    return { info: reviewInfoSchema.parse({ title: title || data.title, description: data.description }), review: reviewSchema.parse(data.review) };
  }
  if (!Array.isArray(data.papers) || !Array.isArray(data.claims) || !data.profile || !data.drafts) {
    throw new Error("This file is missing the paper, profile, claim, or draft records.");
  }
  const seed = blankReview();
  const copyFields = (model: Record<string, unknown>, fields: Field[]) => Object.fromEntries(
    fields.filter(field => typeof model[field.id] === "string").map(field => [field.id, model[field.id]]),
  );
  const review = reviewSchema.parse({
    ...seed,
    tags: [...new Set(data.papers.flatMap(paper => Array.isArray(paper?.tags) ? paper.tags : []))],
    papers: data.papers.map(paper => ({ ...paper, values: copyFields(paper || {}, seed.fields.filter(field => field.paper)) })),
    profile: { ...(data.profile as object), values: copyFields(data.profile as Record<string, unknown>, seed.fields.filter(field => field.profile)) },
    claims: data.claims.map(claim => ({ ...claim, category: "" })),
    drafts: data.drafts,
  });
  return { info: reviewInfoSchema.parse({ title: title || "Imported literature review", description: "" }), review };
}

export function canEdit(user: User | null) { return user?.role === "admin" || user?.role === "editor"; }
export function canComment(user: User | null) { return canEdit(user) || user?.role === "commenter"; }
