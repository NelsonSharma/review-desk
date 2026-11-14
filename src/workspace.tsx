import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Bookmark, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleAlert, Columns3, Download, FileText, Layers3,
  LibraryBig, LockKeyhole, Plus, Search, Settings2, SquarePen, Target, X,
} from "lucide-react";
import { authorLabel, bibliography, canEdit, citationKey, exportReview as exportDocument, latexText, type Claim, type DraftKey, type Field, type Paper, type Profile, type Review, type ReviewInfo, type ReviewSummary, type User } from "./model";
import { api, errorMessage } from "./client";
import { Settings } from "./settings";
import { Pdfs, Thread } from "./threads";
import { ClaimForm, PaperDetails, PaperForm, ProfileForm, RelationTag, Tags } from "./review-ui";
import { Comparison, Drafts, Positioning, download } from "./review-views";

const navigation = {
  library: { label: "Paper library", icon: LibraryBig },
  compare: { label: "Compare papers", icon: Columns3 },
  positioning: { label: "Positioning", icon: Target },
  drafts: { label: "Drafts", icon: SquarePen },
} as const;

type View = keyof typeof navigation;
type Dialog = { kind: "details" | "paper" | "claim"; id?: string } | { kind: "profile" } | { kind: "settings"; section?: "Fields" | "Relations" | "Tags" };
type Sort = "review" | "year" | "oldest" | "title";
const PAGE_SIZE = 8;
const MAX_COMPARE = 6;

type Props = {
  initial: Review; initialRevision: number; initialInfo: ReviewSummary; user: User | null;
  onInfo: (info: ReviewSummary) => void; onReviews: () => void; accountControls: ReactNode; onLogin: () => void;
  onDraftDirty: (dirty: boolean) => void;
};

