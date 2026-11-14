import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Settings2, Tag, Trash2 } from "lucide-react";
import { ErrorNotice, Field, Modal } from "./review-ui";
import { colors, labelKey, newId, type Field as ReviewField, type Relation, type Review, type ReviewInfo } from "./model";

type Catalog = Pick<Review, "fields" | "tags" | "relations">;
const tabs = ["Fields", "Relations", "Tags"] as const;

export function Settings({ review, info, section, onInfo, onSave, onClose }: {
  review: Review; info: ReviewInfo; section?: typeof tabs[number]; onInfo: (info: ReviewInfo) => Promise<string>;
  onSave: (next: Review) => Promise<string>; onClose: () => void;
}) {
  const [tab, setTab] = useState<typeof tabs[number] | "Review">(section ?? "Review");
  const [metadata, setMetadata] = useState({ title: info.title, description: info.description });
  const [catalog, setCatalog] = useState<Catalog>({ fields: review.fields, tags: review.tags, relations: review.relations });
  const [tagRenames, setTagRenames] = useState<Record<string, string>>({});
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; text: string; perform: () => void }>();

  function changeField(id: string, patch: Partial<ReviewField>) {
    setCatalog(current => ({ ...current, fields: current.fields.map(field => field.id === id ? { ...field, ...patch } : field) }));
  }
  function moveField(index: number, direction: number) {
    const fields = [...catalog.fields];
    const target = index + direction;
    if (!fields[target]) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    setCatalog({ ...catalog, fields });
  }
  function changeRelation(id: string, patch: Partial<Relation>) {
    setCatalog(current => ({ ...current, relations: current.relations.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }
  function addTag() {
    const text = newTag.trim();
    if (!text) return;
    if (catalog.tags.some(tag => labelKey(tag) === labelKey(text))) { setError("This tag already exists."); return; }
    setError("");
    setCatalog({ ...catalog, tags: [...catalog.tags, text] });
    setNewTag("");
  }
  function askRemove(id: string, text: string, perform: () => void) { setConfirm({ id, text, perform }); }
  function fieldDataCount(id: string) { return review.papers.filter(paper => paper.values[id]?.trim()).length + Number(Boolean(review.profile.values[id]?.trim())); }
  function useCount(id: string, type: "tag" | "relation") { return review.papers.filter(paper => type === "tag" ? paper.tags.includes(id) : paper.relation === id).length; }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (tab === "Review") {
      const result = await onInfo(metadata);
      if (!result) onClose(); else setError(result);
      setBusy(false);
      return;
    }
    const nextFields = catalog.fields.map(field => ({ ...field, label: field.label.trim() }));
    const nextRelations = catalog.relations.map(relation => ({ ...relation, label: relation.label.trim() }));
    const tags = catalog.tags.map(name => (tagRenames[name] ?? name).trim());
    if (tags.some(tag => !tag) || new Set(tags.map(labelKey)).size !== tags.length) {
      setError("Use a different, nonempty name for each tag.");
      setBusy(false);
      return;
    }
    const paperFieldIds = new Set(nextFields.filter(item => item.paper).map(item => item.id));
    const profileFieldIds = new Set(nextFields.filter(item => item.profile).map(item => item.id));
    const relationIds = new Set(nextRelations.map(item => item.id));
    const canonical = new Map(catalog.tags.map((name, index) => [name, tags[index]]));
    const clearRemoved = (values: Record<string, string>, allowed: Set<string>) => Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
    const next: Review = { ...review, fields: nextFields, relations: nextRelations, tags,
      papers: review.papers.map(paper => ({ ...paper, relation: relationIds.has(paper.relation) ? paper.relation : "unassessed",
        tags: paper.tags.flatMap(tag => canonical.has(tag) ? [canonical.get(tag)!] : []), values: clearRemoved(paper.values, paperFieldIds) })),
      profile: { ...review.profile, values: clearRemoved(review.profile.values, profileFieldIds) },
    };
    const result = await onSave(next);
    if (!result) onClose(); else setError(result);
    setBusy(false);
  }

  return <Modal title="Review settings" subtitle="Customize the vocabulary and fields for this review." drawer onClose={() => { if (!busy) onClose(); }}>
    <div className="draft-tabs settings-tabs" aria-label="Settings section">
      {(["Review", ...tabs] as const).map(item => <button type="button" key={item} aria-pressed={tab === item} onClick={() => { setTab(item); setConfirm(undefined); setError(""); }}>{item}</button>)}
    </div>
    <form className="dialog-form" onSubmit={save}>
      <div className="dialog-scroll form-content settings-content">
        {tab === "Review" && <div className="form-grid">
          <Field label="Review title" wide><input required maxLength={120} value={metadata.title} onChange={event => setMetadata({ ...metadata, title: event.target.value })} /></Field>
          <Field label="Description" wide><textarea rows={4} maxLength={500} value={metadata.description} onChange={event => setMetadata({ ...metadata, description: event.target.value })} /></Field>
        </div>}
        {tab === "Fields" && <>
          <div className="settings-intro"><Settings2 size={18} /><p>Choose where each field appears. Fields used on papers or the reference profile are available in the comparison.</p></div>
          {catalog.fields.map((field, index) => <div className="catalog-item" key={field.id}>
            <div className="inline-field"><Field label="Field name"><input required maxLength={75} value={field.label} onChange={event => changeField(field.id, { label: event.target.value })} /></Field>
              <button className="icon-button" type="button" title="Move field up" aria-label={"Move " + field.label + " up"} disabled={!index} onClick={() => moveField(index, -1)}><ArrowUp size={16} /></button>
              <button className="icon-button" type="button" title="Move field down" aria-label={"Move " + field.label + " down"} disabled={index === catalog.fields.length - 1} onClick={() => moveField(index, 1)}><ArrowDown size={16} /></button>
              <button className="icon-button delete-action" type="button" title="Remove field" aria-label={"Remove " + field.label} onClick={() => askRemove(field.id, fieldDataCount(field.id) ? "Remove this field and its saved values?" : "Remove this field?",
                () => setCatalog(current => ({ ...current, fields: current.fields.filter(item => item.id !== field.id) })))}><Trash2 size={16} /></button>
            </div>
            <Field label="Description"><input maxLength={350} value={field.description} onChange={event => changeField(field.id, { description: event.target.value })} /></Field>
            <div className="field-scopes">
              {(["paper", "profile"] as const).map(scope => <label key={scope} className="check-option"><input type="checkbox" checked={field[scope]} onChange={event => {
                const checked = event.target.checked;
                const inUse = scope === "paper" ? review.papers.some(item => item.values[field.id]?.trim()) : Boolean(review.profile.values[field.id]?.trim());
                if (!checked && inUse) askRemove(field.id, "Remove saved values from " + (scope === "paper" ? "papers?" : "the reference profile?"), () => changeField(field.id, { [scope]: false }));
                else changeField(field.id, { [scope]: checked });
              }} /> {scope === "paper" ? "Paper" : "Reference profile"}</label>)}
            </div>
            {confirm?.id === field.id && <Removal prompt={confirm.text} undo={() => setConfirm(undefined)} remove={() => { confirm.perform(); setConfirm(undefined); }} />}
          </div>)}
          <button className="button secondary compact" type="button" onClick={() => setCatalog({ ...catalog, fields: [...catalog.fields, { id: newId(), label: "", description: "", paper: true, profile: true }] })}><Plus size={16} /> Add review field</button>
        </>}
        {tab === "Relations" && <>
          {catalog.relations.map(relation => <div className="catalog-item" key={relation.id}>
            <div className="inline-field"><Field label="Relation name"><input required maxLength={55} value={relation.label} onChange={event => changeRelation(relation.id, { label: event.target.value })} /></Field>
              <Field label="Color"><select value={relation.color} onChange={event => changeRelation(relation.id, { color: event.target.value as Relation["color"] })}>{colors.map(color => <option key={color}>{color}</option>)}</select></Field>
              {relation.id !== "unassessed" && <button className="icon-button delete-action" type="button" title="Remove relation" aria-label={"Remove " + relation.label} onClick={() => askRemove(relation.id,
                useCount(relation.id, "relation") ? "Remove this relation? Papers using it will move to the default relation." : "Remove this relation?",
                () => setCatalog(current => ({ ...current, relations: current.relations.filter(item => item.id !== relation.id) })))}><Trash2 size={16} /></button>}
            </div>
            <Field label="Description"><input maxLength={350} value={relation.description} onChange={event => changeRelation(relation.id, { description: event.target.value })} /></Field>
            {relation.id === "unassessed" && <small className="empty-value">Default for new papers</small>}
            {confirm?.id === relation.id && <Removal prompt={confirm.text} undo={() => setConfirm(undefined)} remove={() => { confirm.perform(); setConfirm(undefined); }} />}
          </div>)}
          <button className="button secondary compact" type="button" onClick={() => setCatalog({ ...catalog, relations: [...catalog.relations, { id: newId(), label: "", description: "", color: "purple" }] })}><Plus size={16} /> Add relation</button>
        </>}
        {tab === "Tags" && <>
          <div className="settings-intro"><Tag size={18} /><p>Use tags for methods, topics, populations, or reading status.</p></div>
          {catalog.tags.map(tag => <div className="catalog-item tag-catalog" key={tag}>
            <div className="inline-field"><Field label="Tag name"><input required maxLength={50} value={tagRenames[tag] ?? tag} onChange={event => setTagRenames(current => ({ ...current, [tag]: event.target.value }))} /></Field>
              <span className="empty-value">{useCount(tag, "tag")} papers</span><button className="icon-button delete-action" type="button" title="Remove tag" aria-label={"Remove " + tag} onClick={() => askRemove(tag, "Remove this tag from the review and its papers?",
                () => setCatalog(current => ({ ...current, tags: current.tags.filter(item => item !== tag) })))}><Trash2 size={16} /></button></div>
            {confirm?.id === tag && <Removal prompt={confirm.text} undo={() => setConfirm(undefined)} remove={() => { confirm.perform(); setConfirm(undefined); }} />}
          </div>)}
          <div className="inline-field"><Field label="New tag"><input maxLength={50} value={newTag} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /></Field>
            <button className="button secondary compact" type="button" disabled={!newTag.trim()} onClick={addTag}><Plus size={16} /> Add tag</button></div>
        </>}
      </div>
      <footer className="dialog-footer"><ErrorNotice message={error} /><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy || Boolean(confirm)}>{busy ? "Saving…" : tab === "Review" ? "Save review details" : "Save settings"}</button>
      </footer>
    </form>
  </Modal>;
}

function Removal({ prompt, undo, remove }: { prompt: string; undo: () => void; remove: () => void }) {
  return <div className="delete-prompt"><p>{prompt}</p><button className="button danger compact" type="button" onClick={remove}>Remove</button><button className="button secondary compact" type="button" onClick={undo}>Keep</button></div>;
}
