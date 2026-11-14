import { cloneElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { ArrowUpRight, Check, Columns3, FileText, Link2, Palette, Pencil, Plus, Trash2, X } from "lucide-react";
import { citationKey, labelKey, newId, newPaper, paperSchema, profileSchema, evidenceRoles, claimSchema, claimStatuses, type Claim, type Field as ReviewField, type Paper, type Profile, type Relation, type Review } from "./model";

export function RelationTag({ relation }: { relation: Relation }) {
  const { label, color } = relation;
  return <span className={"relation-badge " + color}><span />{label}</span>;
}

export function Tags({ tags, limit = tags.length }: { tags: string[]; limit?: number }) {
  return tags.length ? <span className="tag-list">{tags.slice(0, limit).map(tag => <span className="tag" key={tag}>{tag}</span>)}{tags.length > limit && <span className="tag-more" title={tags.slice(limit).join(", ")}>+{tags.length - limit}</span>}</span> : <span className="empty-value">—</span>;
}

export function Modal({ title, subtitle, drawer, onClose, children }: {
  title: string; subtitle?: string; drawer?: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, []);
  return <dialog ref={dialog} className={drawer ? "dialog drawer" : "dialog"} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-shell">
      <header className="dialog-header">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button>
      </header>
      {children}
    </div>
  </dialog>;
}

export function Field({ label, help, children, wide }: {
  label: string; help?: string; children: ReactElement<{ "aria-labelledby"?: string; "aria-describedby"?: string }>; wide?: boolean;
}) {
  const id = useId();
  return <label className={wide ? "field full" : "field"}><span id={id}>{label}</span>
    {cloneElement(children, { "aria-labelledby": id, "aria-describedby": help ? id + "-help" : undefined })}
    {help && <small id={id + "-help"}>{help}</small>}</label>;
}

export function ErrorNotice({ message }: { message: string }) {
  return message ? <p role="alert" className="form-error">{message}</p> : null;
}

export function PaperDetails({ paper, fields, relation, claims, selected, onEdit, onToggle, onClaim, onClose, children }: {
  paper: Paper; fields: ReviewField[]; relation: Relation; claims: Claim[]; selected: boolean; onEdit?: () => void; onToggle: () => void; onClaim: (id: string) => void; onClose: () => void; children: ReactNode;
}) {
  const links = claims.flatMap(claim => claim.evidence.filter(item => item.paperId === paper.id).map(item => ({ claim, item })));
  return <Modal title="Paper details" onClose={onClose} drawer>
    <div className="dialog-scroll paper-details">
      <div className="detail-top"><span className="paper-glyph large"><FileText size={23} /></span><RelationTag relation={relation} /></div>
      <h3>{paper.title}</h3>
      <p className="detail-byline">{[paper.authors.replace(/\s+and\s+/g, "; "), paper.year, paper.venue].filter(Boolean).join(" · ")}</p>
      <Tags tags={paper.tags} />
      <div className="detail-actions">
        {paper.url && <a className="button secondary compact" href={paper.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={15} /></a>}
        <button type="button" className={selected ? "button secondary compact is-selected" : "button secondary compact"} onClick={onToggle}>{selected ? <Check size={15} /> : <Columns3 size={15} />}{selected ? "In comparison" : "Add to comparison"}</button>
      </div>
      <dl className="paper-facts">{fields.filter(field => field.paper).map(({ id, label }) => <div key={id} className={id === "difference" ? "difference" : ""}>
        <dt>{label}</dt><dd>{paper.values[id] || <span className="empty-value">Pending review</span>}</dd>
      </div>)}</dl>
      <section className="linked-details">
        <h4>Linked claims</h4>
        {links.length ? links.map(({ claim, item }) => <button type="button" className="linked-claim" key={claim.id} onClick={() => onClaim(claim.id)}>
          <div><strong>{claim.title}</strong><span>{item.role}</span></div><ArrowUpRight size={16} />
        </button>) : <p>No linked claims yet.</p>}
        <div className="citation-key"><span>Citation key</span><code>{citationKey(paper)}</code></div>
        {paper.bibtex && <details className="citation-detail"><summary>BibTeX entry</summary><pre>{paper.bibtex}</pre></details>}
      </section>
      {children}
    </div>
    <footer className="dialog-footer">{onEdit ? <button type="button" className="button primary" onClick={onEdit}><Pencil size={15} /> Edit paper</button> : <button type="button" className="button secondary" onClick={onClose}>Close</button>}</footer>
  </Modal>;
}

export function PaperForm({ paper, fields, relations, savedTags, onClose, onSave, onDelete }: {
  paper?: Paper; fields: ReviewField[]; relations: Relation[]; savedTags: string[]; onClose: () => void; onSave: (paper: Paper) => Promise<string>; onDelete: (id: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState(() => paper ?? newPaper());
  const [tagName, setTagName] = useState("");
  const tagChoices = [...new Set([...savedTags, ...draft.tags])].sort((a, b) => a.localeCompare(b));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState(false);
  const change = (values: Partial<Paper>) => setDraft(previous => ({ ...previous, ...values }));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = tagName.trim();
    const tag = tagChoices.find(item => labelKey(item) === labelKey(pending)) || pending;
    const tags = tag && !draft.tags.includes(tag) ? [...draft.tags, tag] : draft.tags;
    const parsed = paperSchema.safeParse({ ...draft, tags, url: draft.url.trim(), bibtex: draft.bibtex.trim() });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true);
    setError(await onSave(parsed.data));
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
  return <Modal title={paper ? "Edit paper" : "Add a paper"} subtitle="Capture the source and how it relates to your research." onClose={() => { if (!saving) onClose(); }} drawer>
    <form className="dialog-form" onSubmit={save}>
      <div className="dialog-scroll form-content">
        <div className="form-grid">
          <Field label="Paper title" wide><input required maxLength={500} value={draft.title} onChange={e => change({ title: e.target.value })} placeholder="Enter the full title" /></Field>
          <Field label="Authors" wide><input maxLength={1500} value={draft.authors} onChange={e => change({ authors: e.target.value })} placeholder="First Author; Second Author" /></Field>
          <Field label="Year"><input type="number" min={1} max={2999} value={draft.year ?? ""} onChange={e => change({ year: e.target.value ? Number(e.target.value) : null })} placeholder="2026" /></Field>
          <Field label="Method short name"><input maxLength={120} value={draft.short} onChange={e => change({ short: e.target.value })} placeholder="Optional acronym" /></Field>
          <Field label="Venue" wide><input maxLength={500} value={draft.venue} onChange={e => change({ venue: e.target.value })} placeholder="Journal, conference, or preprint" /></Field>
          <Field label="Source URL" wide><input type="url" maxLength={2000} value={draft.url} onChange={e => change({ url: e.target.value })} placeholder="https://doi.org/…" /></Field>
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
        <div className="form-grid">{fields.filter(field => field.paper).map(({ id, label, description }) =>
          <Field label={label} key={id} wide><textarea rows={3} maxLength={12000} value={draft.values[id] ?? ""} onChange={e => change({ values: { ...draft.values, [id]: e.target.value } })} placeholder={description} /></Field>)}</div>
        {deletePrompt && <div className="delete-prompt"><strong>Delete this paper?</strong><p>Its attachments, comments, and links from claims will also be removed.</p><button className="button danger compact" type="button" disabled={saving} onClick={remove}>Delete paper</button><button type="button" className="button secondary compact" onClick={() => setDeletePrompt(false)}>Keep paper</button></div>}
      </div>
      <footer className="dialog-footer">
        <ErrorNotice message={error} />
        {paper && <button type="button" className="icon-button delete-action" aria-label="Delete paper" title="Delete paper" onClick={() => setDeletePrompt(true)} disabled={saving}><Trash2 size={17} /></button>}
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save paper"}</button>
      </footer>
    </form>
  </Modal>;
}

export function ProfileForm({ profile, fields, onClose, onSave }: { profile: Profile; fields: ReviewField[]; onClose: () => void; onSave?: (profile: Profile, addedFields: ReviewField[]) => Promise<string> }) {
  const [draft, setDraft] = useState(profile);
  const [addedFields, setAddedFields] = useState<ReviewField[]>([]);
  const [fieldLabel, setFieldLabel] = useState("");
  const allFields = [...fields, ...addedFields];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSave) return;
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true);
    setError(await onSave(parsed.data, addedFields));
    setSaving(false);
  }
  function addField() {
    const label = fieldLabel.trim();
    if (!label) return;
    if (allFields.some(item => labelKey(item.label) === labelKey(label))) { setError("A review field already uses that name."); return; }
    setAddedFields([...addedFields, { id: newId(), label, description: "", paper: false, profile: true }]);
    setFieldLabel("");
    setError("");
  }
  return <Modal title="Reference profile" subtitle="Your approach appears alongside the papers in the comparison." onClose={() => { if (!saving) onClose(); }} drawer>
    <form className="dialog-form" onSubmit={save}>
      <div className="dialog-scroll form-content">
        <div className="form-grid">
          <Field label="Approach name" wide><input required maxLength={130} readOnly={!onSave} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          {allFields.filter(field => field.profile).map(({ id, label, description }) => <Field key={id} label={label} wide><textarea rows={3} maxLength={12000} placeholder={onSave ? description : "—"} readOnly={!onSave} value={draft.values[id] ?? ""}
            onChange={e => setDraft({ ...draft, values: { ...draft.values, [id]: e.target.value } })} /></Field>)}
          {onSave && <div className="inline-field full profile-add"><Field label="New profile field"><input maxLength={75} value={fieldLabel} placeholder="e.g. Unit of analysis"
            onChange={event => setFieldLabel(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} /></Field>
            <button type="button" className="button secondary compact" disabled={!fieldLabel.trim() || saving} onClick={addField}><Plus size={15} /> Add field</button></div>}
          <Field label="Source note" wide><textarea rows={2} maxLength={12000} readOnly={!onSave} value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} /></Field>
        </div>
      </div>
      <footer className="dialog-footer"><ErrorNotice message={error} /><button className="button secondary" type="button" onClick={onClose} disabled={saving}>{onSave ? "Cancel" : "Close"}</button>
        {onSave && <button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>}</footer>
    </form>
  </Modal>;
}

