# Review Desk

Review Desk is a self-hosted literature review workspace. Collect papers and PDFs, compare methods against your own approach, link evidence to positioning claims, and draft related work in LaTeX. Each review has its own tags, relation categories, and fields. Review Desk runs on Node.js and stores its data in a single local SQLite database.

## Quick start

Install [Node.js 24 LTS](https://nodejs.org/en/download) (24.14 or later). From the cloned or unzipped project folder, 

* run one of these:

    ```sh
    npm ci --omit=dev
    ```
    or
    ```sh
    npm ci --include=dev
    ```
    or
    ```sh
    npm ci --include=dev --include=optional --ignore-scripts
    ```

* do build

    ```sh
    npm run build
    ```

* create admin account

    ```sh
    npm run admin -- create
    ```

* start the app

    ```sh
    npm start
    ```

Open [http://127.0.0.1:8080/](http://127.0.0.1:8080/), sign in with the owner account you created.

Run the owner creation command once per database. Use `npm run admin -- reset` to reset the existing owner's password.

The dependency install includes esbuild's platform binary. The browser build uses that binary with dependency install scripts disabled. To change the server port, run `npm start -- --port 8090`. For shared access, use the HTTPS setup below.

## Review workflow

1. **Collect** papers in the library. Enter metadata manually, add tags and a relation, and attach PDFs up to 25 MiB each. Paste a BibTeX entry or generate one from the paper details.
2. **Customize** your review in **Review settings**. Create and rename tags or relations. Choose which fields appear on papers, on the reference profile, or on both.
3. **Compare** up to six selected papers alongside your reference profile. Export the table as CSV.
4. **Position** your contribution with categorized claims. Link papers to each claim and record what they support or qualify.
5. **Write** related-work and contribution drafts with in-app LaTeX preview, citation insertion, and LaTeX and BibTeX exports.

The theme selector has two light and two dark themes. The comparison table scrolls horizontally on smaller screens.

## Accounts and visibility

The owner creates accounts in **Admin → Accounts**. Editors can update reviews, attach PDFs, and comment. Commenters can read and comment. Viewers can read. Every active account can read private reviews.

New reviews start private. **Admin → Review access** lets you enable signed-out viewing for a particular review. Public viewing includes paper notes, claims, drafts, and comments. The separate PDF option controls downloads by signed-out visitors. This setting applies to your app. GitHub repository visibility controls who can see the source code.

## Serve over HTTPS with Nginx

Review Desk provides its own HTTP server. To expose it through Nginx on the same machine, keep it on `127.0.0.1:8080` and start it with the proxy and secure-cookie settings:

```sh
LITERATURE_TRUST_PROXY=1 LITERATURE_SECURE_COOKIES=1 npm start
```

Add [the sample location block](deploy/nginx-location.conf) to your existing HTTPS virtual host. Serve it at the root of its hostname, such as `https://review.example.com/`. Check the configuration with `nginx -t` before reloading Nginx.

## Storage, backup, and migration

The app creates `data/literature.sqlite3` on first use. It holds reviews, drafts, accounts, comments, and PDF attachments. To keep runtime data outside the repository, set `LITERATURE_DATA_DIR` to an absolute path and use that setting for the server, owner account commands, and backups.

```sh
npm run backup -- /path/to/backups/review-desk.sqlite3
```

The destination must be a new file. To restore it, stop Review Desk, preserve a copy of the current data directory, and put the backup in a fresh data directory as `literature.sqlite3`. Point `LITERATURE_DATA_DIR` at that directory before restarting.

**Paper library → Export → Review and drafts (.json)** exports a single review for import into another installation. To move the original MAPO review, use its **Full review (.json)** export, then select **Import review** in Review Desk. Use a SQLite backup to migrate PDFs, comments, and accounts along with the reviews.

## Development

```sh
npm run check
npm test
npm run build
```

| Path | Contents |
| --- | --- |
| `src/` | React frontend, shared review model, and styles |
| `server/` | HTTP API, authentication, and SQLite storage |
| `scripts/` | Browser build, owner account setup, and backup |
| `public/` | Fonts, bundled font licenses, and the app icon |
| `deploy/` | Sample Nginx configuration |
| `test/` | Model and HTTP API tests |

---

## Paper editor and metadata lookup

**Add paper** and **Edit paper** open a full-page editor; paper links still open a quick-view panel. Library filters and selection stay in place when returning from the editor. Unsaved paper changes are protected when navigating away.

In **Find paper metadata**, enter a rough title, DOI, or DOI link, select **Crossref**, **arXiv**, or both, and click **Find paper**. There are no automatic searches. Results identify their sources and link to the original record. Select **Review metadata**, choose the fields to fill, then save the paper. Title, authors, year, venue, DOI, and source URL can be filled; missing metadata never clears a field. Existing values are unchecked by default when editing. Notes, custom fields, tags, and pasted BibTeX stay unchanged. Pasted BibTeX takes precedence when exporting the bibliography, so update it separately if needed. Custom review fields can also be added in the editor.

The server calls only the Crossref REST API (`api.crossref.org`) and the arXiv Atom API (`export.arxiv.org`); no API keys are required. Deployments with restricted egress must allow HTTPS to these two hosts. Standard HTTP(S) proxy environment settings are supported. Metadata lookup does not scrape pages, request abstracts, or download PDFs. Only the query is sent to selected services. Attach PDFs yourself as before.

Requests have a 12-second timeout, bounded response size, and no automatic retries. Results are cached in server memory for 15 minutes (up to 100 searches); this cache disappears on restart. Search is limited to once every three seconds per account, with additional server-wide arXiv pacing. One source failing does not hide another source's results. You can always enter details manually. Title matching is approximate and source-dependent; verify authors and publication versions before importing.
