# Consta API (`@consta/backend`)

HTTP API for Consta's identity research, built with TypeScript,
[Hono](https://hono.dev/) and Cloudflare Workers.

> **Demo routes.** The entity, relationship, evidence and analysis routes that
> power the old demo workspace return fictitious data and send the
> `X-Consta-Demo: true` header. The identity routes
> (`/identity/*`, `/occupation-image`) are different: they search real public
> sources and never send that header.

## Stack

- TypeScript (strict, no emit; Wrangler bundles).
- Hono.
- Cloudflare Workers + Wrangler + D1.
- Shared contracts from `@consta/contracts`.

## Commands

From the repo root:

```bash
pnpm install          # install the workspace
pnpm dev:api          # API on http://localhost:8787
pnpm typecheck        # tsc --noEmit in every package
pnpm build            # build every package
pnpm deploy:api       # wrangler deploy (needs a Cloudflare session)
```

Inside the package:

```bash
pnpm --filter @consta/backend dev        # wrangler dev
pnpm --filter @consta/backend test      # node --test
pnpm --filter @consta/backend typecheck
pnpm --filter @consta/backend build     # wrangler deploy --dry-run --outdir dist
pnpm --filter @consta/backend deploy
pnpm --filter @consta/backend run secrets  # node scripts/secret-bulk.mjs
```

`test` runs the native Node runner over `backend/test/*`. It needs no network:
the `test/register.mjs` loader resolves extensionless relative imports to
`.ts` via `--experimental-strip-types`. `wrangler dev` loads variables from
`.dev.vars`; use `.dev.vars.example` as the template.

## Routes

| Method | Route | Response |
| --- | --- | --- |
| `GET` | `/` | Service info and links to `/manifest` and `/health`. |
| `GET` | `/manifest` | Analyzer descriptor (`contract: "analyzer/v1"`). |
| `GET` | `/health` | `{ ok, service, environment, time }`. |
| `POST` | `/identity/investigate` | Identity investigation: `{ name, details?, interest? }` → `{ plan, rounds, candidates }`. |
| `POST` | `/identity/more` | Up to two extra targeted searches over an existing investigation. |
| `POST` | `/identity/connections` | One turn of the connection loop: `{ name, details?, interest?, investigation, candidateId, connection?, branchContext? }` → `{ claims, rounds, summary, canContinue, stoppedReason }`. |
| `POST` | `/identity/analysis` | Persists an investigation to D1. Idempotent per content hash → `{ id, created, claims, entities }`. |
| `GET` | `/occupation-image?name=` | Pixel art portrait for an occupation or the `persona`/`empresa` placeholder. `kind=person|enterprise`, `meta=1` for status. |
| `GET` | `/tools/search_entities?q=` | `SearchResponse` with demo entities. |
| `GET` | `/search?q=` | Frontend alias of `/tools/search_entities`. |
| `GET` | `/entities/:id` (and `/entity/:id`, `/tools/get_entity?id=`) | Demo `EntityBundle`. `404` if missing. |
| `GET` | `/tools/get_relationships?id=` | Demo relationships + evidence. |
| `GET` | `/tools/get_evidence?ids=a,b` | `{ items: Evidence[] }`. |
| `GET` | `/tools/get_document?id=` | Demo evidence metadata. No downloads. |
| `POST` | `/analyze` | Demo analysis run over a demo entity. |

### Example

```bash
curl "http://localhost:8787/health"

curl -X POST "http://localhost:8787/identity/investigate" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sam Altman","details":"OpenAI","interest":"funding and politics"}'

curl -X POST "http://localhost:8787/identity/connections" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sam Altman","investigation":{...},"candidateId":"c1","branchContext":{"entityId":"ent1","claimId":"clm1","label":"branch"}}'
```

## Errors

Every error uses the contract's `ApiError` shape:

```json
{
  "error": {
    "code": "entity_not_found",
    "message": "There is no demo entity with id \"gt-nit:000\"."
  }
}
```

Codes: `missing_parameter`, `invalid_parameter`, `invalid_json`, `invalid_body`,
`entity_not_found`, `document_not_found`, `not_found`, `invalid_plan`,
`invalid_model_json`, `candidate_not_found`, `internal_error` (with
`retryable: true`). Identity endpoints can also forward provider codes such as
`missing_api_key`.

## Identity

`POST /identity/investigate` resolves candidates from a name, an optional
description (`details`, up to 2000 chars) and an optional research interest
(`interest`, up to 1000 chars). The interest is the journalist's focus, not
evidence; when it is missing the connection loop falls back to public interest
(parties, funding, associated companies, external support).

The flow:

1. **Plan.** One model call builds the search plan (it does not count as a
   round). The model gets the tool dictionary — `wikidata`, `tavily` and `bd` —
   and the 15 field definitions. The first wave only tries to tell whether the
   name is a person or a company.
2. **Rounds.** Up to three rounds. Each query runs on the chosen tool only; an
   unknown tool runs on both. Once the type is known, person queries go to news
   (occupation, aliases, date of birth, nationality) and company queries to
   public records (tax ID, legal name, address, site, phone, representative,
   incorporation).
3. **Candidates.** The model updates the candidates from the numbered search
   results. If it returns none but the searches did name the subject, the
   response synthesizes one candidate per Wikidata hit (or from Tavily pages
   that cite the name). Remaining fields stay `not_found`.

The response is `{ plan, rounds, candidates }`. Each candidate carries the 15
contract fields in `IDENTITY_FIELD_DEFINITIONS` order, each with `value`,
`status` (`found`, `not_found`, `conflicting`, `alleged`), optional `note`,
`score`, `confidence` and `sources[]` (`source`, `title`, `url`). After the
candidates are built, `scoreResults` makes a single scoring call: primary /
secondary / tertiary source, official or not, and how many independent sources
repeat the value. Score runs 1–100: 1–50 uncertain (hidden), 51–79 probable,
80–100 corroborated. A URL that did not come from the searches is discarded;
a value left without sources becomes `not_found` with `value: null`.

One strong source reaches `probable`, but a single source never passes 79, so
`corroborated` requires at least two independent origins. An origin is not a
host: two articles from the same outlet count once, and syndicated copies with
the same normalized headline or ≥0.92 token overlap do not corroborate either.
`scoreResults` never rewards repetition within one outlet or one domain.

If the plan fails, the response is a 502 `ApiError`. If a later round fails
with plan or searches already accumulated, the 502 body carries that partial
state plus `error`. Model JSON gets one repair pass; if it still does not
parse, the error is `invalid_model_json`. Values that arrive as "null",
"none", "n/a" and similar tokens are treated as empty.

### Connections

`POST /identity/connections` runs **one turn** per request so it never hits the
300 s Worker timeout; the frontend chains turns while `canContinue` is `true`.
There are three beats in the same loop, not a third product phase:

1. **Turn 1** — first degree only: people and organizations directly linked to
   the subject.
2. **Turn 2** — one more hop from those identities. Chains that do not close
   against the subject stay as open branches (concrete names).
3. **Turn 3** — only if open branches exist: cross each branch name with the
   subject. If turn 2 left no names to cross, `canContinue` is `false` and the
   third turn is never paid (`stoppedReason` says so).

Turns also stop early when no new claims appear. An optional `branchContext`
(`entityId`, `claimId`, `label`) skips the automatic timing: every query starts
from the chosen identity or claim and looks for public-interest connections,
including any direct link back to the subject.

Each turn, in order:

1. **Plan.** 1–5 queries in the `{ query, purpose, tool }` format. Repeats of a
   previous `queryKey` are dropped.
2. **Searches.** Run with the same engine as the investigation. Without
   results the turn stops with `stoppedReason: "no results"`.
3. **Entity identification mini-step.** One model call picks up to five
   institutions, companies and public figures from the numbered results. It
   cannot invent: every name must appear in some result (checked with
   `mentionsName`), and the queried subject plus already-resolved entities are
   dropped. Each entity gets one resolution pass. If the mini-step's JSON is
   invalid, the model is retried once with a strict reminder, then a
   heuristic fallback extracts proper names from the results so the turn is
   not lost; the claim step still validates every entity against the text, so
   fallback noise cannot reach the map.
4. **Reasoning.** Another call turns the numbered sources into claims
   `{ text, parentText, entities, sources, confidence }`. Source indexes are
   converted into links; a claim with no valid sources is discarded.
   `parentText` is resolved against accumulated claims to build the thread.
5. **Entity cards.** Cards are filled from what the mini-step already found;
   the subject's own card stays in the panel. No per-entity scoring call.

The response is `{ claims, rounds, summary, canContinue, stoppedReason }`.
The frontend groups all claims linking the same pair into one thread; clicking
opens a table with text, sources and confidence.

## Shared store (`bd`)

`bd` is one more tool the model may pick in plans, candidates and connections.
It is not a source: it searches D1 (FTS5) for previously saved claims and
returns each with text, corroboration level, score and original sources. When
the model cites a `bd` result, the backend expands it to those original
sources; a `bd` link is never stored or shown as evidence.

`POST /identity/analysis` saves the subject, its connections and claims. The
content hash makes retries update the existing row instead of duplicating it.
Claims without sources are not saved. The store is global and shared, with no
auth or viewer yet.

```bash
pnpm --filter @consta/backend exec wrangler d1 migrations apply consta --local   # dev
pnpm --filter @consta/backend exec wrangler d1 migrations apply consta --remote  # production
```

The FTS5 table (`search_fts`) is filled on every save; if FTS fails, `bd`
falls back to a `LIKE` search.

## Occupation images

Images never block identity or connections. `GET /occupation-image` answers
immediately from cache and only generates when nothing is stored.

- Generation uses **reAPI** (`https://reapi.ai/api/v1`) with `muse-image`.
  The prompt asks for detailed 32-bit pixel art: hand-placed square pixels,
  1:1, limited palette (`#1C1C1E` ink, `#EEF3EA` mint, `#248A3D` green), no
  anti-aliasing, no photorealism, no text or logos.
- reAPI is asynchronous: POST returns a task id, then the backend polls
  `GET /tasks/{id}`, downloads the WebP and stores the bytes in
  `occupation_images`. The task id also lives in `occupation_tasks`, so a later
  request resumes the same task instead of submitting (and paying) again.
- There are at most two submissions per occupation: the initial one and a
  single retry. After that the `persona` placeholder is saved under that key
  and the model is not called again.
- Two placeholders live in `occupation_images`: `persona` (generic portrait)
  and `empresa` (building). Companies and agencies never receive a generated
  portrait.
- Compound occupations ("Doctor, politician and entrepreneur") are split into
  roles; the endpoint reuses the first role already cached. Only when nothing
  matches does it generate the primary role and store it under that key, so
  other investigations can reuse it.
- `IMAGE_PROVIDER=mock` renders the local deterministic SVG instead (no
  network, no credits). `openrouter` and `nvidia` are legacy image paths.

## CORS

Explicitly allowed:

- `http://localhost:3000` (local frontend; add other ports to `CORS_ORIGINS`).
- Any `https://*.pages.dev` origin.
- Extra origins from `CORS_ORIGINS` (comma separated).

Methods: `GET`, `POST`, `OPTIONS`. Allowed headers: `Content-Type`,
`Authorization`. The `X-Consta-Demo` response header is exposed. No
credentials.

## Model and search helpers

`src/generalFuncs.ts` exposes two fixed searches. Neither throws; both return
`{ ok, source, query, items, retrievedAt, error? }`:

| Function | Source | Key |
| --- | --- | --- |
| `searchWikidata(env, query, options?)` | Wikidata `wbsearchentities` | none |
| `searchTavily(env, query, options?)` | Tavily Search + content | `TAVILY_API_KEY` |

Each item carries `title` and `url`. Wikidata adds `id` (QID), `snippet` and
`license: "CC0-1.0"`. Tavily adds `snippet`, `content` (full page Markdown),
`score` and `publishedDate`. Options: `limit`, `language` (Wikidata only),
`timeoutMs`; Tavily also `searchDepth`, `includeRawContent`, `timeRange` and
`topic`. Default timeout is 10 s. Without a key, `searchTavily` returns
`missing_api_key`. Wikidata retries 429/5xx/timeout twice.

### `callOpenRouter`

`callOpenRouter(env, messages, options?)` tries models in this order:

1. **NVIDIA NIM, Llama first.** The primary model is
   `meta/llama-3.2-90b-vision-instruct`, the best Llama exposed by the free
   NVIDIA account (the larger Nemotron Ultra/70B ids return 404 there).
   `NVIDIA_MODEL`, when set and Llama-based, is tried before it.
2. **Other free NVIDIA models** (`nemotron-3.5-lightning`, then `bolt`).
3. **OpenRouter free models**, filtered to text LLMs only: embeddings,
   rerankers, guards, speech and image models are excluded, and a reply
   without text is skipped.

On OpenRouter, if `/models` responds it filters by `:free` and `text` output;
else it uses a fallback list. It retries 429, 5xx, timeouts, network errors and
empty replies before moving to the next model. The result reports which
provider served the call; attempts are listed with provider, model and error
code. A 401 stops that provider; a 403 naming a specific model skips it. A
model that times out or returns 5xx is skipped for five minutes, so a slow
primary does not pay its timeout on every call of the same investigation.

Returns `{ ok, text, model, usage?, attempts, error? }`. Never throws.

Options: `models`, `temperature`, `maxTokens`, `timeoutMs`, `retries`,
`retryDelayMs`.

## Environment variables

| Variable | Use | Default |
| --- | --- | --- |
| `ENVIRONMENT` | `environment` value in `/health`. | `development` locally; `demo` in `wrangler.jsonc`. |
| `CORS_ORIGINS` | Extra allowed origins, comma separated. | Empty. |
| `TAVILY_API_KEY` | Tavily key (server side). | Empty: `searchTavily` returns `missing_api_key`. |
| `TAVILY_BASE_URL` | Tavily base. | `https://api.tavily.com`. |
| `TAVILY_SEARCH_DEPTH` | `basic`, `advanced`, `fast` or `ultra-fast`. | `basic`. |
| `TAVILY_INCLUDE_RAW_CONTENT` | Request full page content. | `true`. |
| `WIKIDATA_API_URL` | Wikidata API endpoint. | `https://www.wikidata.org/w/api.php`. |
| `WIKIDATA_LANGUAGE` | Wikidata search language. | `es`. |
| `OPENROUTER_API_KEY` | OpenRouter key (server side). | Empty: `callOpenRouter` returns `missing_api_key`. |
| `OPENROUTER_BASE_URL` | OpenRouter base. | `https://openrouter.ai/api/v1`. |
| `OPENROUTER_MODEL` | Preferred model; tried first. | Empty. |
| `OPENROUTER_MODELS` | Comma-separated list; replaces discovery. | Empty. |
| `OPENROUTER_SITE_URL` | `HTTP-Referer` for OpenRouter. | Empty. |
| `OPENROUTER_APP_NAME` | `X-Title` for OpenRouter. | Empty. |
| `NVIDIA_API_KEY` | NVIDIA NIM key. Primary model chain (Llama first). | Empty: no NVIDIA path. |
| `NVIDIA_BASE_URL` | NVIDIA NIM base. | `https://integrate.api.nvidia.com/v1`. |
| `NVIDIA_MODEL` | Preferred NVIDIA model; Llama ids go first. | Empty: Llama 3.2 90B. |
| `REAPI_KEY` | reAPI key for `muse-image`. | Empty: falls back to `mock` unless `IMAGE_PROVIDER` is set. |
| `REAPI_BASE_URL` | reAPI base. | `https://reapi.ai/api/v1`. |
| `DB` | D1 binding for the shared store, image cache and tasks. | Set in `wrangler.jsonc`. |
| `IMAGE_PROVIDER` | `reapi`, `mock` or legacy `openrouter`/`nvidia`. | `reapi` when `REAPI_KEY` exists, else `mock`. |
| `IMAGE_MODEL` | Image model. | `muse-image`. |
| `GT_DATA_URL` | Unused. The GT data channel is inactive. | Empty. |

Copy `.dev.vars.example` to `.dev.vars` for local development. `.dev.vars` is
git-ignored. For production secrets use
`pnpm --filter @consta/backend run secrets` (wraps `wrangler secret put`) or
the dashboard; public vars belong in `wrangler.jsonc`.

## D1

D1 is wired with binding `DB` (database `consta`) and these migrations:
`backend/migrations/0001_identity_analysis.sql` (analyses, entities, claims,
FTS5, occupation images), `0002_occupation_placeholders.sql` (`persona`,
`empresa` keys) and `0003_occupation_tasks.sql` (resumable ReAPI tasks).
Locally `wrangler dev` stores data in `.wrangler/`. Before serving production
traffic, run the migrations with `--remote`.

The shared store holds names and claims of investigated people. It has no
auth, deletion or viewer yet; a delete endpoint and a privacy note should land
before it is opened.

## Layout

```text
backend/
  .dev.vars.example
  README.md
  package.json
  tsconfig.json
  wrangler.jsonc
  migrations/
    0001_identity_analysis.sql        # analyses, claims, FTS5, occupation images
    0002_occupation_placeholders.sql  # persona and empresa keys
    0003_occupation_tasks.sql         # resumable ReAPI image tasks
  scripts/
    secret-bulk.mjs                   # wrangler secret put wrapper
  src/
    analyze.ts      # demo graph, claims and run
    db.ts           # shared store, bd search, occupation cache (D1)
    occupationImage.ts  # placeholders, generation, pixel art prompt
    generalFuncs.ts # Wikidata + Tavily searches
    sourceScore.ts  # scoring and corroboration
    identity.ts     # investigation, connections, bd tool, prompts
    gt.ts           # legacy GT channel client (inactive)
    index.ts        # Hono app, routes, CORS, validation
  test/             # node --test suites
```
