import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, FileUp, LibraryBig, LockKeyhole, Plus, Settings2 } from "lucide-react";
import { api, ApiError, errorMessage, setSession, type OpenReview, type SiteState } from "./client";
import { Admin } from "./admin";
import { Field, Modal, ThemeControl } from "./review-ui";
import { canEdit, type ReviewInfo, type ReviewSummary, type User } from "./model";
import Workspace from "./workspace";
import "./globals.css";
import "katex/dist/katex.min.css";

function readRoute() {
  const url = new URL(location.href);
  return { id: url.searchParams.get("review") || "", admin: url.searchParams.has("admin") };
}

function App() {
  const [state, setState] = useState<SiteState>();
  const [route, setRoute] = useState(readRoute);
  const [opened, setOpened] = useState<OpenReview>();
  const [loadError, setLoadError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [dialog, setDialog] = useState<"login" | "new" | "import">();
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);

  const lastLocation = useRef(location.href);
  const routeRef = useRef(route);
  routeRef.current = route;
  const dirtyRef = useRef(false);
  const onDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    lastLocation.current = location.href;
    setDraftDirty(dirty);
  }, []);

  async function refresh() {
    const current = await api<SiteState>("/state");
    setSession(current.csrf);
    setState(current);
  }

  useEffect(() => {
    refresh().catch(error => setLoadError(errorMessage(error)));
    const onRoute = () => {
      const next = readRoute();
      if ((next.id !== routeRef.current.id || next.admin !== routeRef.current.admin) && dirtyRef.current && !window.confirm("Leave this page and discard unsaved changes?")) {
        history.pushState(null, "", lastLocation.current);
        return;
      }
      if (!dirtyRef.current || next.id !== routeRef.current.id || next.admin !== routeRef.current.admin) lastLocation.current = location.href;
      setRoute(next);
    };
    window.addEventListener("popstate", onRoute);
    return () => window.removeEventListener("popstate", onRoute);
  }, []);

  useEffect(() => {
    if (!state || !route.id || route.admin) return;
    const controller = new AbortController();
    setOpened(undefined);
    setReviewError("");
    api<OpenReview>("/reviews/" + encodeURIComponent(route.id), { signal: controller.signal })
      .then(setOpened).catch(error => {
        if (error instanceof Error && error.name === "AbortError") return;
        setReviewError(error instanceof ApiError && error.status === 404 ? "This review is unavailable to your account." : errorMessage(error));
      });
    return () => controller.abort();
  }, [route.id, route.admin, state?.user?.id, Boolean(state)]);

  function navigate(id = "", admin = false, confirmed = false) {
    if (!confirmed && draftDirty && !window.confirm("Leave this review and discard unsaved changes?")) return;
    setOpened(undefined);
    setReviewError("");
    const next = new URL(location.href);
    next.search = "";
    if (id) next.searchParams.set("review", id);
    if (admin) next.searchParams.set("admin", "1");
    next.hash = "";
    history.pushState(null, "", next);
    setRoute({ id, admin });
    window.scrollTo(0, 0);
  }

  async function logout() {
    if (draftDirty && !window.confirm("Sign out and discard unsaved changes?")) return;
    setBusy(true);
    try {
      await api("/logout", { method: "POST" });
      navigate("", false, true);
      await refresh();
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function onInfo(info: ReviewSummary) {
    setState(current => current && ({ ...current, reviews: current.reviews.map(item => item.id === info.id ? info : item) }));
  }

  if (!state) return <main className="gate"><BookOpen /><h1>Review Desk</h1><p>{loadError || "Opening the workspace…"}</p>{loadError && <button className="button secondary" onClick={() => location.reload()}>Reload</button>}</main>;

  const controls = <AccountControls user={state.user} busy={busy} onLogin={() => setDialog("login")} onLogout={logout} />;
  const adminButton = state.user?.role === "admin" && <button className="button secondary compact admin-shortcut" type="button" onClick={() => navigate(route.id, true)}><Settings2 size={16} /><span>Admin</span></button>;
  const navBack = <button className="text-button" type="button" onClick={() => navigate(route.admin ? route.id : "")}><ArrowLeft size={16} /> {route.admin && route.id ? "Back to review" : "All reviews"}</button>;

  return <>
    {route.admin && state.user?.role === "admin" ? <Admin reviewId={route.id} onBack={() => navigate(route.id)} onInfo={onInfo} accountControls={controls} />
      : route.id && opened?.info.id === route.id ? <Workspace key={opened.info.id + ":" + (state.user?.id ?? "guest")}
        initial={opened.review} initialRevision={opened.revision} initialInfo={opened.info} user={state.user}
        onInfo={onInfo} onReviews={() => navigate()} accountControls={<>{adminButton}{controls}</>}
        onLogin={() => setDialog("login")} onDraftDirty={onDirty} />
      : route.id ? <main className="gate"><BookOpen /><h1>{reviewError ? "Review unavailable" : "Opening review"}</h1>
        <p>{reviewError || "Loading the papers and review notes…"}</p><div className="header-actions">{navBack}{controls}</div></main>
      : <Dashboard state={state} controls={<>{adminButton}{controls}</>} onOpen={id => navigate(id)}
        onCreate={() => setDialog("new")} onImport={() => setDialog("import")} />}
    {loadError && <p className="floating-error" role="alert">{loadError} <button className="text-button" onClick={() => setLoadError("")}>Dismiss</button></p>}
    {dialog === "login" && <Login onClose={() => setDialog(undefined)} onLogin={async () => { await refresh(); setDialog(undefined); }} />}
    {(dialog === "new" || dialog === "import") && <CreateReview importing={dialog === "import"} onClose={() => setDialog(undefined)} onCreated={item => {
      setState(current => current && ({ ...current, reviews: [item, ...current.reviews] }));
      setDialog(undefined);
      navigate(item.id);
    }} />}
  </>;
}

function AccountControls({ user, busy, onLogin, onLogout }: { user: User | null; busy: boolean; onLogin: () => void; onLogout: () => void }) {
  return <><ThemeControl />
    {user ? <button type="button" className="button secondary compact sign-control" title={"Signed in as " + user.username} onClick={onLogout} disabled={busy}>Sign out</button>
      : <button type="button" className="button secondary compact sign-control" onClick={onLogin}>Sign in</button>}</>;
}

function Dashboard({ state, controls, onOpen, onCreate, onImport }: { state: SiteState; controls: ReactNode; onOpen: (id: string) => void; onCreate: () => void; onImport: () => void }) {
  return <>
    <header className="topbar dashboard-bar"><div className="brand"><span className="brand-mark"><BookOpen size={21} /></span><span><strong>Review Desk</strong><small>Research workspace</small></span></div><div className="header-actions">{controls}</div></header>
    <main className="dashboard">
      <section className="hero dashboard-hero"><div className="hero-content"><h1>{state.user ? "All Reviews" : "Public Reviews"}</h1>
        <p>Collect papers, compare approaches, and write from the evidence.</p>
        {canEdit(state.user) && <div className="hero-actions"><button className="button primary" onClick={onCreate}><Plus size={18} /> New review</button>
          <button className="button hero-secondary" onClick={onImport}><FileUp size={17} /> Import review</button></div>}</div>
        <div className="dashboard-art" aria-hidden="true"><span /><span /><span /><BookOpen size={60} strokeWidth={1.6} /></div>
      </section>
      <section className="dashboard-list" aria-label="Literature reviews">
        {state.reviews.length ? <div className="review-cards">{state.reviews.map(item => <button className="review-card" type="button" key={item.id} onClick={() => onOpen(item.id)}>
          <span className="claim-icon"><LibraryBig size={20} /></span><span><strong>{item.title}</strong>
          {item.description && <small>{item.description}</small>}<span className="review-visibility">{item.public ? "Public review" : <><LockKeyhole size={13} /> Private review</>}</span></span><ArrowRight size={17} />
        </button>)}</div> : <div className="empty-state card"><LibraryBig size={28} /><h3>{state.user ? "No reviews yet" : "No public reviews"}</h3>
          <p>{canEdit(state.user) ? "Start a review or import an exported JSON file." : "Sign in to see the reviews available to your account."}</p>
          {!state.adminReady && <small>First run? Create the owner account with <code>npm run admin -- create</code>.</small>}</div>}
      </section>
    </main>
  </>;
}

function Login({ onClose, onLogin }: { onClose: () => void; onLogin: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User; csrf: string }>("/login", { method: "POST", data: Object.fromEntries(fields) });
      setSession(result.csrf);
      await onLogin();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Sign in" subtitle="Use the account your administrator created for you." onClose={() => { if (!busy) onClose(); }}>
    <form className="dialog-form" onSubmit={submit}>
      <div className="dialog-scroll form-content form-grid">
        <Field label="Username" wide><input required name="username" autoComplete="username" maxLength={40} /></Field>
        <Field label="Password" wide><input required name="password" type="password" autoComplete="current-password" maxLength={200} /></Field>
      </div>
      <footer className="dialog-footer">{error && <p className="form-error" role="alert">{error}</p>}<button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></footer>
    </form>
  </Modal>;
}

function CreateReview({ importing, onClose, onCreated }: { importing: boolean; onClose: () => void; onCreated: (review: ReviewSummary) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get("title") ?? "");
    setBusy(true);
    setError("");
    try {
      if (importing && !file) throw new Error("Choose an exported JSON file.");
      let data: ReviewInfo | { data: unknown; title: string } = { title, description: String(fields.get("description") ?? "") };
      if (file && importing) {
        if (file.size > 6 * 1024 * 1024) throw new Error("Choose a JSON export under 6 MiB.");
        try { data = { data: JSON.parse(await file.text()), title }; } catch { throw new Error("This file does not contain valid JSON."); }
      }
      const result = await api<{ review: ReviewSummary }>(importing ? "/reviews/import" : "/reviews", { method: "POST", data });
      onCreated(result.review);
    } catch (error) {
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <Modal title={importing ? "Import a review" : "Create a review"} subtitle={importing ? "Open a Review Desk export or a JSON export from the original MAPO workspace." : "Give the project a title and a short description."} onClose={() => { if (!busy) onClose(); }}>
    <form className="dialog-form" onSubmit={submit}>
      <div className="dialog-scroll form-content form-grid">
        <Field label={importing ? "Review title (optional)" : "Review title"} wide><input name="title" required={!importing} maxLength={120} placeholder="e.g. Trust in human–AI teams" /></Field>
        {importing ? <Field label="Review JSON" wide help="JSON includes notes, claims, and drafts. Attach PDFs after importing."><input required type="file" accept="application/json,.json" onChange={event => setFile(event.target.files?.[0])} /></Field>
          : <Field label="Description" wide><textarea name="description" rows={3} maxLength={500} placeholder="What question will this review answer?" /></Field>}
      </div>
      <footer className="dialog-footer">{error && <p className="form-error" role="alert">{error}</p>}<button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : importing ? "Import review" : "Create review"}</button></footer>
    </form>
  </Modal>;
}

const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<App />);
