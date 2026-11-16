import assert from 'node:assert/strict';
import test from 'node:test';
import { createBibtexLookup, createMetadataSearch, arxivResults, crossrefResults, rankResults } from '../server/metadata.mjs';
import { applyMetadata, metadataChanges, prepareBibtexImport } from '../src/metadata.ts';
import { bibliography, blankReview, newPaper, paperSchema, reviewSchema } from '../src/model.ts';

const work = {
  title: ['Attention Is All You Need'], author: [{ given: 'Ashish', family: 'Vaswani' }, { name: 'A Research Group' }],
  'published-print': { 'date-parts': [[2017, 6]] }, 'container-title': ['NeurIPS'], DOI: '10.5555/attention',
};
const crossref = { message: { items: [work] } };
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All\n You Need</title><published>2017-06-12T17:57:34Z</published><author><name>Ashish Vaswani</name></author><author><name>A &amp; B</name></author><link title="pdf" href="http://arxiv.org/pdf/1706.03762"/><arxiv:doi>10.5555/attention</arxiv:doi></entry></feed>`;

test('provider parsing handles bibliographic fields, namespaces, missing data, and safe source links', () => {
  const [record] = crossrefResults(crossref);
  assert.equal(record.authors, 'Ashish Vaswani; A Research Group');
  assert.equal(record.year, 2017);
  assert.equal(record.url, 'https://doi.org/10.5555/attention');
  const [preprint] = arxivResults(atom);
  assert.equal(preprint.title, record.title);
  assert.equal(preprint.authors, 'Ashish Vaswani; A & B');
  assert.equal(preprint.venue, 'arXiv preprint');
  assert.equal(preprint.url, 'https://arxiv.org/abs/1706.03762v7');
  assert.equal(crossrefResults({ message: { items: [{ title: ['Minimal'], URL: 'javascript:alert(1)' }] } })[0].url, '');
  assert.throws(() => arxivResults('<feed>bad'));
  assert.throws(() => arxivResults('<!DOCTYPE feed [<!ENTITY a "x">]><feed/>'));
});

test('matching ranks imperfect titles and merges shared DOIs with source labels, keeping distinct versions', () => {
  const records = crossrefResults(crossref);
  const results = rankResults([
    { ...records[0], title: 'An unrelated subject', doi: '10.5555/other' },
    ...records, ...arxivResults(atom),
    { ...records[0], doi: '', venue: 'Different preprint' },
  ], 'attenton is all you need');
  assert.equal(results[0].title, work.title[0]);
  assert.deepEqual(results[0].sources, ['crossref', 'arxiv']);
  assert.equal(results.length, 3);
});

test('search calls only selected APIs, uses bounded requests, caches responses, and supports exact DOI lookup', async () => {
  const calls = [];
  const search = createMetadataSearch({ fetch: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json(crossref);
  } });
  await search({ query: 'attention is all you need', sources: ['crossref'] });
  await search({ query: 'attention is all you need', sources: ['crossref'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.host, 'api.crossref.org');
  assert.equal(calls[0].url.searchParams.get('rows'), '8');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal);
  await search({ query: 'https://doi.org/10.5555/attention', sources: ['crossref'] });
  assert.equal(calls[1].url.pathname, '/works/10.5555%2Fattention');
});

test('arXiv uses the API with title terms, throttles new requests, and searches DOI without fetching PDFs', async () => {
  const calls = [];
  const search = createMetadataSearch({ now: () => 10_000, fetch: async url => { calls.push(new URL(url)); return new Response(atom); } });
  const first = await search({ query: 'attention need', sources: ['arxiv'] });
  assert.equal(first.results.length, 1);
  assert.equal(calls[0].host, 'export.arxiv.org');
  assert.equal(calls[0].searchParams.get('search_query'), 'ti:"attention" OR ti:"need"');
  const next = await search({ query: 'another paper', sources: ['arxiv'] });
  assert.equal(next.warnings[0].source, 'arxiv');
  assert.equal(calls.length, 1);
  const exact = createMetadataSearch({ fetch: async url => { calls.push(new URL(url)); return new Response(atom); } });
  await exact({ query: '10.1234/test', sources: ['arxiv'] });
  assert.equal(calls[1].searchParams.get('search_query'), 'doi:"10.1234/test"');
});

test('partial provider failures keep successful results and identify the failed source', async () => {
  const search = createMetadataSearch({ fetch: async url => {
    if (new URL(url).host === 'export.arxiv.org') throw new Error('network unavailable');
    return Response.json(crossref);
  } });
  const response = await search({ query: 'attention', sources: ['crossref', 'arxiv'] });
  assert.equal(response.results.length, 1);
  assert.equal(response.warnings[0].source, 'arxiv');
  const limited = createMetadataSearch({ fetch: async () => new Response('', { status: 429 }) });
  assert.match((await limited({ query: 'paper', sources: ['crossref'] })).warnings[0].message, /rate limit/);
});

test('metadata application preserves unchecked text, custom fields, citation choices, and missing values', () => {
  const paper = { ...newPaper(), title: 'My title', authors: 'My authors', bibtex: '@misc{mykey, title={My title}}', citeKey: 'mykey', values: { custom: 'Keep this' }, tags: ['Keep tag'] };
  const result = crossrefResults(crossref)[0];
  const changes = metadataChanges(paper, result);
  assert.ok(changes.includes('title'));
  const next = applyMetadata(paper, result, ['year', 'doi', 'url']);
  assert.equal(next.title, paper.title);
  assert.equal(next.authors, paper.authors);
  assert.deepEqual(next.values, paper.values);
  assert.deepEqual(next.tags, paper.tags);
  assert.equal(next.bibtex, paper.bibtex);
  assert.equal(next.citeKey, paper.citeKey);
  assert.equal(next.year, 2017);
  assert.equal(applyMetadata(next, { ...result, year: null, authors: '' }, ['year', 'authors']).year, 2017);
});

test('old review documents remain valid and DOI survives exports and bibliography generation', () => {
  const old = { ...newPaper(), title: 'Old paper' };
  delete old.doi;
  const review = reviewSchema.parse({ ...blankReview(), papers: [old] });
  assert.equal(review.papers[0].doi, '');
  const paper = paperSchema.parse({ ...old, doi: '10.1234/example', venue: 'Journal' });
  assert.match(bibliography([paper]), /doi = \{10.1234\/example\}/);
  assert.equal(paperSchema.safeParse({ ...paper, doi: 'not a doi' }).success, false);
});

test('BibTeX is fetched on demand from the fixed DOI transform endpoint, with extracted key and cache', async () => {
  const calls = [];
  const entry = '@article{source2026, title={A {Nested} Title}, year={2026}}';
  const lookup = createBibtexLookup({ fetch: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(entry);
  } });
  assert.equal(calls.length, 0);
  const result = await lookup({ doi: '10.1234/example' });
  assert.equal(result.bibtex, entry);
  assert.equal(result.citeKey, 'source2026');
  assert.equal(result.source, 'crossref');
  assert.equal(result.warning, '');
  assert.equal(calls[0].url.href, 'https://api.crossref.org/works/10.1234%2Fexample/transform/application/x-bibtex');
  assert.equal(calls[0].options.headers.Accept, 'application/x-bibtex');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal);
  await lookup({ doi: '10.1234/example' });
  assert.equal(calls.length, 1);
});

test('BibTeX unavailable, invalid, oversized, and failed responses leave citation fields empty with a warning', async () => {
  const cases = [
    async () => new Response('', { status: 404 }),
    async () => new Response('', { status: 429 }),
    async () => new Response('<html>Service unavailable</html>'),
    async () => new Response('@misc{one, title={First}} @misc{two, title={Second}}'),
    async () => new Response('@misc{large, title={' + 'x'.repeat(20000) + '}}'),
    async () => { throw new Error('network failure'); },
  ];
  for (const request of cases) {
    const result = await createBibtexLookup({ fetch: request })({ doi: '10.1234/example' });
    assert.equal(result.bibtex, '');
    assert.equal(result.citeKey, '');
    assert.ok(result.warning);
  }
  let requests = 0;
  const unavailable = await createBibtexLookup({ fetch: async () => { requests += 1; } })({ doi: '' });
  assert.equal(requests, 0);
  assert.ok(unavailable.warning);
});

test('BibTeX cache expires and concurrent lookups for the same DOI share one request', async () => {
  let clock = 0, count = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const lookup = createBibtexLookup({ now: () => clock, fetch: async () => {
    count += 1; await gate; return new Response('@misc{testkey, title={A paper}}');
  } });
  const first = lookup({ doi: '10.1234/example' });
  const second = lookup({ doi: '10.1234/EXAMPLE' });
  release();
  assert.deepEqual(await first, await second);
  assert.equal(count, 1);
  clock = 16 * 60 * 1000;
  await lookup({ doi: '10.1234/example' });
  assert.equal(count, 2);
});

test('BibTeX import keeps key and entry consistent and resolves duplicate keys without touching fields', () => {
  const entry = '@article{source2026, title={A paper}}';
  assert.deepEqual(prepareBibtexImport(entry, []), { bibtex: entry, citeKey: 'source2026' });
  const collision = prepareBibtexImport(entry, ['SOURCE2026', 'source2026-2']);
  assert.equal(collision.citeKey, 'source2026-3');
  const paper = paperSchema.parse({ ...newPaper(), title: 'My title', ...collision });
  assert.equal(paper.citeKey, 'source2026-3');
  assert.match(paper.bibtex, /^@article\{source2026-3,/);
  assert.equal(prepareBibtexImport('not BibTeX', []), null);
  const longKey = 'x'.repeat(100);
  assert.equal(prepareBibtexImport('@misc{' + longKey + ', title={Title}}', [longKey]).citeKey.length, 100);
});
