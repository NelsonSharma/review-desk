import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react";
import { labelKey, newId, newPaper, paperSchema, type Field as ReviewField, type Paper, type Relation } from "./model";
import { Field, ErrorNotice } from "./review-ui";
import { MetadataSearch } from "./metadata-search";
import { normalizeDoi } from "./metadata";

export function PaperEditor({ paper, fields, relations, savedTags, onClose, onSave, onDelete, onDirty }: {
  paper?: Paper; fields: ReviewField[]; relations: Relation[]; savedTags: string[]; onClose: () => void; onSave: (paper: Paper, addedFields: ReviewField[]) => Promise<string>; onDelete: (id: string) => Promise<string>; onDirty: (dirty: boolean) => void;
}) {
  const [initial] = useState(() => paper ?? newPaper());
  const [draft, setDraft] = useState(initial);
  const [addedFields, setAddedFields] = useState<ReviewField[]>([]);
  const [fieldLabel, setFieldLabel] = useState("");
  const allFields = [...fields, ...addedFields];
  const [tagName, setTagName] = useState("");
  const tagChoices = [...new Set([...savedTags, ...draft.tags])].sort((a, b) => a.localeCompare(b));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || !!tagName.trim() || !!fieldLabel.trim() || addedFields.length > 0;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { document.getElementById("paper-editor-title")?.focus(); }, []);
  function addField() {
    const label = fieldLabel.trim();
    if (!label) return;
    if (allFields.some(field => labelKey(field.label) === labelKey(label))) { setError("A review field already uses that name."); return; }
    if (allFields.length >= 100) { setError("A review can have up to 100 fields."); return; }
    setAddedFields([...addedFields, { id: newId(), label, description: "", paper: true, profile: false }]);
    setFieldLabel(""); setError("");
  }
  const change = (values: Partial<Paper>) => setDraft(previous => ({ ...previous, ...values }));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = tagName.trim();
    const tag = tagChoices.find(item => labelKey(item) === labelKey(pending)) || pending;
    const tags = tag && !draft.tags.includes(tag) ? [...draft.tags, tag] : draft.tags;
    const parsed = paperSchema.safeParse({ ...draft, tags, url: draft.url.trim(), doi: normalizeDoi(draft.doi || ""), bibtex: draft.bibtex.trim() });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true);
    setError(await onSave(parsed.data, addedFields));
    setSaving(false);
  }
  function addTag() {
    const text = tagName.trim();
    if (!text) return;
    const tag = tagChoices.find(item => labelKey(item) === labelKey(text)) || text;
    if (!draft.tags.includes(tag)) change({ tags: [...draft.tags, tag] });
    setTagName("");
  }
  async function remove() {
    if (!paper) return;
    setSaving(true);
    setError(await onDelete(paper.id));
    setSaving(false);
  }
  return <section className="paper-editor" aria-labelledby="paper-editor-title">
    <header className="paper-editor-heading"><div><button type="button" className="text-button" disabled={saving} onClick={onClose}><ArrowLeft size={16} /> Back to library</button>
      <h1 id="paper-editor-title" tabIndex={-1}>{paper ? "Edit paper" : "Add a paper"}</h1>
      <p>Find the source, review its details, and add your research notes.</p></div>
      <span className="membership-label">{dirty ? "Unsaved changes" : "Not changed"}</span>
    </header>
    <fieldset className="metadata-lock" disabled={saving}><MetadataSearch draft={draft} editing={!!paper} onApply={value => { setDraft(value); setError(""); }} /></fieldset>
    <form className="paper-editor-form card" onSubmit={save}>
      <fieldset className="paper-editor-fields" disabled={saving}>
      <div className="form-content">
        <h2>Paper details</h2>
        <div className="form-grid">
          <Field label="Paper title" wide><input required maxLength={500} value={draft.title} onChange={e => change({ title: e.target.value })} placeholder="Enter the full title" /></Field>
          <Field label="Authors" wide><input maxLength={1500} value={draft.authors} onChange={e => change({ authors: e.target.value })} placeholder="First Author; Second Author" /></Field>
          <Field label="Year"><input type="number" min={1} max={2999} value={draft.year ?? ""} onChange={e => change({ year: e.target.value ? Number(e.target.value) : null })} placeholder="2026" /></Field>
          <Field label="Method short name"><input maxLength={120} value={draft.short} onChange={e => change({ short: e.target.value })} placeholder="Optional acronym" /></Field>
          <Field label="Venue" wide><input maxLength={500} value={draft.venue} onChange={e => change({ venue: e.target.value })} placeholder="Journal, conference, or preprint" /></Field>
          <Field label="Source URL" wide><input type="url" maxLength={2000} value={draft.url} onChange={e => change({ url: e.target.value })} placeholder="https://doi.org/…" /></Field>
          <Field label="DOI" help="Optional identifier, e.g. 10.1234/example. A DOI link is accepted too." wide><input maxLength={500} value={draft.doi || ""} onChange={e => change({ doi: e.target.value })} placeholder="10.…/…" /></Field>
          <Field label="Citation key" help="Leave blank to use the pasted BibTeX key or generate a stable key." wide><input maxLength={100} value={draft.citeKey} onChange={e => change({ citeKey: e.target.value })} placeholder="author2026method" /></Field>
          <Field label="BibTeX entry" help="Paste one complete entry or let the bibliography use the paper details above." wide><textarea className="code-input" rows={6} maxLength={20000} value={draft.bibtex} onChange={e => change({ bibtex: e.target.value })} placeholder={"@article{author2026, …}"} /></Field>
          <Field label="Relation category" help={relations.find(item => item.id === draft.relation)?.description} wide>
            <select value={draft.relation} onChange={e => change({ relation: e.target.value })}>{relations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </Field>
          <fieldset className="tag-picker field full"><legend>Tags</legend>
            <div className="pick-tags">{tagChoices.map(tag => <button className={"tag" + (draft.tags.includes(tag) ? " chosen" : "")} key={tag} type="button" aria-pressed={draft.tags.includes(tag)}
              onClick={() => change({ tags: draft.tags.includes(tag) ? draft.tags.filter(item => item !== tag) : [...draft.tags, tag] })}>{draft.tags.includes(tag) && <Check size={12} />}{tag}</button>)}</div>
            <div className="inline-field"><input aria-label="New tag" value={tagName} maxLength={50} placeholder="Enter a tag" onChange={event => setTagName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} />
              <button type="button" className="button secondary compact" disabled={!tagName.trim()} onClick={addTag}><Plus size={15} /> Add tag</button></div>
          </fieldset>
        </div>
        <h3 className="form-heading">Review notes</h3>
        <div className="form-grid paper-notes">{allFields.filter(field => field.paper).map(({ id, label, description }) =>
          <Field label={label} key={id}><textarea rows={3} maxLength={12000} value={draft.values[id] ?? ""} onChange={e => change({ values: { ...draft.values, [id]: e.target.value } })} placeholder={description} /></Field>)}</div>
        <div className="inline-field profile-add"><Field label="New custom review field"><input maxLength={75} value={fieldLabel} onChange={e => setFieldLabel(e.target.value)} placeholder="e.g. Sample size" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addField(); } }} /></Field><button type="button" className="button secondary" disabled={!fieldLabel.trim()} onClick={addField}><Plus size={15} /> Add field</button></div>
        {deletePrompt && <div className="delete-prompt"><strong>Delete this paper?</strong><p>Its attachments, comments, and links from claims will also be removed.</p><button className="button danger compact" type="button" disabled={saving} onClick={remove}>Delete paper</button><button type="button" className="button secondary compact" onClick={() => setDeletePrompt(false)}>Keep paper</button></div>}
      </div>
      </fieldset>
      <footer className="dialog-footer paper-editor-footer">
        <ErrorNotice message={error} />
        {paper && <button type="button" className="icon-button delete-action" aria-label="Delete paper" title="Delete paper" onClick={() => setDeletePrompt(true)} disabled={saving}><Trash2 size={17} /></button>}
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save paper"}</button>
      </footer>
    </form>
  </section>;
}