export default function Workspace({ initial, initialRevision, initialInfo, user, onInfo, onReviews, accountControls, onLogin, onDraftDirty }: Props) {
  const editable = canEdit(user);
  const [info, setInfo] = useState(initialInfo);
  const [review, setReview] = useState(initial);
  const revision = useRef(initialRevision);
  const saving = useRef(false);
  const [sync, setSync] = useState<"saved" | "saving" | "error">("saved");
  const [view, setView] = useState<View>("library");
  const [dialog, setDialog] = useState<Dialog>();
  const [selection, setSelection] = useState<string[]>([]);

  const [highlight, setHighlight] = useState<string>();
  const [toast, setToast] = useState("");
  const [drafts, setDrafts] = useState(initial.drafts);
  const [draftTab, setDraftTab] = useState<DraftKey>("related");
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<Sort>("review");
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const relationMap = useMemo(() => new Map(review.relations.map(item => [item.id, item])), [review.relations]);
  const draftDirty = drafts.related !== review.drafts.related || drafts.contribution !== review.drafts.contribution;
  useEffect(() => {
    onDraftDirty(draftDirty);
    if (!draftDirty) return;
    function protectDraft(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", protectDraft);
    return () => { window.removeEventListener("beforeunload", protectDraft); onDraftDirty(false); };
  }, [draftDirty, onDraftDirty]);

  useEffect(() => {
    if (!exportOpen) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !exportMenu.current?.contains(event.target)) setExportOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setExportOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, [exportOpen]);

  useEffect(() => {
    function onLocation() {
      const hash = window.location.hash.slice(1);
      if (!hash) setView("library");
      if (Object.hasOwn(navigation, hash)) setView(hash as View);
    }
    onLocation();
    window.addEventListener("popstate", onLocation);
    window.addEventListener("hashchange", onLocation);
    return () => { window.removeEventListener("popstate", onLocation); window.removeEventListener("hashchange", onLocation); };
  }, []);

  function go(destination: View, claimId?: string) {
    setHighlight(claimId);
    setExportOpen(false);
    if (destination !== view) {
      const url = destination === "library" ? window.location.pathname + window.location.search : "#" + destination;
      window.history.pushState(null, "", url);
      setView(destination);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }

  async function persist(next: Review, message: string): Promise<string> {
    if (!editable) return "An editor account is required.";
    if (saving.current) return "A save is in progress.";
    saving.current = true;
    setSync("saving");
    try {
      const result = await api<{ revision: number }>("/reviews/" + info.id, { method: "PUT", data: { revision: revision.current, review: next } });
      revision.current = result.revision;
      setReview(next);
      setSync("saved");
      notify(message);
      return "";
    } catch (error) {
      setSync("error");
      return errorMessage(error);
    } finally {
      saving.current = false;
    }
  }

  async function savePaper(paper: Paper) {
    const exists = review.papers.some(item => item.id === paper.id);
    const papers = exists ? review.papers.map(item => item.id === paper.id ? paper : item) : [...review.papers, paper];
    const error = await persist({ ...review, papers, tags: [...new Set([...review.tags, ...paper.tags])] }, exists ? "Paper updated" : "Paper added");
    if (!error) {
      if (!exists) { clearFilters(); setSort("review"); }
      setDialog({ kind: "details", id: paper.id });
    }
    return error;
  }

  async function removePaper(id: string) {
    const claims = review.claims.map(claim => ({ ...claim, evidence: claim.evidence.filter(link => link.paperId !== id) }));
    const error = await persist({ ...review, papers: review.papers.filter(paper => paper.id !== id), claims }, "Paper deleted");
    if (!error) { setSelection(current => current.filter(item => item !== id)); setDialog(undefined); }
    return error;
  }

  async function saveInfo(metadata: ReviewInfo) {
    try {
      const result = await api<{ info: ReviewSummary }>("/reviews/" + info.id + "/info", { method: "PATCH", data: metadata });
      setInfo(result.info);
      onInfo(result.info);
      notify("Review details saved");
      return "";
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function saveProfile(profile: Profile, addedFields: Field[]) {
    const error = await persist({ ...review, profile, fields: [...review.fields, ...addedFields] }, "Reference profile updated");
    if (!error) setDialog(undefined);
    return error;
  }

  async function saveClaim(claim: Claim) {
    const exists = review.claims.some(item => item.id === claim.id);
    const claims = exists ? review.claims.map(item => item.id === claim.id ? claim : item) : [...review.claims, claim];
    const error = await persist({ ...review, claims }, exists ? "Claim updated" : "Claim added");
    if (!error) { setDialog(undefined); go("positioning", claim.id); }
    return error;
  }

  async function removeClaim(id: string) {
    const error = await persist({ ...review, claims: review.claims.filter(claim => claim.id !== id) }, "Claim deleted");
    if (!error) setDialog(undefined);
    return error;
  }

  function insertClaim(claim: Claim) {
    const keys = claim.evidence.flatMap(link => review.papers
      .filter(paper => paper.id === link.paperId).map(citationKey));
    const heading = "\\paragraph{" + latexText(claim.title) + "}";
    const citation = keys.length ? "~\\cite{" + keys.join(",") + "}" : "";
    const statement = latexText(claim.statement.trim());
    const body = statement && citation ? statement.replace(/\.$/, "") + citation + "." : statement || citation.trimStart();
    const next = [drafts.contribution.trimEnd(), heading + (body ? "\n" + body : "")].filter(Boolean).join("\n\n");
    if (next.length > 120000) { notify("The contribution draft has reached its character limit."); return; }
    if (drafts.contribution.includes(heading)) {
      notify("This claim is already in the contribution draft.");
    } else {
      setDrafts({ ...drafts, contribution: next });
      notify("Claim inserted into the draft");
    }
    setDraftTab("contribution");
    go("drafts");
  }

  function togglePaper(id: string) {
    if (selection.includes(id)) {
      setSelection(selection.filter(item => item !== id));
    } else if (selection.length < MAX_COMPARE) {
      setSelection([...selection, id]);
    } else {
      notify("Compare up to " + MAX_COMPARE + " papers at a time.");
    }
  }

  const tags = useMemo(() => [...review.tags].sort((a, b) => a.localeCompare(b)), [review.tags]);
  const years = useMemo(() => [...new Set(review.papers.map(paper => paper.year).filter(value => value !== null))].sort((a, b) => b - a), [review.papers]);
  const displayed = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const papers = review.papers.filter(paper => {
      if (relation && paper.relation !== relation) return false;
      if (filterTag && !paper.tags.includes(filterTag)) return false;
      if (year && String(paper.year) !== year) return false;
      const searchable = [paper.title, paper.authors, paper.venue, paper.year, paper.short, citationKey(paper), ...Object.values(paper.values), ...paper.tags].join(" ").toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
    const byYear = (a: Paper, b: Paper) => (b.year ?? 0) - (a.year ?? 0);
    if (sort === "year") return papers.sort(byYear);
    if (sort === "oldest") return papers.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    if (sort === "title") return papers.sort((a, b) => a.title.localeCompare(b.title));
    return papers.sort((a, b) => b.added - a.added);
  }, [review.papers, query, relation, filterTag, year, sort]);

  const countByRelation = (key: string) => review.papers.filter(paper => paper.relation === key).length;
  const pageCount = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const currentPage = Math.min(pageCount, page);
  const firstRow = (currentPage - 1) * PAGE_SIZE;
  const lastRow = Math.min(firstRow + PAGE_SIZE, displayed.length);
  const filtered = !!(query || relation || filterTag || year);

  function clearFilters() { setQuery(""); setRelation(""); setFilterTag(""); setYear(""); setPage(1); }
  function showRelation(key: string) {
    clearFilters();
    setRelation(key);
    go("library");
    document.getElementById("paper-library")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function exportReview(format: "json" | "bib") {
    setExportOpen(false);
    if (format === "bib") {
      download("related_work.bib", bibliography(review.papers));
    } else {
      download("literature-review.json", JSON.stringify(exportDocument(info, { ...review, drafts }), null, 2), "application/json");
    }
    notify(format === "bib" ? "Bibliography downloaded" : "Review downloaded");
  }

  const selectedPapers = selection.flatMap(id => review.papers.filter(paper => paper.id === id));
  const currentPaper = dialog && "id" in dialog ? review.papers.find(paper => paper.id === dialog.id) : undefined;
  const currentClaim = dialog?.kind === "claim" ? review.claims.find(claim => claim.id === dialog.id) : undefined;
  const openPaper = (id: string) => setDialog({ kind: "details", id });
  const closeDialog = () => setDialog(undefined);

  return <div className="site-shell">
    <a className="skip-link" href="#workspace-main">Skip to content</a>
    <aside className="sidebar">
      <button type="button" className="brand" onClick={onReviews}>
        <span className="brand-mark"><BookOpen size={21} strokeWidth={1.85} /></span>
        <span><strong>Review Desk</strong><small>Research workspace</small></span>
      </button>
      <nav className="side-nav" aria-label="Workspace">
        {Object.entries(navigation).map(([key, { label, icon: Icon }]) =>
          <button key={key} type="button" onClick={() => go(key as View)} aria-current={view === key ? "page" : undefined}><Icon size={19} strokeWidth={1.75} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-end">
        <button className="reference-tile" type="button" onClick={() => setDialog({ kind: "profile" })}>
          <span className="reference-icon"><Target size={17} /></span>
          <span><small>My approach</small><strong>{review.profile.name}</strong></span>
          <ArrowUpRight size={15} className="reference-arrow" />
        </button>
        <div className="private"><LockKeyhole size={14} /> {info.public ? "Public review" : "Private review"}</div>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar workspace-bar">
        <div className="breadcrumbs"><button className="text-button back-library" type="button" onClick={onReviews}><ArrowLeft size={15} /><span>All reviews</span></button>
          <ChevronRight size={14} /><strong>{navigation[view].label}</strong></div>
        <div className="header-actions">
          {editable ? <div className={"sync-label " + sync} role="status">
            {sync === "error" ? <CircleAlert size={15} /> : sync === "saving" ? <span className="sync-spinner" /> : <span className="sync-dot" />}
            <span>{sync === "saving" ? "Saving…" : sync === "error" ? "Last change unsaved" : draftDirty ? "Draft edits unsaved" : "All changes saved"}</span>
          </div> : <span className="membership-label">{user?.role === "commenter" ? "Commenter" : "Read only"}</span>}
          {accountControls}
        </div>
      </header>
      <main className="main-content" id="workspace-main" tabIndex={-1}>
        {view === "library" && <>
          <Hero info={info} onAdd={editable ? () => setDialog({ kind: "paper" }) : undefined} onCompare={() => go("compare")} />
          <div className="stats">
            <Stat icon={<FileText size={21} />} color="purple" number={review.papers.length} label="Papers collected" onClick={() => showRelation("")} />
            {[relationMap.get("same-problem"), relationMap.get("method-only")].filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item, index) =>
              <Stat key={item.id} icon={index === 0 ? <Target size={21} /> : <Layers3 size={21} />} color={item.color} number={countByRelation(item.id)} label={item.label} onClick={() => showRelation(item.id)} />)}
            <Stat icon={<Bookmark size={21} />} color="amber" number={review.claims.length} label="Positioning claims" onClick={() => go("positioning")} />
          </div>
          <section className="library-section" id="paper-library" aria-labelledby="library-title">
            <div className="section-heading">
              <div><h2 id="library-title">Paper library</h2><p>Find papers by relation, tag, and publication year.</p></div>
              <div className="section-actions">
              {editable && <button className="button secondary" type="button" aria-label="Review settings" title="Review settings" onClick={() => setDialog({ kind: "settings" })}><Settings2 size={16} /> <span>Review settings</span></button>}
              <div className="export-menu" ref={exportMenu}>
                <button type="button" className="button secondary" aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}><Download size={16} /> Export <ChevronDown size={14} /></button>
                {exportOpen && <div className="dropdown"><button type="button" onClick={() => exportReview("json")}>Review and drafts (.json)</button><button type="button" onClick={() => exportReview("bib")}>Bibliography (.bib)</button></div>}
              </div>
              </div>
            </div>

            <div className="library-card">
              <div className="filters">
                <div className="search-box"><Search size={18} /><input ref={searchInput} aria-label="Search papers" placeholder="Search titles, authors, or keywords…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
                  {query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => { setQuery(""); setPage(1); searchInput.current?.focus(); }}><X size={15} /></button>}
                </div>
                <div className="filter-options">
                  <FilterSelect label="Filter by relation" value={relation} onChange={value => { setRelation(value); setPage(1); }}>
                    <option value="">All relations</option>{review.relations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </FilterSelect>
                  <FilterSelect label="Filter by tag" value={filterTag} onChange={value => { setFilterTag(value); setPage(1); }}>
                    <option value="">All tags</option>{tags.map(tag => <option key={tag}>{tag}</option>)}
                  </FilterSelect>
                  <FilterSelect label="Filter by year" value={year} onChange={value => { setYear(value); setPage(1); }}>
                    <option value="">All years</option>{years.map(value => <option key={value}>{value}</option>)}
                  </FilterSelect>
                  <FilterSelect label="Sort papers" value={sort} onChange={value => { setSort(value as Sort); setPage(1); }} icon={<ArrowDownWideNarrow size={16} />}>
                    <option value="review">Review order</option><option value="year">Newest year</option><option value="oldest">Oldest year</option><option value="title">Title A–Z</option>
                  </FilterSelect>
                </div>
              </div>
              {selection.length > 0 && <div className="selection-bar">
                <span><Check size={16} /> {selection.length} selected for comparison</span>
                <button type="button" className="text-button" onClick={() => setSelection([])}>Clear selection</button>
                <button type="button" className="button primary compact" onClick={() => go("compare")}>Compare selected <ArrowRight size={15} /></button>
              </div>}
              <div className="table-wrap">
                <table className="papers-table">
                  <colgroup><col className="select-col" /><col /><col className="year-col" /><col className="relation-col" /><col className="tags-col" /><col className="open-col" /></colgroup>
                  <thead><tr><th scope="col"><span className="sr-only">Select for comparison</span></th><th scope="col">Paper</th><th scope="col">Year</th><th scope="col">Relation</th><th scope="col" className="hide-small">Tags</th><th scope="col"><span className="sr-only">Open paper</span></th></tr></thead>
                  <tbody>
                    {displayed.slice(firstRow, lastRow).map(paper => <tr key={paper.id} className={selection.includes(paper.id) ? "selected-row" : ""}>
                      <td><input type="checkbox" aria-label={"Compare " + (paper.short || paper.title)} checked={selection.includes(paper.id)} onChange={() => togglePaper(paper.id)} /></td>
                      <td><button type="button" className="paper-link" onClick={() => openPaper(paper.id)}>
                        <span className="paper-glyph"><FileText size={18} strokeWidth={1.7} /></span>
                        <span className="paper-text"><strong>{paper.title}</strong><small>{[authorLabel(paper.authors), paper.short || paper.venue].filter(Boolean).join(" · ") || "New paper"}</small></span>
                      </button></td>
                      <td className="year-cell">{paper.year || "—"}</td><td><RelationTag relation={relationMap.get(paper.relation)!} /></td>
                      <td className="hide-small"><Tags tags={paper.tags} limit={2} /></td>
                      <td><button type="button" className="icon-button row-open" aria-label={"Open " + (paper.short || paper.title)} onClick={() => openPaper(paper.id)}><ChevronRight size={18} /></button></td>
                    </tr>)}
                  </tbody>
                </table>
                {!displayed.length && <div className="empty-state"><Search size={25} /><h3>{filtered ? "No matching papers" : "Your library is empty"}</h3><p>{filtered ? "Try a different search or clear the filters." : editable ? "Add a paper to start the review." : "Papers will appear here as they are added."}</p>
                  {(filtered || editable) && <button type="button" className="button secondary compact" onClick={filtered ? clearFilters : () => setDialog({ kind: "paper" })}>{filtered ? "Clear filters" : "Add a paper"}</button>}</div>}
              </div>
              {displayed.length > 0 && <footer className="table-footer">
                <span>Showing {firstRow + 1}–{lastRow} of {displayed.length} {displayed.length === 1 ? "paper" : "papers"}{filtered && displayed.length !== review.papers.length ? " · " + review.papers.length + " total" : ""}</span>
                <div className="pagination"><button className="icon-button" type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button>
                  {Array.from({ length: pageCount }, (_, index) => index + 1).filter(value => value === 1 || value === pageCount || Math.abs(value - currentPage) <= 1).map((value, index, pages) => <span key={value} className="page-group">{index > 0 && value - pages[index - 1] > 1 && <span>…</span>}<button type="button" className="page-button" onClick={() => setPage(value)} aria-current={value === currentPage ? "page" : undefined}>{value}</button></span>)}
                  <button className="icon-button" type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div>
              </footer>}
            </div>
          </section>
        </>}
        {view === "compare" && <Comparison profile={review.profile} fields={review.fields} relations={relationMap} selected={selectedPapers} papers={review.papers} max={MAX_COMPARE} editable={editable}
          onToggle={togglePaper} onProfile={() => setDialog({ kind: "profile" })} onFields={() => setDialog({ kind: "settings", section: "Fields" })} onOpenPaper={openPaper} onLibrary={() => go("library")} />}
        {view === "positioning" && <Positioning claims={review.claims} papers={review.papers} name={review.profile.name} highlight={highlight} editable={editable}
          onEdit={id => setDialog({ kind: "claim", id })} onAdd={() => setDialog({ kind: "claim" })} onOpenPaper={openPaper}
          onInsertClaim={insertClaim} onDrafts={() => go("drafts")} thread={id => <Thread key={id} reviewId={info.id} kind="claim" target={id} user={user} onLogin={onLogin} />} />}
        {view === "drafts" && <Drafts active={draftTab} onTab={setDraftTab} drafts={drafts} saved={review.drafts} papers={review.papers} editable={editable} onChange={setDrafts}
          onSave={value => persist({ ...review, drafts: value }, "Drafts saved")} onNotify={notify} onBibliography={() => exportReview("bib")}
          thread={id => <Thread key={id} reviewId={info.id} kind="draft" target={id} user={user} onLogin={onLogin} />} />}
      </main>
    </div>
    {dialog?.kind === "details" && currentPaper && <PaperDetails key={currentPaper.id} paper={currentPaper} fields={review.fields} relation={relationMap.get(currentPaper.relation)!} claims={review.claims} selected={selection.includes(currentPaper.id)}
      onEdit={editable ? () => setDialog({ kind: "paper", id: currentPaper.id }) : undefined} onToggle={() => togglePaper(currentPaper.id)} onClaim={id => { closeDialog(); go("positioning", id); }} onClose={closeDialog}>
      <Pdfs reviewId={info.id} paperId={currentPaper.id} user={user} publicPdfs={info.publicPdfs} />
      <Thread reviewId={info.id} kind="paper" target={currentPaper.id} user={user} onLogin={onLogin} />
    </PaperDetails>}
    {editable && dialog?.kind === "paper" && <PaperForm key={dialog.id || "new"} paper={currentPaper} fields={review.fields} relations={review.relations} savedTags={tags}
      onClose={() => currentPaper ? openPaper(currentPaper.id) : closeDialog()} onSave={savePaper} onDelete={removePaper} />}
    {editable && dialog?.kind === "claim" && <ClaimForm key={dialog.id || "new"} claim={currentClaim} papers={review.papers} onClose={closeDialog} onSave={saveClaim} onDelete={removeClaim} />}
    {dialog?.kind === "profile" && <ProfileForm profile={review.profile} fields={review.fields} onClose={closeDialog} onSave={editable ? saveProfile : undefined} />}
    {editable && dialog?.kind === "settings" && <Settings review={review} info={info} section={dialog.section} onInfo={saveInfo}
      onSave={async next => {
        const error = await persist(next, "Review settings saved");
        if (!error) clearFilters();
        return error;
      }} onClose={closeDialog} />}
    {toast && <div role="status" className="toast"><span><Check size={15} /></span>{toast}<button type="button" onClick={() => setToast("")} className="icon-button" aria-label="Dismiss message"><X size={16} /></button></div>}
  </div>;
}

function FilterSelect({ label, value, onChange, children, icon }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; icon?: ReactNode }) {
  return <label className={"filter-select" + (icon ? " with-icon" : "")}>{icon}
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{children}</select><ChevronDown size={14} className="filter-chevron" />
  </label>;
}

function Stat({ icon, color, number, label, onClick }: { icon: ReactNode; color: string; number: number; label: string; onClick: () => void }) {
  return <button type="button" className="stat-card" onClick={onClick}><span className={"stat-icon " + color}>{icon}</span><span className="stat-text"><strong>{number}</strong><small>{label}</small></span><ArrowUpRight size={15} className="stat-arrow" /></button>;
}

function Hero({ info, onAdd, onCompare }: { info: ReviewSummary; onAdd?: () => void; onCompare: () => void }) {
  return <section className="hero review-hero" aria-labelledby="hero-title">
    <div className="hero-content">
      <h1 id="hero-title">{info.title}</h1>
      {info.description && <p>{info.description}</p>}
      <div className="hero-actions">{onAdd && <button type="button" className="button primary" onClick={onAdd}><Plus size={19} /> Add paper</button>}
        <button type="button" className="button hero-secondary" onClick={onCompare}><Columns3 size={17} /> Compare papers</button></div>
    </div>
    <div className="dashboard-art" aria-hidden="true"><span /><span /><span /><LibraryBig size={60} strokeWidth={1.6} /></div>
  </section>;
}
