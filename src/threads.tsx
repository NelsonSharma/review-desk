import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FileText, MessageSquare, Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "./client";
import { canComment, canEdit, type Attachment, type Comment, type CommentKind, type User } from "./model";

function shortSize(bytes: number) {
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function Pdfs({ reviewId, paperId, user, publicPdfs }: { reviewId: string; paperId: string; user: User | null; publicPdfs: boolean }) {
  const path = "/reviews/" + reviewId + "/papers/" + paperId + "/attachments";
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const visible = Boolean(user || publicPdfs);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    api<{ files: Attachment[] }>(path, { signal: controller.signal }).then(result => { setFiles(result.files); setLoading(false); }).catch(error => {
      if (!(error instanceof Error && error.name === "AbortError")) { setError(errorMessage(error)); setLoading(false); }
    });
    return () => controller.abort();
  }, [path, visible]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError("PDFs can be up to 25 MiB."); return; }
    const form = new FormData();
    form.append("pdf", file);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ file: Attachment }>(path, { method: "POST", data: form });
      setFiles(previous => [result.file, ...previous]);
      if (input.current) input.current.value = "";
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(path + "/" + id, { method: "DELETE" });
      setFiles(current => current.filter(item => item.id !== id));
      setConfirm("");
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (!visible) return null;
  return <section className="paper-subsection" aria-label="PDF attachments">
    <h4><FileText size={17} /> PDF attachments</h4>
    {loading ? <p>Loading attachments…</p> : !files.length && <p>No PDFs attached.</p>}
    {files.map(file => <div className="attachment-row" key={file.id}>
      <a href={file.url} title={file.name} download><Download size={15} /><strong>{file.name}</strong></a><small>{shortSize(file.size)}</small>
      {canEdit(user) && (confirm === file.id ? <><button className="button danger compact" type="button" onClick={() => remove(file.id)} disabled={busy}>Remove</button><button className="text-button" type="button" onClick={() => setConfirm("")}>Keep</button></>
        : <button className="icon-button delete-action" type="button" aria-label={"Remove " + file.name} onClick={() => setConfirm(file.id)} disabled={busy}><Trash2 size={16} /></button>)}
    </div>)}
    {canEdit(user) && <form className="attachment-form" onSubmit={upload}>
      <input ref={input} type="file" accept=".pdf,application/pdf" aria-label="Choose a PDF" required disabled={busy || loading} />
      <button className="button secondary compact" type="submit" disabled={busy || loading}><Plus size={16} /> {busy ? "Uploading…" : "Attach PDF"}</button>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function Thread({ reviewId, kind, target, user, onLogin }: {
  reviewId: string; kind: CommentKind; target: string; user: User | null; onLogin: () => void;
}) {
  const path = "/reviews/" + reviewId + "/comments/" + kind + "/" + target;
  const [items, setItems] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ comments: Comment[] }>(path, { signal: controller.signal }).then(result => { setItems(result.comments); setLoading(false); }).catch(error => {
      if (!(error instanceof Error && error.name === "AbortError")) { setError(errorMessage(error)); setLoading(false); }
    });
    return () => controller.abort();
  }, [path]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ comment: Comment }>(path, { method: "POST", data: { body } });
      setItems(current => [...current, result.comment]);
      setBody("");
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(path + "/" + id, { method: "DELETE" });
      setItems(current => current.filter(item => item.id !== id));
      setConfirm("");
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="paper-subsection thread" aria-label="Comments">
    <h4><MessageSquare size={17} /> Comments {items.length ? "(" + items.length + ")" : ""}</h4>
    {loading ? <p>Loading comments…</p> : !items.length && <p>No comments yet.</p>}
    {items.map(item => <article className="comment" key={item.id}>
      <div><strong>{item.author}</strong><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleDateString()}</time>
        {item.canDelete && canComment(user) && (confirm === item.id ? <><button type="button" className="text-button" onClick={() => remove(item.id)} disabled={busy}>Remove</button><button type="button" className="text-button" onClick={() => setConfirm("")}>Keep</button></>
          : <button type="button" className="icon-button" aria-label="Remove comment" title="Remove comment" onClick={() => setConfirm(item.id)}><Trash2 size={14} /></button>)}</div><p>{item.body}</p>
    </article>)}
    {canComment(user) ? <form className="comment-form" onSubmit={send}>
      <textarea aria-label="Comment text" rows={3} maxLength={4000} value={body} onChange={event => setBody(event.target.value)} placeholder="Add a comment…" disabled={busy} />
      <button className="button secondary compact" type="submit" disabled={busy || loading || !body.trim()}>{busy ? "Posting…" : "Post comment"}</button>
    </form> : !user && <button className="text-button" type="button" onClick={onLogin}>Sign in to comment</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
