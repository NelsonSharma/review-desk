import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { api, errorMessage } from './client';
import { Field } from './review-ui';
import { applyMetadata, doiUrl, metadataChanges, metadataLabels, metadataSources, type MetadataField, type MetadataResponse, type MetadataResult, type MetadataSource } from './metadata';
import type { Paper } from './model';

export function MetadataSearch({ draft, editing, onApply }: { draft: Paper; editing: boolean; onApply: (paper: Paper) => void }) {
  const [query, setQuery] = useState(draft.title || draft.doi || '');
  const [sources, setSources] = useState<MetadataSource[]>(['crossref', 'arxiv']);
  const [response, setResponse] = useState<MetadataResponse>();
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<MetadataResult>();
  const [checked, setChecked] = useState<MetadataField[]>([]);
  const [applied, setApplied] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (selected) document.getElementById('metadata-preview-heading')?.focus(); }, [selected]);
  async function search() {
    if (query.trim().length < 3 || !sources.length || busy) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError(''); setResponse(undefined); setSelected(undefined); setApplied('');
    setSearched(query.trim());
    try {
      setResponse(await api<MetadataResponse>('/metadata/search', { method: 'POST', data: { query: query.trim(), sources }, signal: request.signal }));
    } catch (error) { if (!request.signal.aborted) setError(errorMessage(error)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  function choose(result: MetadataResult) {
    setSelected(result); setApplied('');
    setChecked(metadataChanges(draft, result).filter(key => !draft[key] || (key === 'title' && !editing)));
  }
  const changes = selected ? metadataChanges(draft, selected) : [];
  const sourceLabel = (source: MetadataSource) => metadataSources.find(item => item.id === source)!.label;
  return <section className="metadata-search card" aria-labelledby="metadata-heading">
    <h2 id="metadata-heading">Find paper metadata</h2>
    <p>Search by title or DOI, then choose a matching paper. Nothing is searched until you select Find paper.</p>
    <div className="metadata-query">
      <Field label="Title or DOI to search"><input maxLength={500} value={query} disabled={busy} placeholder="A rough title, DOI, or DOI link" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} /></Field>
      <button type="button" className="button primary" disabled={busy || query.trim().length < 3 || !sources.length} onClick={search}><Search size={16} />{busy ? 'Searching…' : 'Find paper'}</button>
      {draft.title && draft.title !== query && <button type="button" className="text-button" disabled={busy} onClick={() => setQuery(draft.title)}>Use current paper title</button>}
    </div>
    <fieldset className="metadata-sources"><legend>Search sources</legend>{metadataSources.map(source => <label key={source.id} title={source.description}>
      <input type="checkbox" checked={sources.includes(source.id)} disabled={busy} onChange={e => setSources(e.target.checked ? [...sources, source.id] : sources.filter(id => id !== source.id))} />
      <span>{source.label}<small>{source.description}</small></span>
    </label>)}</fieldset>
    {!sources.length && <p role="status">Select at least one source, or enter details manually below.</p>}
    <p className="metadata-help">Only your search text is sent to the selected sources. PDFs are never downloaded.</p>
    {busy && <p role="status">Searching selected sources…</p>}
    {error && <p className="form-error" role="alert">{error} You can still enter details manually.</p>}
    {response && <div className="metadata-results" aria-live="polite">
      {response.warnings.map(warning => <p key={warning.source} className="metadata-warning" role="status"><strong>{sourceLabel(warning.source)}:</strong> {warning.message}</p>)}
      <h3>{response.results.length ? 'Matches' : 'No matches'} for “{searched}”</h3>
      {!response.results.length && <p>Try a few distinctive title words, add an author, search another source, or enter details manually.</p>}
      {response.results.map((result, index) => <article className={'metadata-result' + (selected === result ? ' selected' : '')} key={index}>
        <div className="metadata-badges">{result.sources.map(source => <span className="tag" key={source}>{sourceLabel(source)}</span>)}</div>
        <h4>{result.title}</h4><p>{[result.authors, result.year, result.venue].filter(Boolean).join(' · ')}</p>
        {result.doi && <p className="paper-doi">DOI: <a target="_blank" rel="noreferrer" href={doiUrl(result.doi)}>{result.doi}</a></p>}
        <div className="metadata-result-actions"><button type="button" className="button secondary compact" onClick={() => choose(result)} aria-pressed={selected === result}>Review metadata</button>
          {result.url && <a target="_blank" rel="noreferrer" href={result.url}>Open source <ArrowUpRight size={13} /></a>}</div>
      </article>)}
    </div>}
    {selected && <section className="metadata-preview" aria-labelledby="metadata-preview-heading">
      <h3 id="metadata-preview-heading" tabIndex={-1}>Choose fields to fill</h3>
      <p>Existing values stay unless you select their replacements. Missing metadata leaves your fields unchanged.</p>
      {draft.bibtex && <p>Your pasted BibTeX is kept and takes precedence in bibliography exports. Update it separately if needed.</p>}
      {changes.length ? <div className="metadata-changes">{changes.map(key => <label key={key}>
        <input type="checkbox" checked={checked.includes(key)} onChange={e => setChecked(e.target.checked ? [...checked, key] : checked.filter(item => item !== key))} />
        <span><strong>{metadataLabels[key]}</strong>{draft[key] !== '' && draft[key] != null && <del>{String(draft[key])}</del>}<span>{String(selected[key])}</span></span>
      </label>)}</div> : <p>All available values already match this paper.</p>}
      <div className="metadata-result-actions"><button type="button" className="button primary" disabled={!checked.some(key => changes.includes(key))} onClick={() => {
        onApply(applyMetadata(draft, selected, checked.filter(key => changes.includes(key))));
        setApplied('Selected metadata filled in. Review the form and save the paper when ready.'); setSelected(undefined);
      }}>Fill selected fields</button><button type="button" className="button secondary" onClick={() => setSelected(undefined)}>Cancel selection</button></div>
    </section>}
    {applied && <p role="status" className="metadata-applied">{applied}</p>}
  </section>;
}
