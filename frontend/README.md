# Consta — frontend

Editorial interface for Consta's identity research. The workspace shows the
investigated subject, the web of claims around them and every source, keeping
corroboration explicit.

> **Demo note.** The default workspace entities (the old GT demo) are
> fictitious and marked with a **DEMO** tag. The identity screen
> (`/workspace`) talks to the real backend.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript.
- Static export (`output: "export"`) for Cloudflare Pages.
- Hand-written CSS in `app/globals.css`; no Tailwind, UI kits, icon sets or
  chart libraries.
- `@consta/contracts` for shared types.

## Requirements

- Node.js >= 20.9.
- pnpm, working from the Consta monorepo (install from the repo root).

## Commands

From `frontend/`:

```bash
pnpm dev        # dev server (pass --port 3001 to match CORS setups that need it)
pnpm build      # static build; generates out/
pnpm typecheck  # type check
pnpm test       # connectionTable + occupationImage tests
```

To preview the exported build locally:

```bash
npx serve out
```

There is no Next server in production: the result is a folder of static files.

## Routes

| Route | Content |
| --- | --- |
| `/` | Editorial landing. |
| `/workspace` | Identity research: form, candidate cards, claims web, connection threads, evidence. Accepts `?q=` and `?id=`. |
| `/channels` | Legacy demo channel registry (fictitious data). |
| `404` | Error page. |

## Identity workspace flow

1. The form posts to `POST /identity/investigate` (`NEXT_PUBLIC_API_URL` base)
   with name, details and interest. The plan streams first; rounds and
   candidates follow.
2. Confirming a candidate starts the connection loop:
   `POST /identity/connections` runs one turn per request and the frontend
   chains turns while `canContinue` is `true`. Clicking a branch deepens that
   specific entity via `branchContext`.
3. When the loop finishes (or a branch is saved), the frontend posts the whole
   investigation to `POST /identity/analysis`, which persists it to the shared
   store. Retrying the same investigation is idempotent.
4. Claims reused from the shared store are marked with a small **BD** badge;
   their evidence links point to the original sources the backend expanded.
5. Photo boxes show occupation pixel art from `GET /occupation-image`; if
   there is no occupation or the image fails, initials are rendered instead.

## API

`NEXT_PUBLIC_API_URL` defines the base. Default: `http://localhost:8787`.

| Operation | Route |
| --- | --- |
| Investigate | `POST /identity/investigate` |
| More searches | `POST /identity/more` |
| Connection turn | `POST /identity/connections` |
| Save analysis | `POST /identity/analysis` |
| Occupation image | `GET /occupation-image?name=...` |
| Legacy demo search / entity / analyze | `GET /search?q=`, `GET /entities/:id`, `POST /analyze` |

The backend must allow CORS from the frontend origin. Because it is
`NEXT_PUBLIC_*`, the URL is baked at build time.

## Environment variables

Copy `.env.example` to `.env.local` to point somewhere else:

```bash
NEXT_PUBLIC_API_URL=https://consta-api.example.workers.dev
```

Without the variable the client uses `http://localhost:8787`.

## Deploy on Cloudflare Pages

Suggested settings for the monorepo:

- **Root directory:** repo root.
- **Build command:** `pnpm --filter @consta/frontend build`
- **Build output directory:** `frontend/out`
- **Node version:** 20.9 or higher.
- **Environment variable:** `NEXT_PUBLIC_API_URL` with the Worker's HTTPS URL.

Notes:

- No Next server, ISR or dynamic server routes.
- `trailingSlash: true` publishes `/workspace/` and the generated `404.html`.
- Images are unoptimized (`images.unoptimized`) because there is no Next
  runtime.

## Visual system

- Ink `#0b0f0e`, paper `#f3efe4`, lime `#d8ff3e`, orange `#ff6b3d`.
- Serif display type, system text, monospaced metadata.
- Thin borders, background grid, paper cards, dossier-like composition.
- Breakpoints live in `app/globals.css`; the claims web adapts to narrow
  screens and everything respects `prefers-reduced-motion`.

## Accessibility

- Skip link, landmarks and heading hierarchy.
- Keyboard navigation on graphs (Enter/Space over nodes) with visible focus.
- Identity and confidence states never rely on color alone: they carry labels.
- The search button keeps an accessible name when its text is hidden on mobile.

## Structure

```text
frontend/
├─ app/
│  ├─ workspace/page.tsx     # identity research screen
│  ├─ channels/page.tsx      # legacy demo registry
│  ├─ layout.tsx, globals.css, page.tsx (landing), not-found.tsx
├─ components/
│  ├─ identity/              # IdentityProvider, IdentityPanel, IdentityProfile,
│  │                         # ClaimsWeb, IdentityForm, connectionTable
│  ├─ workspace/Workspace.tsx
│  └─ ...                    # Graph, Dossier, EvidenceList, Header, etc.
├─ lib/
│  ├─ api.ts                 # client, timeouts, fallback
│  ├─ identity.ts            # identity client: investigate, connections, save,
│  │                         # occupation image URL
│  ├─ model.ts               # demo view, graph and derived claims
│  └─ format.ts
├─ test/                     # node --test suites
├─ public/favicon.svg
├─ next.config.ts
└─ README.md
```

## Known limits

- No authentication and no server-side persistence in this package; the
  shared store lives behind the backend.
- The legacy demo search is a fictitious five-entity subset.
- Evidence links point to original sources; the backend drops any URL that did
  not come from a real search.
