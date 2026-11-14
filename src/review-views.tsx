import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpen, ChevronDown, ChevronUp, CircleAlert, Columns3, Copy, Download,
  FileText, Link2, Pencil, Plus, Save, Search, Target, X,
} from "lucide-react";
import katex from "katex";
import { authorLabel, citationKey, type Claim, type DraftKey, type Field, type Paper, type Profile, type Relation, type Review } from "./model";
import { RelationTag, Tags } from "./review-ui";

export function download(filename: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PageHeader({ title, description, actions }: { title: string; description: string; actions: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{actions}</div></header>;
}

export function Comparison({ profile, fields, relations, selected, papers, max, editable, onToggle, onProfile, onFields, onOpenPaper, onLibrary }: {
  profile: Profile; fields: Field[]; relations: Map<string, Relation>; selected: Paper[]; papers: Paper[]; max: number; editable: boolean;
  onToggle: (id: string) => void; onProfile: () => void; onFields: () => void;
  onOpenPaper: (id: string) => void; onLibrary: () => void;
}) {
  const [nextPaper, setNextPaper] = useState("");
  const available = papers.filter(paper => !selected.some(item => item.id === paper.id));
  const canAdd = selected.length < max && available.length > 0;
  function exportComparison() {
    const quote = (value: string) => {
      const safe = /^\s*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const rows = [
      ["Field", profile.name, ...selected.map(paper => paper.title)],
      ["Year", "", ...selected.map(paper => paper.year?.toString() ?? "")],
      ["Relation category", "", ...selected.map(paper => relations.get(paper.relation)?.label ?? "")],
      ["Tags", "", ...selected.map(paper => paper.tags.join(", "))],
      ...fields.map(field => [field.label, profile.values[field.id] ?? "", ...selected.map(paper => paper.values[field.id] ?? "")]),
    ];
    download("paper-comparison.csv", rows.map(row => row.map(quote).join(",")).join("\r\n"), "text/csv;charset=utf-8");
  }
  return <div className="secondary-page">
    <PageHeader title="Compare papers" description="Compare problem settings, methods, and assumptions against your approach." actions={<>
      <button type="button" className="button secondary" onClick={exportComparison} disabled={!selected.length}><Download size={16} /> Export CSV</button>
      {editable && <button type="button" className="button secondary" onClick={onFields}>Manage fields</button>}
      <button type="button" className="button primary" onClick={onProfile}>{editable && <Pencil size={16} />}{editable ? "Edit profile" : "Reference profile"}</button>
    </>} />
    <div className="compare-controls">
      <div className="compare-picker"><label htmlFor="compare-select"><Columns3 size={17} /> Comparison papers</label><div>
        <select id="compare-select" value={nextPaper} onChange={e => setNextPaper(e.target.value)} disabled={!canAdd}>
          <option value="">{selected.length >= max ? "Comparison is full" : available.length ? "Choose a paper" : "No more papers"}</option>
          {available.map(paper => <option key={paper.id} value={paper.id}>{(paper.short ? paper.short + " · " : "") + paper.title}</option>)}
        </select>
        <button type="button" className="button secondary" disabled={!canAdd || !available.some(paper => paper.id === nextPaper)} onClick={() => { onToggle(nextPaper); setNextPaper(""); }}><Plus size={16} /> Add</button>
      </div></div>
      <button type="button" className="text-button" onClick={onLibrary}>Open paper library <ArrowRight size={15} /></button>
    </div>
    <div className="compare-card table-wrap">
      <table className="matrix" aria-label="Side-by-side comparison">
        <thead><tr>
          <th scope="col"><div className="matrix-field">Review field</div></th>
          <th scope="col" className="reference-cell"><span className="matrix-type"><Target size={16} /> My approach</span><strong>{profile.name}</strong></th>
          {selected.map(paper => <th key={paper.id} scope="col">
            <div className="matrix-paper-top"><RelationTag relation={relations.get(paper.relation)!} /><button className="icon-button" type="button" aria-label={"Remove " + (paper.short || paper.title) + " from comparison"} onClick={() => onToggle(paper.id)}><X size={16} /></button></div>
            <button type="button" className="matrix-paper-name" title={paper.title} onClick={() => onOpenPaper(paper.id)}>{paper.short || paper.title} <ArrowUpRight size={14} /></button>
            <span className="matrix-author">{[authorLabel(paper.authors), paper.year].filter(Boolean).join(" · ")}</span>
          </th>)}
        </tr></thead>
        <tbody>
          {!selected.length && <tr><th scope="row">Selection</th><td className="reference-cell"><span className="empty-value">Add a paper to compare against {profile.name}.</span></td></tr>}
          {fields.filter(field => selected.length || field.profile).map(({ id, label, profile: onProfile, paper: onPaper }) => <tr key={id}>
            <th scope="row">{label}</th>
            <td className="reference-cell">{(onProfile && profile.values[id]) || <span className="empty-value">—</span>}</td>
            {selected.map(paper => <td key={paper.id}>{paper.values[id] || <span className="empty-value">{onPaper ? "Pending review" : "—"}</span>}</td>)}
          </tr>)}
          {!!selected.length && <tr><th scope="row">Tags</th><td className="reference-cell"><span className="empty-value">—</span></td>{selected.map(paper => <td key={paper.id}><Tags tags={paper.tags} /></td>)}</tr>}
        </tbody>
      </table>
    </div>
    {profile.source && <p className="matrix-footnote"><Link2 size={16} /> {profile.source}</p>}
  </div>;
}

export function Positioning({ claims, papers, name, highlight, editable, onAdd, onEdit, onOpenPaper, onInsertClaim, onDrafts, thread }: {
  claims: Claim[]; papers: Paper[]; name: string; highlight?: string; editable: boolean; onAdd: () => void; onEdit: (id: string) => void;
  thread: (id: string) => ReactNode;
  onOpenPaper: (id: string) => void; onInsertClaim: (claim: Claim) => void; onDrafts: () => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const categories = [...new Set(claims.map(claim => claim.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  useEffect(() => {
    if (!highlight) return;
    setCategory("");
    setCollapsed(current => current.filter(id => id !== highlight));
    requestAnimationFrame(() => document.getElementById("claim-" + highlight)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [highlight, claims]);
  return <div className="secondary-page">
    <PageHeader title="Contribution positioning" description={`Track the papers that support each claim about ${name}.`} actions={<>
      <button type="button" className="button secondary" onClick={onDrafts}><FileText size={16} /> Open drafts</button>
      {editable && <button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> Add claim</button>}
    </>} />
    {!claims.length && <div className="empty-state card"><Target size={30} /><h3>No positioning claims yet</h3>
      {editable && <><p>Add a claim and link a paper to document the comparison.</p><button type="button" className="button primary compact" onClick={onAdd}>Add a claim</button></>}</div>}
    {categories.length > 0 && <label className="category-filter"><span>Category</span><select aria-label="Filter claims by category" value={category} onChange={event => setCategory(event.target.value)}>
      <option value="">All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>}
    <div className="claim-list">{claims.filter(claim => !category || category === claim.category).map(claim => {
      const isCollapsed = collapsed.includes(claim.id);
      const statusColor = claim.status === "Ready to cite" ? "green" : claim.status === "Needs evidence" ? "amber" : "purple";
      return <article key={claim.id} className={"claim-card" + (highlight === claim.id ? " highlighted" : "")} id={"claim-" + claim.id}>
        <div className="claim-top">
          <span className="claim-icon"><Target size={21} /></span>
          <div><div className="claim-title-row"><h2>{claim.title}</h2>{claim.category && <span className="tag">{claim.category}</span>}<span className={"relation-badge " + statusColor}><span />{claim.status}</span></div><p>{claim.statement || "Draft a statement for this claim."}</p></div>
          {editable && <div className="claim-actions"><button className="icon-button" type="button" onClick={() => onInsertClaim(claim)} aria-label={"Insert " + claim.title + " into draft"} title="Insert into contribution draft"><FileText size={16} /></button><button type="button" className="button secondary compact" onClick={() => onEdit(claim.id)}><Pencil size={14} /> Edit</button></div>}
        </div>
        <button type="button" className="evidence-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed(current => current.includes(claim.id) ? current.filter(id => id !== claim.id) : [...current, claim.id])}>
          <Link2 size={16} /> {claim.evidence.length} linked {claim.evidence.length === 1 ? "paper" : "papers"} {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {!isCollapsed && <div className="claim-evidence">{claim.evidence.length ? claim.evidence.map(link => {
          const paper = papers.find(item => item.id === link.paperId);
          if (!paper) return null;
          return <div key={link.paperId} className="evidence-row"><button type="button" title={paper.title} onClick={() => onOpenPaper(paper.id)}>{paper.short || paper.title}<ArrowUpRight size={13} /></button><span className="tag">{link.role}</span><p>{link.note || "Evidence note pending."}</p></div>;
        }) : <p className="evidence-empty">No papers linked yet.</p>}</div>}
        {!isCollapsed && <div className="claim-thread">{thread(claim.id)}</div>}
      </article>;
    })}</div>
  </div>;
}

const draftLabels = { related: "Related work", contribution: "Contribution positioning" } as const;
const draftNames = { related: "related_work.tex", contribution: "contribution_positioning.tex" } as const;

export function Drafts({ active, onTab, drafts, saved, papers, editable, onChange, onSave, onNotify, onBibliography, thread }: {
  active: DraftKey; onTab: (tab: DraftKey) => void; drafts: Review["drafts"]; saved: Review["drafts"]; papers: Paper[]; editable: boolean; thread: (id: DraftKey) => ReactNode;
  onChange: (drafts: Review["drafts"]) => void; onSave: (drafts: Review["drafts"]) => Promise<string>; onNotify: (text: string) => void;
  onBibliography: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showPreview, setShowPreview] = useState(!editable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = drafts.related !== saved.related || drafts.contribution !== saved.contribution;
  const value = drafts[active];
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return papers.filter(paper => words.every(word => [paper.title, paper.short, paper.authors, citationKey(paper)].join(" ").toLowerCase().includes(word)));
  }, [papers, query]);
  const citationMap = useMemo(() => new Map(papers.map(paper => [citationKey(paper), paper])), [papers]);
  const missing = useMemo(() => [...new Set(Array.from(value.matchAll(new RegExp(citePattern, "g")), match => match[1].split(",")).flat().map(key => key.trim()).filter(key => key && !citationMap.has(key)))], [value, citationMap]);

  function edit(text: string) { onChange({ ...drafts, [active]: text }); }
  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(await onSave(drafts));
    setSaving(false);
  }
  function insertCitation(paper: Paper) {
    const text = "\\cite{" + citationKey(paper) + "}";
    const textarea = editor.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const combined = value.slice(0, start) + text + value.slice(end);
    if (combined.length > 120000) {
      setError("This draft has reached its character limit.");
      return;
    }
    edit(combined);
    setShowPreview(false);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  async function copy() {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(value);
      else {
        if (!editor.current) { setShowPreview(false); throw new Error("Switch to the editor to copy."); }
        editor.current.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
      }
      onNotify("LaTeX copied");
    } catch {
      setError("Clipboard access is unavailable. Download the LaTeX instead.");
    }
  }

  return <div className="secondary-page">
    <PageHeader title="Drafts" description="Write and revise your related work and contribution positioning." actions={<>
      <button className="button secondary" type="button" onClick={onBibliography}><Download size={16} /> BibTeX</button>
      {editable && <button className="button primary" type="button" disabled={!dirty || saving} onClick={save}><Save size={16} /> {saving ? "Saving…" : "Save drafts"}</button>}
    </>} />
    <div className={"draft-grid" + (editable ? "" : " reader")}>
      <section className="draft-card" aria-label="Draft editor">
        <div className="draft-tabs" aria-label="Draft section">{Object.entries(draftLabels).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={active === key} onClick={() => { onTab(key as DraftKey); setError(""); }}>{label}</button>)}</div>
        <div className="editor-toolbar">
          <div className="mode-switch"><button type="button" aria-pressed={!showPreview} onClick={() => setShowPreview(false)}>LaTeX</button>
            <button type="button" aria-pressed={showPreview} onClick={() => setShowPreview(true)}>Preview</button></div>
          <div className="editor-actions"><button type="button" className="icon-button" aria-label="Copy LaTeX" title="Copy LaTeX" onClick={copy}><Copy size={17} /></button>
            <button type="button" className="icon-button" aria-label="Download LaTeX" title="Download LaTeX" onClick={() => download(draftNames[active], value)}><Download size={17} /></button></div>
        </div>
        {showPreview ? <DraftPreview value={value} papers={citationMap} /> : <textarea
          className="draft-editor" rows={24} ref={editor} aria-label={draftLabels[active] + " LaTeX draft"}
          maxLength={120000} readOnly={!editable} spellCheck={false} value={value} placeholder={"\\section{" + draftLabels[active] + "}"} onChange={event => edit(event.target.value)} />}
        {missing.length > 0 && <div className="draft-warning" role="status"><CircleAlert size={16} /><span>Missing from bibliography: <code>{missing.join(", ")}</code></span></div>}
        {error && <p className="form-error draft-error" role="alert">{error}</p>}
        <div className="editor-footer"><span>{value.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words</span><span>{dirty ? "Unsaved edits" : "Saved draft"}</span></div>
      </section>
      {editable && <aside className="citation-panel">
        <div className="citation-heading"><span className="claim-icon"><BookOpen size={18} /></span><div><h2>Paper citations</h2><p>Insert a citation at the cursor.</p></div></div>
        <div className="search-box"><Search size={17} /><input aria-label="Search citation list" placeholder="Find a citation…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="citation-list">{results.length ? results.map(paper => <div className="citation-row" key={paper.id}>
          <div><strong title={paper.title}>{paper.short || paper.title}</strong><small>{[authorLabel(paper.authors), paper.year].filter(Boolean).join(" · ")}</small></div>
          <button type="button" className="icon-button" title="Insert citation" aria-label={"Cite " + (paper.short || paper.title)} onClick={() => insertCitation(paper)}><Plus size={17} /></button>
        </div>) : <p className="evidence-empty">No matching papers.</p>}</div>
      </aside>}
    </div>
    <div className="draft-thread card">{thread(active)}</div>
  </div>;
}

const citePattern = String.raw`\\cite\w*(?:\[[^\]]*\]){0,2}\{([^}]+)\}`;
const piecePattern = new RegExp(String.raw`(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$[^\n$]+?\$|` + citePattern.replace("([^}]+)", "[^}]+") + ")", "g");

function DraftPreview({ value, papers }: { value: string; papers: Map<string, Paper> }) {
  function plain(text: string) {
    return text.replace(/\\(?:textit|textbf|emph)\{([^}]+)\}/g, "$1").replace(/~+/g, " ")
      .replaceAll("---", "—").replaceAll("--", "–").replace(/\\([%&#_$])/g, "$1");
  }
  return <div className="draft-preview" aria-label="Readable draft preview">
    {value.trim() ? value.trim().split(/\n\s*\n/).map((part, index) => {
      const heading = part.match(/^\\(section|subsection|subsubsection|paragraph)\*?\{([^}]+)\}\s*/);
      const body = (heading ? part.slice(heading[0].length) : part).replace(/\s*\n\s*/g, " ");
      const content = body.split(piecePattern).map((text, inner) => {
        const citation = text.match(new RegExp("^" + citePattern + "$"));
        if (citation) {
          const labels = citation[1].split(",").map(key => {
            const paper = papers.get(key.trim());
            return paper ? [authorLabel(paper.authors) || paper.short || paper.title, paper.year].filter(Boolean).join(", ") : key.trim();
          });
          return <span className="inline-citation" key={inner}>({labels.join("; ")})</span>;
        }
        if (text.startsWith("$$") && text.endsWith("$$") || text.startsWith("\\[") && text.endsWith("\\]")) {
          return <MathPart key={inner} value={text.slice(2, -2)} display />;
        }
        if (text.startsWith("\\(") && text.endsWith("\\)")) return <MathPart key={inner} value={text.slice(2, -2)} />;
        if (text.startsWith("$") && text.endsWith("$") && text.length > 2) return <MathPart key={inner} value={text.slice(1, -1)} />;
        return plain(text);
      });
      return <div key={index}>{heading && (heading[1] === "section" ? <h2>{plain(heading[2])}</h2> : <h3>{plain(heading[2])}</h3>)}{body && <p>{content}</p>}</div>;
    }) : <p className="empty-value">Write in the LaTeX editor to preview your draft.</p>}
  </div>;
}

function MathPart({ value, display = false }: { value: string; display?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!element.current) return;
    try {
      katex.render(value, element.current, { displayMode: display, throwOnError: false, trust: false, maxSize: 15, maxExpand: 120 });
    } catch {
      element.current.textContent = value;
    }
  }, [value, display]);
  return <span className={display ? "display-math" : undefined} ref={element} />;
}
