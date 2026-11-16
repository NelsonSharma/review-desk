import { setGlobalProxyFromEnv } from 'node:http';
import { SaxesParser } from 'saxes';
import { doiUrl, metadataSources, normalizeDoi } from '../src/metadata.ts';
import { pastedKey } from '../src/model.ts';

// Honor standard deployment proxy settings (including NO_PROXY) on supported Node releases.
setGlobalProxyFromEnv?.();
const names = Object.fromEntries(metadataSources.map(source => [source.id, source.label]));
const text = (value, max = 500) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const doiValue = value => { const doi = normalizeDoi(text(value)); return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : ''; };
const yearValue = value => Number.isInteger(value) && value > 0 && value < 3000 ? value : null;
const safeUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href.slice(0, 2000) : ''; }
  catch { return ''; }
};

export function createBibtexLookup({ fetch: request = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  const unavailable = warning => ({ bibtex: '', citeKey: '', source: 'crossref', warning });
  return async ({ doi }) => {
    const normalized = doiValue(doi);
    if (!normalized) return unavailable('A valid DOI is needed to fetch BibTeX. You can paste an entry manually.');
    const key = normalized.toLowerCase();
    const saved = cache.get(key);
    if (saved && saved.expires > now()) return saved.result;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 4) return unavailable('BibTeX lookup is busy. Try selecting the paper again shortly.');
    const task = (async () => {
      try {
        const url = new URL('https://api.crossref.org/works/' + encodeURIComponent(normalized) + '/transform/application/x-bibtex');
        const response = await request(url, {
          redirect: 'error', signal: AbortSignal.timeout(12000),
          headers: { Accept: 'application/x-bibtex', 'User-Agent': 'ReviewDesk/1.0 (scholarly metadata lookup)' },
        });
        if (!response.ok) return unavailable(response.status === 429
          ? 'Crossref rate limit reached. Try selecting the paper again later, or paste BibTeX manually.'
          : 'Crossref could not provide BibTeX for this DOI. You can paste an entry manually.');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 20000) throw new Error('Oversized BibTeX response');
          chunks.push(chunk);
        }
        const bibtex = Buffer.concat(chunks).toString('utf8').trim();
        const citeKey = pastedKey(bibtex);
        if (!citeKey) throw new Error('Invalid BibTeX response');
        const result = { bibtex, citeKey, source: 'crossref', warning: '' };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { result, expires: now() + 15 * 60 * 1000 });
        return result;
      } catch {
        return unavailable('BibTeX could not be fetched from Crossref. Other metadata is still available; you can paste an entry manually.');
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}

export function crossrefResults(body) {
  const items = Array.isArray(body?.message?.items) ? body.message.items : body?.message?.title ? [body.message] : null;
  if (!items) throw new Error('Invalid Crossref response');
  return items.slice(0, 8).map(item => {
    const doi = doiValue(item.DOI);
    return {
      title: text(item.title?.[0]),
      authors: text(Array.isArray(item.author) ? item.author.map(author => [author.given, author.family].filter(Boolean).join(' ') || author.name).filter(Boolean).join('; ') : '', 1500),
      year: yearValue((item['published-print'] ?? item['published-online'] ?? item.published ?? item.issued)?.['date-parts']?.[0]?.[0]),
      venue: text(item['container-title']?.[0]), doi,
      url: doi ? doiUrl(doi) : safeUrl(item.URL), sources: ['crossref'],
    };
  }).filter(item => item.title);
}

export function arxivResults(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const results = [];
  const stack = [];
  let entry;
  const atom = 'http://www.w3.org/2005/Atom';
  parser.on('doctype', () => { throw new Error('Unexpected XML doctype'); });
  parser.on('opentag', tag => {
    stack.push({ name: tag.local, uri: tag.uri, value: '' });
    if (tag.local === 'entry' && tag.uri === atom) entry = { authors: [] };
  });
  parser.on('text', value => { if (stack.length) stack.at(-1).value += value; });
  parser.on('cdata', value => { if (stack.length) stack.at(-1).value += value; });
  parser.on('closetag', () => {
    const tag = stack.pop();
    const parent = stack.at(-1);
    if (parent) parent.value += tag.value;
    if (!entry) return;
    if (parent?.name === 'entry') {
      if (['title', 'id', 'published'].includes(tag.name) && tag.uri === atom) entry[tag.name] = tag.value;
      if (tag.name === 'doi' && tag.uri === 'http://arxiv.org/schemas/atom') entry.doi = tag.value;
      if (tag.name === 'journal_ref' && tag.uri === 'http://arxiv.org/schemas/atom') entry.venue = tag.value;
    }
    if (tag.name === 'name' && parent?.name === 'author' && tag.uri === atom) entry.authors.push(text(tag.value));
    if (tag.name === 'entry' && tag.uri === atom) {
      const id = text(entry.id);
      if (/^https?:\/\/arxiv\.org\/api\/errors/.test(id)) throw new Error('Invalid arXiv response');
      // Construct only an abstract link, never the PDF link returned in the feed.
      const arxivId = id.match(/^https?:\/\/arxiv\.org\/abs\/([\w./-]+)$/)?.[1];
      if (arxivId && entry.title) results.push({
        title: text(entry.title), authors: text(entry.authors.join('; '), 1500),
        year: yearValue(Number(entry.published?.slice(0, 4))), venue: text(entry.venue) || 'arXiv preprint',
        doi: doiValue(entry.doi), url: 'https://arxiv.org/abs/' + arxivId, sources: ['arxiv'],
      });
      entry = undefined;
    }
  });
  parser.write(xml).close();
  if (stack.length || !xml.includes('http://www.w3.org/2005/Atom')) throw new Error('Invalid arXiv response');
  return results.slice(0, 8);
}

function titleScore(query, title) {
  const words = value => value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const a = new Set(words(query)); const b = new Set(words(title));
  const overlap = [...a].filter(word => b.has(word)).length;
  const grams = value => { const s = words(value).join(' '); return new Set(Array.from({ length: Math.max(0, s.length - 2) }, (_, i) => s.slice(i, i + 3))); };
  const ga = grams(query), gb = grams(title);
  return overlap / Math.max(1, a.size + b.size) + [...ga].filter(g => gb.has(g)).length / Math.max(1, ga.size + gb.size);
}

export function rankResults(results, query) {
  const merged = [];
  // Prefer the published record when both sources identify the same DOI.
  for (const result of [...results].sort((a, b) => Number(b.sources.includes('crossref')) - Number(a.sources.includes('crossref')))) {
    const match = result.doi && merged.find(item => item.doi.toLowerCase() === result.doi.toLowerCase());
    if (match) {
      match.sources = [...new Set([...match.sources, ...result.sources])];
      for (const key of ['authors', 'year', 'venue', 'url']) if (!match[key]) match[key] = result[key];
    } else merged.push({ ...result, sources: [...result.sources] });
  }
  return merged.sort((a, b) => titleScore(query, b.title) - titleScore(query, a.title)).slice(0, 12);
}

export function createMetadataSearch({ fetch: request = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let lastArxiv = -Infinity;
  async function searchSource(source, query) {
    const key = source + ':' + query.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.results;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 4 || (source === 'arxiv' && (now() - lastArxiv < 3000 || [...pending.keys()].some(key => key.startsWith('arxiv:'))))) {
      throw new Error('Search is busy. Please try again in a few seconds.');
    }
    const task = (async () => {
      const doi = doiValue(query);
      let url;
      if (source === 'crossref') {
        url = new URL(doi ? 'https://api.crossref.org/works/' + encodeURIComponent(doi) : 'https://api.crossref.org/works');
        if (!doi) { url.searchParams.set('query.bibliographic', query); url.searchParams.set('rows', '8'); }
      } else {
        lastArxiv = now();
        url = new URL('https://export.arxiv.org/api/query');
        const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
        const stopwords = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'for', 'to', 'is', 'are', 'with', 'by', 'you', 'all']);
        const meaningful = words.filter(word => !stopwords.has(word.toLowerCase()));
        const terms = (meaningful.length ? meaningful : words).slice(0, 30);
        url.searchParams.set('search_query', doi ? 'doi:"' + doi.replace(/["\\]/g, '') + '"' : terms.map(word => 'ti:"' + word + '"').join(' OR '));
        url.searchParams.set('max_results', '8');
        url.searchParams.set('sortBy', 'relevance');
      }
      const response = await request(url, {
        redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Accept: source === 'crossref' ? 'application/json' : 'application/atom+xml', 'User-Agent': 'ReviewDesk/1.0 (scholarly metadata lookup)' },
      });
      if (response.status === 404 && source === 'crossref' && doi) return [];
      if (!response.ok) throw new Error(response.status === 429 ? 'The source rate limit was reached. Try again later.' : 'The source is unavailable. Try again later.');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { throw new Error('The source returned an oversized response.'); }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const results = source === 'crossref' ? crossrefResults(JSON.parse(body)) : arxivResults(body);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { results, expires: now() + 15 * 60 * 1000 });
      return results;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return async ({ query, sources }) => {
    const responses = await Promise.allSettled(sources.map(source => searchSource(source, query)));
    const results = [], warnings = [];
    responses.forEach((response, index) => {
      if (response.status === 'fulfilled') results.push(...response.value);
      else {
        const message = response.reason?.message;
        warnings.push({ source: sources[index], message: /^(Search is busy|The source)/.test(message) ? message : names[sources[index]] + ' could not be reached or returned invalid metadata. You can retry or enter details manually.' });
      }
    });
    return { results: rankResults(results, query), warnings };
  };
}
