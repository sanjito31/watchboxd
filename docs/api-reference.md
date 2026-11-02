# Watchboxd API v1 reference

This document is the integration contract for applications consuming the
Watchboxd HTTP API. It describes every public v1 endpoint, request parameter,
response shape, asynchronous cache-miss workflow, and error code.

Contract reviewed: **2026-08-26**.

- API prefix: `{BASE_URL}/api/v1`
- Media type: `application/json`
- Public read endpoints: no authentication
- Manual job endpoint: bearer-token authentication required
- Date-time strings: ISO 8601 UTC, for example `2026-08-26T14:30:00.000Z`
- Date-only strings: `YYYY-MM-DD`, for example `2014-11-05`

Replace `{BASE_URL}` with the deployed Watchboxd origin. Clients should send
`Accept: application/json`. Requests with a JSON body must also send
`Content-Type: application/json`.

## Endpoint index

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/users/{username}` | None | Get a Letterboxd profile. |
| `GET` | `/users/{username}/watchlist` | None | Get a filtered, paginated watchlist. |
| `GET` | `/users/{username}/watched` | None | Get filtered, paginated watched movies and user ratings. |
| `GET` | `/users/{username}/network` | None | Get mutuals and followed accounts. |
| `GET` | `/movies/{tmdbId}` | None | Get a full movie by TMDB ID. |
| `GET` | `/movies/letterboxd/{letterboxdSlug}` | None | Get a full movie by Letterboxd slug or known alias. |
| `GET` | `/overlap` | None | Get a watchlist intersection; compatibility path. |
| `GET` | `/overlap/watchlist` | None | Get a watchlist intersection. |
| `GET` | `/overlap/watched` | None | Get a deduplicated watched union with attribution. |
| `GET` | `/jobs/{jobId}` | None | Poll a background job. |
| `POST` | `/jobs` | Bearer token | Manually request a refresh job. |

All paths in this table are relative to `{BASE_URL}/api/v1`.

## Response lifecycle

Most resource endpoints are cache-backed. A client must handle both immediate
data and asynchronous cache misses.

```ts
interface DataResponse<T> {
  data: T
  meta: CacheMeta
}

interface MovieEnrichmentMeta {
  complete: boolean
  pendingSlugs: string[]
  failedSlugs: string[]
}

interface CacheMeta {
  cache: "hit" | "stale"
  fetchedAt: string
  staleAt: string
  refreshJobs: JobSummary[]
  enrichment?: MovieEnrichmentMeta
}

interface AcceptedResponse {
  data: null
  meta: {
    cache: "miss"
    jobs: JobSummary[]
  }
}

interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}
```

### `200 OK`: data available

```jsonc
{
  "data": "<endpoint-specific data>",
  "meta": {
    "cache": "hit",
    "fetchedAt": "2026-08-26T14:30:00.000Z",
    "staleAt": "2026-08-26T20:30:00.000Z",
    "refreshJobs": []
  }
}
```

`meta.cache` is:

- `hit`: the resource is fresh and `refreshJobs` is empty.
- `stale`: usable data was returned immediately and one or more refresh jobs
  were queued or reused. The client does not need to block on these jobs.

| Metadata field | Type | Meaning |
| --- | --- | --- |
| `cache` | `"hit" \| "stale"` | Freshness/result state for the returned snapshot. |
| `fetchedAt` | ISO 8601 string | When the returned resource snapshot was fetched. |
| `staleAt` | ISO 8601 string | When that snapshot becomes or became stale. |
| `refreshJobs` | `JobSummary[]` | Deduplicated non-blocking refresh jobs. Empty for a cache hit. |
| `enrichment` | `MovieEnrichmentMeta` | Present on list and overlap responses; describes only the returned page. |

List and overlap responses also contain page-scoped enrichment state:

```json
{
  "complete": false,
  "pendingSlugs": ["example-film"],
  "failedSlugs": ["unavailable-film"]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `complete` | `boolean` | `true` when no movie on the returned page is pending or failed. |
| `pendingSlugs` | `string[]` | Page movies whose Letterboxd movie enrichment is still pending. |
| `failedSlugs` | `string[]` | Page movies whose enrichment failed. The provisional movie data remains usable. |

### `202 Accepted`: required snapshot missing

```jsonc
{
  "data": null,
  "meta": {
    "cache": "miss",
    "jobs": [
      {
        "id": "00000000-0000-4000-8000-000000000001",
        "type": "watchlist",
        "resourceKey": "watchlist:alice",
        "status": "queued",
        "attempts": 0,
        "statusUrl": "/api/v1/jobs/00000000-0000-4000-8000-000000000001",
        "createdAt": "2026-08-26T14:30:00.000Z",
        "startedAt": null,
        "finishedAt": null,
        "error": null
      }
    ]
  }
}
```

The response includes:

- `Location`: the first job's status path.
- `Retry-After: 2`: suggested delay in seconds before polling.

There may be multiple jobs, especially for overlap or network requests. Poll
every distinct job in `meta.jobs`. When all jobs succeed, repeat the original
resource request. That repeated request can return another `202` if another
required snapshot is discovered, so clients should repeat the workflow until
they receive `200` or an error.

### Error envelope

```json
{
  "error": {
    "code": "invalid_request",
    "message": "runtimeMin must be less than or equal to runtimeMax"
  }
}
```

| HTTP status | Error code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | Invalid filter, enum, body, or other request input. |
| `400` | `invalid_username` | Invalid username path parameter. |
| `400` | `invalid_movie_slug` | Invalid Letterboxd slug path parameter. |
| `400` | `invalid_tmdb_id` | Invalid TMDB ID path parameter. |
| `400` | `invalid_pagination` | Invalid `page` or `pageSize`. |
| `400` | `invalid_overlap_users` | Missing, invalid, or unsupported overlap user list. |
| `401` | `unauthorized` | Missing or incorrect manual-job bearer token. |
| `404` | `resource_not_found` | The requested Letterboxd resource does not exist. |
| `404` | `job_not_found` | The job UUID does not exist or is malformed. |
| `429` | `rate_limited` | The upstream provider rate-limited the refresh. |
| `500` | `internal_error` | The request or background-job publication failed internally. |
| `503` | `upstream_unavailable` | The upstream provider is temporarily unavailable. |

Clients should branch on `error.code`, not the human-readable message.

## Common data shapes

### Pagination

```ts
interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
```

- `page` is the page actually returned. Requests beyond the last page are
  clamped to the last page.
- `total` is the number of movies after all filters are applied.
- `totalPages` is always at least `1`, including when `total` is `0`.

### Profile summary

```ts
interface ProfileSummary {
  username: string
  displayName: string | null
  avatarUrl: string | null
}
```

### Movie

```ts
interface Movie {
  letterboxdSlug: string
  title: string
  year: number | null
  letterboxdFilmId: number | null
  tmdbId: number | null
  letterboxdPoster: string | null
  letterboxdRating: number | null
  metadata?: MovieMetadata | null
}
```

| Field | Meaning |
| --- | --- |
| `letterboxdSlug` | Canonical Letterboxd film slug. |
| `title` | Stored Letterboxd title. Provisional list entries can change after enrichment. |
| `year` | Release year, or `null` if unknown. |
| `letterboxdFilmId` | Letterboxd's numeric film ID, or `null`. |
| `tmdbId` | TMDB movie ID, or `null`. |
| `letterboxdPoster` | Absolute Letterboxd poster URL, or `null`. |
| `letterboxdRating` | Letterboxd average rating on a `0`–`5` scale, or `null`. |
| `metadata` | Omitted when `includeMetadata=false`; otherwise a metadata object or `null`. Direct movie endpoints always include this field. |

### TMDB metadata and genre

```ts
interface Genre {
  id: number
  name: string
}

interface MovieMetadata {
  runtimeMinutes: number | null
  overview: string | null
  tmdbTitle: string | null
  originalTitle: string | null
  originalLanguage: string | null
  tmdbReleaseDate: string | null // YYYY-MM-DD
  tmdbVoteAverage: number | null // 0–10
  tmdbPosterPath: string | null
  tmdbBackdropPath: string | null
  tmdbFetchedAt: string // ISO 8601
  tmdbStaleAt: string // ISO 8601
  genres: Genre[]
}
```

`tmdbPosterPath` and `tmdbBackdropPath` are TMDB paths such as
`/abc123.jpg`, not absolute URLs. The consuming app must combine them with its
chosen TMDB image base URL and size.

Direct movie endpoints return `metadata: null` immediately when metadata is
missing and a TMDB ID is available, while also returning a deduplicated
`movie_metadata` job in `meta.refreshJobs`. This remains a `200` response; it
is not a blocking `202` cache miss.

### Job

```ts
type JobType =
  | "profile"
  | "watchlist"
  | "watched"
  | "network"
  | "movie"
  | "movie_metadata"

type JobStatus = "queued" | "running" | "succeeded" | "partial" | "failed"

type JobFailureCode =
  | "invalid_input"
  | "not_found"
  | "upstream_unavailable"
  | "upstream_blocked"
  | "rate_limited"
  | "timeout"
  | "parse_error"
  | "attempts_exhausted"
  | "unknown"

interface JobSummary {
  id: string
  type: JobType
  resourceKey: `${JobType}:${string}`
  status: JobStatus
  attempts: number
  statusUrl: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: { code: JobFailureCode; message: string } | null
}
```

`statusUrl` is root-relative. Resolve it against `{BASE_URL}` before making a
request.

## Shared list and overlap query parameters

The following parameters are supported by:

- `GET /users/{username}/watchlist`
- `GET /users/{username}/watched`
- `GET /overlap`
- `GET /overlap/watchlist`
- `GET /overlap/watched`

| Parameter | Type | Default | Validation and semantics |
| --- | --- | --- | --- |
| `page` | positive integer | `1` | Requested 1-based page. |
| `pageSize` | positive integer | `50` for individual lists; `10` for overlaps | Maximum `100`. |
| `includeMetadata` | `true` or `false` | `false` | Controls response shape only. Metadata filters still apply when `false`. Values are case-sensitive. |
| `title` | string | — | Trimmed, 1–200 characters. Case-insensitive substring search across `title`, `tmdbTitle`, and `originalTitle`. |
| `letterboxdSlug` | string | — | Exact canonical slug after trimming/lowercasing. Allowed characters: `a-z`, `0-9`, `_`, `-`. |
| `letterboxdFilmId` | positive integer | — | Exact Letterboxd film ID; maximum `2147483647`. |
| `tmdbId` | positive integer | — | Exact TMDB movie ID; maximum `2147483647`. |
| `year` | integer | — | Exact year from `1870` through `3000`. |
| `runtimeMin` | integer | — | Inclusive minimum runtime in minutes; at least `0`. |
| `runtimeMax` | integer | — | Inclusive maximum runtime in minutes; at least `0`. |
| `releaseDateFrom` | date | — | Inclusive TMDB release date; strict `YYYY-MM-DD`. |
| `releaseDateTo` | date | — | Inclusive TMDB release date; strict `YYYY-MM-DD`. |
| `originalLanguage` | string | — | Case-insensitive language code: 2–3 letters with an optional hyphenated subtag. |
| `tmdbRatingMin` | number | — | Inclusive minimum from `0` to `10`. |
| `tmdbRatingMax` | number | — | Inclusive maximum from `0` to `10`. |
| `letterboxdRatingMin` | number | — | Inclusive minimum from `0` to `5`. |
| `letterboxdRatingMax` | number | — | Inclusive maximum from `0` to `5`. |
| `genreIds` | positive integer list | — | TMDB genre IDs. Comma-separated, repeated, or both. |
| `genres` | string list | — | Case-insensitive exact genre names. Comma-separated, repeated, or both; each value is at most 100 characters. |
| `genreMode` | `any` or `all` | `any` | `any` requires at least one supplied ID/name criterion. `all` requires every supplied ID/name criterion. |

For every min/max pair, the minimum must be less than or equal to the maximum.
A movie with missing metadata does not match a filter on that metadata field.

List parameters can be encoded either way:

```text
?genreIds=18,878&genres=Drama,Science%20Fiction
?genreIds=18&genreIds=878&genres=Drama&genres=Science%20Fiction
```

Duplicate genre criteria are removed.

Watched endpoints additionally support:

| Parameter | Type | Default | Semantics |
| --- | --- | --- | --- |
| `userRatingMin` | number | — | Inclusive Letterboxd user-rating minimum from `0` to `5`. |
| `userRatingMax` | number | — | Inclusive Letterboxd user-rating maximum from `0` to `5`. |

An unrated watched item has `userRating: null` and does not match a supplied
user-rating range.

## User endpoints

### Get profile

```http
GET /api/v1/users/{username}
```

#### Path parameters

| Parameter | Type | Rules |
| --- | --- | --- |
| `username` | string | Trimmed and lowercased; allowed characters are `a-z`, `0-9`, `_`, and `-`. Pass a bare username, not a Letterboxd URL or `@username`. |

#### Request body

None.

#### `200` data shape

```ts
interface ProfileData extends ProfileSummary {
  letterboxdUrl: string
}
```

```json
{
  "data": {
    "username": "alice",
    "displayName": "Alice Example",
    "avatarUrl": "https://a.ltrbxd.com/avatar.jpg",
    "letterboxdUrl": "https://letterboxd.com/alice/"
  },
  "meta": {
    "cache": "hit",
    "fetchedAt": "2026-08-26T14:30:00.000Z",
    "staleAt": "2026-08-27T14:30:00.000Z",
    "refreshJobs": []
  }
}
```

### Get watchlist

```http
GET /api/v1/users/{username}/watchlist
```

Supports every shared list parameter. It does not support user-rating filters.

```text
/api/v1/users/alice/watchlist?page=1&pageSize=25&includeMetadata=true&runtimeMax=120&genreIds=35,10749&genreMode=any
```

#### Request body

None.

#### `200` data shape

```ts
interface WatchlistItem {
  position: number
  movie: Movie
}

interface WatchlistData {
  user: ProfileSummary
  items: WatchlistItem[]
  filmCount: number
  complete: boolean
  pagination: PaginationMeta
}
```

- `filmCount` equals the filtered `pagination.total`.
- `complete` is `false` when Letterboxd blocked pagination (a Cloudflare
  challenge) on the last refresh. Only the films that could still be read were
  merged into the stored list, so older films may be missing and removed
  films may linger.
- `position` is the movie's original position in the stored Letterboxd list;
  it is not a page-relative array index.
- Items are ordered by `position` ascending.

```jsonc
{
  "data": {
    "user": {
      "username": "alice",
      "displayName": "Alice Example",
      "avatarUrl": null
    },
    "items": [
      {
        "position": 12,
        "movie": {
          "letterboxdSlug": "example-film",
          "title": "Example Film",
          "year": 2024,
          "letterboxdFilmId": 12345,
          "tmdbId": 67890,
          "letterboxdPoster": "https://a.ltrbxd.com/poster.jpg",
          "letterboxdRating": 3.9,
          "metadata": null
        }
      }
    ],
    "filmCount": 1,
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "total": 1,
      "totalPages": 1
    }
  },
  "meta": {
    "cache": "hit",
    "fetchedAt": "2026-08-26T14:30:00.000Z",
    "staleAt": "2026-08-26T20:30:00.000Z",
    "refreshJobs": [],
    "enrichment": {
      "complete": true,
      "pendingSlugs": [],
      "failedSlugs": []
    }
  }
}
```

The example includes `metadata` because the request used
`includeMetadata=true`. Without that parameter, the `metadata` key is omitted.

### Get watched movies

```http
GET /api/v1/users/{username}/watched
```

Supports every shared list parameter plus `userRatingMin` and
`userRatingMax`.

```text
/api/v1/users/alice/watched?page=1&pageSize=50&userRatingMin=4&originalLanguage=fr
```

#### Request body

None.

#### `200` data shape

```ts
interface WatchedItem {
  position: number
  movie: Movie
  userRating: number | null
}

interface WatchedData {
  user: ProfileSummary
  items: WatchedItem[]
  filmCount: number
  complete: boolean
  pagination: PaginationMeta
}
```

The watchlist notes for `filmCount`, `complete`, `position`, metadata inclusion, ordering,
and `meta.enrichment` also apply. `userRating` is the requested user's
Letterboxd rating on a `0`–`5` scale, or `null` if the user did not rate it.

### Get network

```http
GET /api/v1/users/{username}/network
```

#### Request body and query parameters

None.

#### `200` data shape

```ts
interface NetworkData {
  username: string
  user: ProfileSummary
  mutuals: ProfileSummary[]
  following: ProfileSummary[]
  truncated: boolean
}
```

| Field | Meaning |
| --- | --- |
| `mutuals` | Accounts with a mutual relationship to the requested user. |
| `following` | Other accounts followed by the requested user. |
| `truncated` | `true` when the stored network reached the scraper's configured scan limit. |

## Movie endpoints

Both direct movie endpoints return the same full movie data and always include
the `metadata` key.

### Get movie by TMDB ID

```http
GET /api/v1/movies/{tmdbId}
```

#### Path parameters

| Parameter | Type | Rules |
| --- | --- | --- |
| `tmdbId` | positive integer | Maximum `2147483647`. |

#### Request body and query parameters

None.

### Get movie by Letterboxd slug

```http
GET /api/v1/movies/letterboxd/{letterboxdSlug}
```

The slug can be the movie's current canonical slug or a stored historical
alias.

#### Path parameters

| Parameter | Type | Rules |
| --- | --- | --- |
| `letterboxdSlug` | string | Trimmed and lowercased; allowed characters are `a-z`, `0-9`, `_`, and `-`. |

#### Request body and query parameters

None.

### Direct movie `200` data shape

```ts
interface FullMovie extends Movie {
  metadata: MovieMetadata | null
}
```

```json
{
  "data": {
    "letterboxdSlug": "interstellar",
    "title": "Interstellar",
    "year": 2014,
    "letterboxdFilmId": 6114,
    "tmdbId": 157336,
    "letterboxdPoster": "https://a.ltrbxd.com/interstellar.jpg",
    "letterboxdRating": 4.4,
    "metadata": {
      "runtimeMinutes": 169,
      "overview": "A team travels through a wormhole in space.",
      "tmdbTitle": "Interstellar",
      "originalTitle": "Interstellar",
      "originalLanguage": "en",
      "tmdbReleaseDate": "2014-11-05",
      "tmdbVoteAverage": 8.5,
      "tmdbPosterPath": "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
      "tmdbBackdropPath": "/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg",
      "tmdbFetchedAt": "2026-08-26T14:30:00.000Z",
      "tmdbStaleAt": "2026-11-24T14:30:00.000Z",
      "genres": [
        { "id": 12, "name": "Adventure" },
        { "id": 18, "name": "Drama" },
        { "id": 878, "name": "Science Fiction" }
      ]
    }
  },
  "meta": {
    "cache": "hit",
    "fetchedAt": "2026-08-26T14:30:00.000Z",
    "staleAt": "2026-08-27T14:30:00.000Z",
    "refreshJobs": []
  }
}
```

## Overlap endpoints

Every overlap request requires a `users` query parameter containing 2–10
unique usernames. Usernames are comma-separated, trimmed, lowercased, and
deduplicated while preserving first-seen order.

```text
?users=alice,bob,charlie
```

Passing fewer than 2 or more than 10 unique valid usernames returns
`invalid_overlap_users`.

### Get watchlist intersection

```http
GET /api/v1/overlap/watchlist?users={username1},{username2}
GET /api/v1/overlap?users={username1},{username2}
```

The two paths are aliases with identical behavior. New integrations should use
`/overlap/watchlist`; `/overlap` is preserved for compatibility.

The response contains only movies present on every requested user's watchlist.
It supports every shared list parameter. User-rating parameters are not
supported.

```text
/api/v1/overlap/watchlist?users=alice,bob&includeMetadata=true&genres=Drama,Comedy&genreMode=all
```

#### `200` data shape

```ts
interface WatchlistOverlapMovie extends Movie {
  presentFor: ProfileSummary[]
  overlapCount: number
  partySize: number
}

interface WatchlistOverlapData {
  users: ProfileSummary[]
  incompleteUsernames: string[]
  films: WatchlistOverlapMovie[]
  pagination: PaginationMeta
}
```

- `users` follows the normalized request order.
- `incompleteUsernames` lists requested users whose stored watchlist is
  partial (see the watchlist `complete` field).
- `presentFor` identifies the requested users whose watchlists contain the
  movie. Because this endpoint is a true intersection, it contains every
  requested user.
- `overlapCount` is `presentFor.length` and therefore equals `partySize`.
- Films are ordered by overlap count descending and then title
  case-insensitively. For a true intersection, the title ordering is normally
  the effective ordering.

### Get watched union

```http
GET /api/v1/overlap/watched?users={username1},{username2}
```

Returns the deduplicated union of movies watched by at least one requested
user. It supports every shared list parameter, `userRatingMin`,
`userRatingMax`, and:

| Parameter | Type | Default | Semantics |
| --- | --- | --- | --- |
| `ratingMode` | `any` or `all` | `any` | Applies only when a user-rating range is supplied. `any` requires at least one watcher's non-null rating to match. `all` requires every requested user who watched that movie to have a non-null matching rating. |

Attribution still includes all requested users who watched a returned movie,
even when `ratingMode=any` and only some ratings match the filter.

```text
/api/v1/overlap/watched?users=alice,bob,charlie&userRatingMin=3.5&ratingMode=all&includeMetadata=true
```

#### `200` data shape

```ts
interface WatchedBy extends ProfileSummary {
  userRating: number | null
}

interface WatchedOverlapMovie extends Movie {
  watchedBy: WatchedBy[]
  watchedCount: number
  partySize: number
}

interface WatchedOverlapData {
  users: ProfileSummary[]
  incompleteUsernames: string[]
  films: WatchedOverlapMovie[]
  pagination: PaginationMeta
}
```

`incompleteUsernames` lists requested users whose stored watched list is
partial (see the watchlist `complete` field).

- `watchedBy` follows normalized request-user order.
- `watchedCount` is `watchedBy.length`.
- `partySize` is the number of unique requested users.
- Films are ordered by `watchedCount` descending, then title
  case-insensitively.

```jsonc
{
  "data": {
    "users": [
      { "username": "alice", "displayName": "Alice", "avatarUrl": null },
      { "username": "bob", "displayName": "Bob", "avatarUrl": null }
    ],
    "films": [
      {
        "letterboxdSlug": "example-film",
        "title": "Example Film",
        "year": 2024,
        "letterboxdFilmId": 12345,
        "tmdbId": 67890,
        "letterboxdPoster": null,
        "letterboxdRating": 3.9,
        "watchedBy": [
          {
            "username": "alice",
            "displayName": "Alice",
            "avatarUrl": null,
            "userRating": 4.5
          },
          {
            "username": "bob",
            "displayName": "Bob",
            "avatarUrl": null,
            "userRating": null
          }
        ],
        "watchedCount": 2,
        "partySize": 2
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "total": 1,
      "totalPages": 1
    }
  },
  "meta": {
    "cache": "hit",
    "fetchedAt": "2026-08-26T14:30:00.000Z",
    "staleAt": "2026-08-26T20:30:00.000Z",
    "refreshJobs": [],
    "enrichment": {
      "complete": true,
      "pendingSlugs": [],
      "failedSlugs": []
    }
  }
}
```

## Job endpoints

### Get job status

```http
GET /api/v1/jobs/{jobId}
```

#### Path parameters

| Parameter | Type | Rules |
| --- | --- | --- |
| `jobId` | UUID string | A job UUID returned in `meta.jobs` or `meta.refreshJobs`. |

#### Request body and query parameters

None.

#### `200` response shape

Unlike resource endpoints, this response does not contain cache metadata.

```jsonc
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001",
    "type": "watchlist",
    "resourceKey": "watchlist:alice",
    "status": "running",
    "attempts": 1,
    "statusUrl": "/api/v1/jobs/00000000-0000-4000-8000-000000000001",
    "createdAt": "2026-08-26T14:30:00.000Z",
    "startedAt": "2026-08-26T14:30:02.000Z",
    "finishedAt": null,
    "error": null
  }
}
```

Stop polling when `status` becomes `succeeded`, `partial`, or `failed`. A failed
job has a non-null `error` containing a `JobFailureCode` and sanitized message.

`partial` means the job saved data but Letterboxd blocked part of the scrape,
for example a Cloudflare challenge on `/<user>/films/page/2/`. Treat it as
finished: the resource now returns `200` with `complete: false`. Its `error`
has code `upstream_blocked` and a message naming the blocked URL and how many
films were merged, for example:

```json
{
  "code": "upstream_blocked",
  "message": "Letterboxd challenged https://letterboxd.com/alice/films/page/2/; merged 115 films (72 from 1 page and 50 from the diary feed) into the stored watched list. Older entries were left as they were."
}
```

### Manually request a job

```http
POST /api/v1/jobs
Authorization: Bearer {MANUAL_JOB_API_KEY}
Content-Type: application/json
```

This is an administrative endpoint. Do not embed the bearer token in a browser
bundle, mobile binary, public repository, or other untrusted client. Consumer
apps generally do not need this endpoint because resource GETs automatically
request required cache-miss and stale-refresh jobs.

#### JSON request body

```ts
interface ManualJobRequest {
  type: JobType
  identifier: string
}
```

| `type` | Required `identifier` shape | Example |
| --- | --- | --- |
| `profile` | Bare Letterboxd username | `alice` |
| `watchlist` | Bare Letterboxd username | `alice` |
| `watched` | Bare Letterboxd username | `alice` |
| `network` | Bare Letterboxd username | `alice` |
| `movie` | Letterboxd slug or canonical `tmdb_<id>` | `interstellar` or `tmdb_157336` |
| `movie_metadata` | Canonical `tmdb_<id>` | `tmdb_157336` |

Identifiers are trimmed and lowercased. Do not pass a URL or `@username`.

```bash
curl --request POST "{BASE_URL}/api/v1/jobs" \
  --header "Authorization: Bearer {MANUAL_JOB_API_KEY}" \
  --header "Content-Type: application/json" \
  --data '{"type":"watched","identifier":"alice"}'
```

#### Response

A successfully requested or deduplicated job uses the standard `202 Accepted`
envelope with `data: null` and `meta.jobs`. The endpoint can return the standard
error envelope, including `401 unauthorized`.

## Recommended client workflow

The key integration requirement is to poll all jobs returned by `202`, then
retry the original resource URL. Stale `200` data should normally be used
immediately without waiting for `meta.refreshJobs`.

```ts
type ApiErrorBody = {
  error: { code: string; message: string }
}

async function fetchWatchboxdResource<T>(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const resourceUrl = new URL(path, baseUrl)

  for (;;) {
    const response = await fetch(resourceUrl, {
      headers: { Accept: "application/json" },
      signal,
    })
    const body = await response.json()

    if (response.status === 200) {
      return body
    }

    if (response.status !== 202) {
      const error = body as ApiErrorBody
      throw new Error(`${error.error.code}: ${error.error.message}`)
    }

    const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? 2)
    await delay(retryAfterSeconds * 1_000, signal)

    await Promise.all(
      body.meta.jobs.map((job: JobSummary) =>
        pollJob(baseUrl, job.statusUrl, signal),
      ),
    )
    // Retry the original URL; another required job wave is possible.
  }
}

async function pollJob(
  baseUrl: string,
  statusPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const statusUrl = new URL(statusPath, baseUrl)

  for (;;) {
    const response = await fetch(statusUrl, {
      headers: { Accept: "application/json" },
      signal,
    })
    const body = await response.json()

    if (!response.ok) {
      throw new Error(body.error?.message ?? `Job HTTP ${response.status}`)
    }
    if (body.data.status === "succeeded" || body.data.status === "partial") return
    if (body.data.status === "failed") {
      throw new Error(
        `${body.data.error?.code ?? "unknown"}: ${
          body.data.error?.message ?? "Job failed"
        }`,
      )
    }

    await delay(2_000, signal)
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
```

Production clients should add an overall timeout, capped retry backoff, and
request cancellation. The repository's browser client uses a five-minute
overall timeout and caps polling intervals at ten seconds.

## CORS and preflight

All v1 routes support `OPTIONS`.

- Read routes advertise `GET, OPTIONS`.
- `/jobs` advertises `POST, OPTIONS`.
- Allowed request headers are `Authorization, Content-Type`.
- Preflight responses use `204 No Content` and
  `Access-Control-Max-Age: 86400`.
- `Access-Control-Allow-Origin` is returned only when the request's `Origin`
  is configured by the deployment, or the deployment allows `*`.

Server-to-server callers are not subject to browser CORS enforcement. Browser
integrators must ask the Watchboxd deployment owner to add their exact origin
to `API_ALLOWED_ORIGINS`.
