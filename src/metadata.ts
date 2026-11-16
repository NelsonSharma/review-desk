import { labelKey, pastedKey, type Paper } from "./model.ts";

export const metadataSources = [
  { id: "crossref", label: "Crossref", description: "Published papers and DOI records" },
  { id: "arxiv", label: "arXiv", description: "Preprints in computing, mathematics, physics, and related fields" },
] as const;
export type MetadataSource = typeof metadataSources[number]["id"];
export const metadataFields = ["title", "authors", "year", "venue", "doi", "url"] as const;
export type MetadataField = typeof metadataFields[number];
export type MetadataResult = Pick<Paper, MetadataField> & { sources: MetadataSource[] };
export type MetadataResponse = { results: MetadataResult[]; warnings: { source: MetadataSource; message: string }[] };
export type BibtexResponse = { bibtex: string; citeKey: string; source: "crossref"; warning: string };
export const metadataLabels: Record<MetadataField, string> = {
  title: "Paper title", authors: "Authors", year: "Year", venue: "Venue", doi: "DOI", url: "Source URL",
};

export function normalizeDoi(input: string) {
  const value = input.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  try { return /^https?:\/\//i.test(input.trim()) ? decodeURIComponent(value) : value; } catch { return value; }
}

export function doiUrl(doi: string) { return "https://doi.org/" + doi.split("/").map(encodeURIComponent).join("/"); }

// Keep the citation key and entry together, including when a key is already in use.
export function prepareBibtexImport(entry: string, usedKeys: string[]) {
  const bibtex = entry.trim();
  const original = pastedKey(bibtex);
  if (!original || bibtex.length > 20000) return null;
  const taken = new Set(usedKeys.map(labelKey));
  let citeKey = original;
  for (let number = 2; taken.has(labelKey(citeKey)); number += 1) {
    const suffix = "-" + number;
    citeKey = original.slice(0, 100 - suffix.length) + suffix;
  }
  const updated = bibtex.replace(/^(@[a-z]+\s*[({]\s*)[^,\s]+/i, (_match, prefix) => prefix + citeKey);
  return updated.length <= 20000 ? { bibtex: updated, citeKey } : null;
}

export function metadataChanges(paper: Paper, result: MetadataResult) {
  return metadataFields.filter(key => result[key] !== "" && result[key] !== null && result[key] !== (paper[key] ?? ""));
}

// Deliberately restrict imports to bibliographic fields. Notes and custom fields never change.
export function applyMetadata(paper: Paper, result: MetadataResult, fields: MetadataField[]): Paper {
  const next = { ...paper };
  for (const key of metadataFields) {
    if (fields.includes(key) && result[key] !== "" && result[key] !== null) Object.assign(next, { [key]: result[key] });
  }
  return next;
}
