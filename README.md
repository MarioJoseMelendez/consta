# Consta

**From records to connections.**

Consta is a research tool that maps the people and companies around a subject
from public records, with cited evidence and an explicit separation between
corroborated facts, probable claims and absences.

Live demo: **https://consta.kahuna.li**

The product today is the **identity workspace**: you type a name, the backend
plans searches across public sources (Tavily, Wikidata) plus a shared store of
earlier investigations (`bd`), resolves the subject into a candidate profile,
and then runs a connection loop that builds a web of claims — each one scored,
corroborated and linked back to its original sources.

## Architecture

```text
frontend/            Next.js App Router, static export → Cloudflare Pages
backend/             Hono + Cloudflare Workers: identity API, shared store, images
packages/contracts/  Shared TypeScript types and demo data
backendGTData/       INACTIVE — GT data channel, kept as a dead repo for now
```

Flow:

```text
Browser → backend (consta-api)
              ├─ Tavily / Wikidata search
              ├─ bd: shared research base (D1 + FTS5)
              └─ occupation pixel art (cached in D1)
          ↓
     candidate profile + claims web + evidence
```

- `backend` is the only live service. It never exposes provider keys to the
  browser; the frontend only talks to the Worker.
- Models: Llama 3.2 90B on NVIDIA is the primary model; then other free NVIDIA
  models; then free OpenRouter models, restricted to text LLMs.
- `bd` is a tool the model may choose — not a source. It returns saved claims
  with their corroboration level and original sources, and the backend expands
  those references when citing them.
- `frontend` is a static export of Next.js. In production it points at the
  Worker URL with `NEXT_PUBLIC_API_URL`.
- `backendGTData` is not used. Its code and docs remain for reference only.

## Getting started

Requirements: Node.js >= 20.9 and pnpm 12.

```bash
pnpm install
pnpm dev:api     # backend on http://localhost:8787
pnpm dev:web     # frontend on http://localhost:3000
```

Copy `backend/.dev.vars.example` to `backend/.dev.vars` and fill in
`TAVILY_API_KEY` plus at least one model key (`OPENROUTER_API_KEY`, with
`NVIDIA_API_KEY` as fallback). Without them the identity endpoints answer
`missing_api_key`.

### Backend routes

| Method | Route | Use |
| --- | --- | --- |
| `GET` | `/health` | Service status |
| `GET` | `/manifest` | Analyzer manifest |
| `POST` | `/identity/investigate` | Plan, search rounds and candidate profiles for a name |
| `POST` | `/identity/more` | Up to two extra targeted searches |
| `POST` | `/identity/connections` | One turn of the connection loop |
| `POST` | `/identity/analysis` | Persist an investigation to the shared store (idempotent) |
| `GET` | `/occupation-image?name=` | Pixel art portrait for an occupation, cached in D1 |
| `GET` | `/search?q=`, `/entities/:id`, `/tools/*`, `/analyze` | Demo workspace routes (fictitious data) |

Details, examples and environment variables: [`backend/README.md`](backend/README.md).

### Frontend

Two-click flow: investigate a subject, confirm a candidate, then open the
connection loop. The claims web renders people and organizations with their
relationship threads, a "BD" badge marks claims reused from the shared store,
and occupation pixel art fills the photo boxes with initials as fallback.
Details: [`frontend/README.md`](frontend/README.md).

## Shared store and images

- D1 database `consta` (SQLite + FTS5). Migrations live in
  `backend/migrations/`; apply locally with
  `pnpm --filter @consta/backend exec wrangler d1 migrations apply consta --local`
  and remotely with `--remote` before serving traffic.
- `POST /identity/analysis` is idempotent per content hash: retrying the same
  investigation updates the row instead of duplicating it. Claims without
  sources are not saved.
- Occupation portraits are pixel art generated with reAPI's `muse-image` and
  cached in D1. The prompt asks for detailed 32-bit pixel art with hand-placed
  square pixels, a limited palette and no aliasing. The frontend opens an SSE
  stream that paints the `persona`/`empresa` template immediately, then swaps
  to the portrait when a D1 match appears or the ReAPI task finishes. Compound
  occupations ("Doctor, politician and entrepreneur") reuse the first role
  already stored; only when nothing matches does the backend submit a
  generation for the primary role. The task id is persisted, so a later
  request resumes the same task instead of paying for a second image; there is
  one retry at most. Set `REAPI_KEY` and keep `IMAGE_PROVIDER=reapi`,
  `IMAGE_MODEL=muse-image`; `IMAGE_PROVIDER=mock` renders the local
  deterministic SVG.

## Deploy

```bash
pnpm typecheck
pnpm build

# Frontend → Cloudflare Pages (out/)
pnpm --filter @consta/frontend build

# Backend → Cloudflare Workers (consta-api)
pnpm deploy:api
```

- Backend secrets go in with `pnpm --filter @consta/backend run secrets`
  (`wrangler secret put`) or the dashboard; non-secret vars live in
  `backend/wrangler.jsonc`.
- Pages needs `NEXT_PUBLIC_API_URL` pointing at the Worker, and the Worker's
  `CORS_ORIGINS` must include the frontend origin.

## License

Code: [AGPL-3.0-only](LICENSE). Demo data is fictitious and not covered by the
licenses of real sources. Each piece of evidence keeps the license of its own
source.
