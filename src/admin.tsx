import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, BookOpen, Eye, FileText, LockKeyhole, Plus, Settings2, UserRound } from "lucide-react";
import { api, errorMessage, type ManagedUser } from "./client";
import { Field, Modal } from "./review-ui";
import { userRoles, type ReviewSummary, type UserRole } from "./model";

const roles: Record<UserRole, { name: string; detail: string }> = {
  viewer: { name: "Viewer", detail: "Read private and public reviews." },
  commenter: { name: "Commenter", detail: "View reviews and post comments." },
  editor: { name: "Editor", detail: "Edit reviews, attach PDFs, and post comments." },
  admin: { name: "Administrator", detail: "Edit reviews, manage users, and set public access." },
};

export function Admin({ reviewId, accountControls, onBack, onInfo }: {
  reviewId: string; accountControls: ReactNode; onBack: () => void; onInfo: (review: ReviewSummary) => void;
}) {
  const [data, setData] = useState<{ users: ManagedUser[]; reviews: ReviewSummary[] }>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [user, setUser] = useState<ManagedUser | "new">();
  useEffect(() => {
    const controller = new AbortController();
    api<NonNullable<typeof data>>("/admin", { signal: controller.signal }).then(setData).catch(error => {
      if (!(error instanceof Error && error.name === "AbortError")) setError(errorMessage(error));
    });
    return () => controller.abort();
  }, []);

  function updateReview(info: ReviewSummary) {
    setData(current => current && { ...current, reviews: current.reviews.map(item => item.id === info.id ? info : item) });
    onInfo(info);
    setSaved("Access updated for " + info.title);
  }

  function updateUser(item: ManagedUser) {
    setData(current => current && { ...current, users: current.users.some(user => user.id === item.id)
      ? current.users.map(user => user.id === item.id ? item : user) : [...current.users, item] });
    setUser(undefined);
    setSaved("Account saved for " + item.username);
  }

  return <>
    <header className="topbar dashboard-bar"><button type="button" className="brand" onClick={onBack}><span className="brand-mark"><BookOpen size={21} /></span><span><strong>Review Desk</strong><small>Administration</small></span></button><div className="header-actions">{accountControls}</div></header>
    <main className="dashboard admin-main">
      <button className="text-button" onClick={onBack}><ArrowLeft size={16} /> {reviewId ? "Back to review" : "All reviews"}</button>
      <header className="page-heading"><div><h1>Administration</h1><p>Create accounts and decide which reviews visitors can read.</p></div></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="status-note" role="status">{saved}</p>}
      <div className="admin-grid">
        <section className="card admin-card">
          <div className="section-heading"><div><h2><UserRound size={20} /> Accounts</h2><p>Give each collaborator a username and password.</p></div>
            <button className="button primary compact" type="button" onClick={() => setUser("new")}><Plus size={16} /> Add user</button></div>
          {data?.users.map(item => <div className="account-row" key={item.id}>
            <div><strong>{item.username}</strong><small>{item.disabled ? "Disabled · " : ""}{roles[item.role].name}</small></div>
            {item.role === "admin" ? <span className="tag">Owner</span> : <button className="button secondary compact" type="button" aria-label={"Edit " + item.username} onClick={() => setUser(item)}>Edit</button>}
          </div>)}
          <dl className="role-legend">{userRoles.map(role => <div key={role}><dt>{roles[role].name}</dt><dd>{roles[role].detail}</dd></div>)}</dl>
          <p className="admin-foot">Every active account can read private reviews. Public visitors can view only reviews you publish here.</p>
        </section>
        <section className="card admin-card">
          <div className="section-heading"><div><h2><Settings2 size={20} /> Review access</h2><p>Choose visibility separately for each review.</p></div></div>
          {data?.reviews.length === 0 && <p className="admin-foot">Create a review to manage its visibility.</p>}
          {data?.reviews.map(info => <Visibility key={info.id} info={info} onSaved={updateReview} />)}
        </section>
      </div>
    </main>
    {user && <AccountForm user={user === "new" ? undefined : user} onClose={() => setUser(undefined)} onSaved={updateUser} />}
  </>;
}

function Visibility({ info, onSaved }: { info: ReviewSummary; onSaved: (info: ReviewSummary) => void }) {
  const [publicView, setPublicView] = useState(info.public);
  const [pdfs, setPdfs] = useState(info.publicPdfs);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ info: ReviewSummary }>("/reviews/" + info.id + "/access", {
        method: "PATCH", data: { public: publicView, publicPdfs: publicView && pdfs },
      });
      onSaved(result.info);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <form className="visibility-form" onSubmit={submit}>
    <h3>{info.title}</h3>
    <label className="check-option"><input type="checkbox" checked={publicView} onChange={event => { setPublicView(event.target.checked); if (!event.target.checked) setPdfs(false); }} />
      {publicView ? <Eye size={16} /> : <LockKeyhole size={16} />} <span>Allow public viewing</span></label>
    <label className="check-option"><input type="checkbox" checked={pdfs} disabled={!publicView} onChange={event => setPdfs(event.target.checked)} />
      <FileText size={16} /> <span>Allow public PDF downloads</span></label>
    <p>Public viewing includes paper notes, positioning claims, drafts, and comments.</p>
    <button className="button secondary compact" type="submit" disabled={busy || (publicView === info.public && pdfs === info.publicPdfs)}>{busy ? "Saving…" : "Save access"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function AccountForm({ user, onClose, onSaved }: { user?: ManagedUser; onClose: () => void; onSaved: (user: ManagedUser) => void }) {
  const [role, setRole] = useState(user?.role ?? "commenter");
  const [disabled, setDisabled] = useState(user?.disabled ?? false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") ?? "");
    setBusy(true);
    try {
      const result = await api<{ user: ManagedUser }>("/admin/users" + (user ? "/" + user.id : ""), {
        method: user ? "PATCH" : "POST", data: user ? { role, disabled, ...(password ? { password } : {}) } : { role, username: fields.get("username"), password },
      });
      onSaved(result.user);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Modal title={user ? "Edit " + user.username : "Add a user"} onClose={() => { if (!busy) onClose(); }}>
    <form className="dialog-form" onSubmit={submit}>
      <div className="dialog-scroll form-content form-grid">
        {!user && <Field label="Username" wide><input name="username" minLength={2} maxLength={40} required autoComplete="off" /></Field>}
        <Field label={user ? "New password" : "Password"} wide help={user ? "Leave blank to keep the current password." : "Enter a password."}>
          <input name="password" type="password" required={!user} maxLength={200} autoComplete="new-password" /></Field>
        <Field label="Role" wide help={roles[role].detail}><select value={role} onChange={event => setRole(event.target.value as UserRole)}>
          {userRoles.map(role => <option key={role} value={role}>{roles[role].name}</option>)}</select></Field>
        {user && <label className="check-option field full"><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} /> Disable this account</label>}
      </div>
      <footer className="dialog-footer">{error && <p className="form-error" role="alert">{error}</p>}<button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : user ? "Save account" : "Create account"}</button></footer>
    </form>
  </Modal>;
}