export function ClaimForm({ claim, papers, onClose, onSave, onDelete }: {
  claim?: Claim; papers: Paper[]; onClose: () => void; onSave: (claim: Claim) => Promise<string>; onDelete: (id: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState<Claim>(() => claim ?? { id: newId(), title: "", category: "", statement: "", status: "Draft", evidence: [] });
  const [paperId, setPaperId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletePrompt, setDeletePrompt] = useState(false);
  const available = papers.filter(paper => !draft.evidence.some(link => link.paperId === paper.id));
  function addLink() {
    if (!available.some(paper => paper.id === paperId)) return;
    setDraft({ ...draft, evidence: [...draft.evidence, { paperId, role: "Closest comparator", note: "" }] });
    setPaperId("");
  }
  function editLink(id: string, updates: Partial<Claim["evidence"][number]>) {
    setDraft(current => ({ ...current, evidence: current.evidence.map(link => link.paperId === id ? { ...link, ...updates } : link) }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = claimSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true);
    setError(await onSave(parsed.data));
    setSaving(false);
  }
  async function remove() {
    if (!claim) return;
    setSaving(true);
    setError(await onDelete(claim.id));
    setSaving(false);
  }
  return <Modal title={claim ? "Edit claim" : "Add a claim"} subtitle="Connect a positioning statement to the papers that support or qualify it." onClose={() => { if (!saving) onClose(); }} drawer>
    <form className="dialog-form" onSubmit={save}>
      <div className="dialog-scroll form-content">
        <div className="form-grid">
          <Field label="Claim title" wide><input required maxLength={160} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="What contribution are you positioning?" /></Field>
          <Field label="Category" wide><input maxLength={75} placeholder="e.g. Evaluation or Theory" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></Field>
          <Field label="Status" wide><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Claim["status"] })}>{claimStatuses.map(status => <option key={status}>{status}</option>)}</select></Field>
          <Field label="Statement" wide><textarea rows={4} maxLength={12000} value={draft.statement} onChange={e => setDraft({ ...draft, statement: e.target.value })} placeholder="State the contribution and the scope of the comparison." /></Field>
        </div>
        <h3 className="form-heading">Paper evidence</h3>
        <div className="evidence-picker"><select aria-label="Paper to link" value={paperId} onChange={e => setPaperId(e.target.value)}>
          <option value="">Choose a paper</option>{available.map(paper => <option key={paper.id} value={paper.id}>{paper.short || paper.title}</option>)}
        </select><button className="button secondary" type="button" onClick={addLink} disabled={!paperId}><Plus size={16} /> Link paper</button></div>
        {draft.evidence.map(link => {
          const paper = papers.find(item => item.id === link.paperId);
          return <div className="evidence-edit" key={link.paperId}>
            <div className="evidence-edit-title"><strong title={paper?.title}>{paper?.short || paper?.title}</strong><button type="button" className="icon-button" aria-label={"Remove " + (paper?.short || "paper")} onClick={() => setDraft({ ...draft, evidence: draft.evidence.filter(item => item.paperId !== link.paperId) })}><X size={16} /></button></div>
            <Field label="How this paper is used"><select value={link.role} onChange={e => editLink(link.paperId, { role: e.target.value as typeof link.role })}>{evidenceRoles.map(role => <option key={role}>{role}</option>)}</select></Field>
            <Field label="Evidence note"><textarea rows={2} maxLength={12000} value={link.note} onChange={e => editLink(link.paperId, { note: e.target.value })} /></Field>
          </div>;
        })}
        {deletePrompt && <div className="delete-prompt"><strong>Delete this claim?</strong><p>The linked papers will stay in your library.</p><button type="button" className="button danger compact" disabled={saving} onClick={remove}>Delete claim</button><button type="button" className="button secondary compact" onClick={() => setDeletePrompt(false)}>Keep claim</button></div>}
      </div>
      <footer className="dialog-footer"><ErrorNotice message={error} />
        {claim && <button type="button" className="icon-button delete-action" aria-label="Delete claim" title="Delete claim" onClick={() => setDeletePrompt(true)} disabled={saving}><Trash2 size={17} /></button>}
        <button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="button primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save claim"}</button>
      </footer>
    </form>
  </Modal>;
}


const themes = {
  Light: { lavender: "Lavender", paper: "Paper" },
  Dark: { midnight: "Midnight", forest: "Forest" },
};

export function ThemeControl() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "lavender");
  return <label className="theme-control" title="Color theme"><Palette size={17} />
    <select aria-label="Color theme" value={theme} onChange={event => {
      const value = event.target.value;
      document.documentElement.dataset.theme = value;
      setTheme(value);
      try { localStorage.setItem("literature-desk-theme", value); } catch { /* Keep the selection for this visit. */ }
    }}>{Object.entries(themes).map(([group, variants]) => <optgroup key={group} label={group}>
      {Object.entries(variants).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</optgroup>)}</select>
  </label>;
}
