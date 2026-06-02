# Letterboxd Watch Party

Compare public Letterboxd watchlists with friends and find films you have in common—no Letterboxd login required.

Add people by username or profile URL, scrape their public watchlists on the server, and browse overlap ranked by how many party members want to see each film (at least 2 in common). The UI uses Letterboxd’s dark palette and shows who has each title with profile avatars.

## Features

- **Watch party** — up to 10 Letterboxd users per party
- **Friend suggestions** — after adding someone, browse their mutual followers and following list to add more people quickly
- **Ranked overlap** — films sorted by overlap count (e.g. 4 of 5 watchlists), 10 per page
- **Shareable links** — party saved in the URL (`?users=alice,bob`) and in `localStorage`
- **Posters** — film thumbnails from Letterboxd’s CDN with fallbacks when URLs differ

## Getting started

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm run start
```

### Tests

```bash
npm test
```

## Usage

1. Add a Letterboxd username or profile URL (e.g. `letterboxd.com/yourname` or `yourname`).
2. Use **friend suggestions** to add mutuals, or click another party member to browse their network.
3. Click **Find overlap** when everyone is in the party (needs at least 2 members).
4. Use **Copy share link** to send the party URL to friends.

**Start over** clears the party, saved storage, and the URL query string.

Visit `http://localhost:3000/?fresh` once for a blank party without clearing site data manually.

## How it works

Letterboxd has no public API. This app fetches public HTML on the server (Next.js API routes + Cheerio), caches results in memory for ~20 minutes, and runs overlap logic in the browser.

| Route | Purpose |
|-------|---------|
| `GET /api/watchlist/[username]` | Scrape a user’s watchlist |
| `GET /api/network/[username]` | Following / followers → mutuals |
| `GET /api/poster/[slug]` | Poster URL fallback from film page |

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router)
- React 19, TypeScript, Tailwind CSS 4
- [Vitest](https://vitest.dev/) for unit tests

## Notes

- Watchlists and networks must be **public** on Letterboxd.
- Scraping is best-effort; heavy use or markup changes may cause failures.
- For personal / non-commercial use; respect Letterboxd’s terms and rate limits.
