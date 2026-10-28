# @consta/gt-data

Channel de Guatemala para Consta. Expone `channel/v1` y las tools de entidades,
relaciones, evidencia y documentos desde Cloudflare Workers + Hono.

- **Snapshot-first:** el request path solo lee D1/R2. Nunca scrapea ni descarga.
- **Sin browser automation:** RGAE bloquea requests server-side con 403; la
  descarga es manual/asistida (ver `docs/SNAPSHOT.md`).
- **Modo demo:** sin binding D1 usa los datos ficticios de `@consta/contracts` y
  lo marca en `/health`, en las respuestas de datos (`mode`, `demo`) y en headers
  (`X-Consta-Mode`, `X-Consta-Demo`, `X-Consta-Notice`).
- **Modo d1:** con binding `DB` lee las tablas de `migrations/0001_init.sql`.

## Rutas

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/` | Info del servicio, país, modo y links |
| GET | `/manifest` | `ChannelManifest` channel/v1 para GT |
| GET | `/health` | Estado, modo y fuentes |
| GET | `/tools/search_entities?q=&limit=` | Busca por nombre, alias, NIT/CUI |
| GET | `/tools/get_entity?id=` | `EntityBundle` o 404 |
| GET | `/tools/get_relationships?id=` | Relaciones + evidencia |
| GET | `/tools/get_evidence?ids=a,b` | Evidencia filtrada; sin `ids`, disponible |
| GET | `/tools/get_document?id=` | Metadata registrada; **no acepta `url`** |

Límites: `q` 200 caracteres, `limit` 1–100 (default 20), `id` 200 caracteres,
`ids` hasta 100 por consulta, listado de evidencia sin filtro hasta 200.

## Desarrollo

```bash
pnpm --filter @consta/gt-data dev       # wrangler dev --port 8788
pnpm --filter @consta/gt-data typecheck
pnpm --filter @consta/gt-data build     # dry-run a dist/
```

No ejecutes `pnpm install` desde este paquete; el workspace lo resuelve desde la
raíz.

## Ejemplos curl

```bash
curl "http://localhost:8788/"
curl "http://localhost:8788/manifest"
curl "http://localhost:8788/health"

curl "http://localhost:8788/tools/search_entities?q=nexo&limit=5"
curl "http://localhost:8788/tools/search_entities?q=90000017"

curl "http://localhost:8788/tools/get_entity?id=gt-nit%3A90000017"
curl "http://localhost:8788/tools/get_relationships?id=gt-nit%3A90000017"
curl "http://localhost:8788/tools/get_evidence"
curl "http://localhost:8788/tools/get_evidence?ids=ev-rep-nexo,ev-ocds-nexo"
curl "http://localhost:8788/tools/get_document?id=doc-demo-rgae-prov"
curl "http://localhost:8788/tools/get_document?id=demo-ev-ocds-nexo"
```

Los IDs anteriores son ficticios y solo existen en modo demo. En modo demo la
evidencia sale con prefijo `demo-` (`demo-ev-...`) y las relaciones apuntan a esos
IDs; `ids=` acepta el ID con o sin prefijo. En modo d1 los IDs vienen del snapshot
cargado.

`get_document?url=https://...` responde `400 unsupported_parameter`: el worker no
resuelve URLs arbitrarias (protección SSRF).

## Demo vs D1

### Demo (default, sin binding)

- Datos ficticios de `@consta/contracts` (`demoEntities`, `demoRelationships`,
  `demoEvidence`).
- Manifest `gt.consta.demo`.
- `attributes.demo = true`, títulos con `(DEMO)` / `[DEMO]`, header
  `X-Consta-Demo: true`.
- `/health` devuelve `mode: "demo"` y `sources[].status: "demo"`.

### D1

1. Crear la base:

   ```bash
   pnpm exec wrangler d1 create consta-gt-data
   ```

2. Copiar `database_id` en `wrangler.jsonc`, descomentando el bloque `d1_databases`.
   El binding debe llamarse `DB`.
3. Aplicar la migración:

   ```bash
   pnpm exec wrangler d1 migrations apply consta-gt-data --local
   pnpm exec wrangler d1 migrations apply consta-gt-data --remote
   ```

4. Cargar el snapshot (pipeline externo; ver `docs/SNAPSHOT.md`).
5. Reiniciar `wrangler dev`. Con `DB` presente, `mode` cambia a `d1`.

R2 es opcional. Descomenta `r2_buckets` con binding `EVIDENCE_BUCKET` si vas a
archivar binarios. El worker no descarga ni sirve binarios desde las tools.

## Deploy

```bash
pnpm --filter @consta/gt-data deploy
```

Configura `PUBLIC_BASE_URL` si el manifest debe mostrar una URL distinta al origen
del request. Agrega orígenes extra separados por coma en `CORS_ORIGINS`.

CORS permitido por defecto: `http://localhost:3000`, `http://localhost:8787`,
`http://localhost:8788`, `127.0.0.1` equivalentes y `https://*.pages.dev`.
Métodos: `GET`, `OPTIONS`. Header permitido: `Content-Type`.

## Smoke test

Con el worker corriendo:

```bash
node scripts/smoke.mjs
# o contra otra base:
BASE_URL=http://localhost:8788 node scripts/smoke.mjs
```

El script usa `fetch` nativo de Node (18+) y no tiene dependencias. En modo demo
valida datos; en modo d1 acepta 404 en rutas dependientes de datos.

## Licencias

| Fuente | Licencia | Commercial OK | ShareAlike |
| --- | --- | --- | --- |
| RGAE proveedores | CC BY-SA 4.0* | Sí | Sí |
| RGAE representantes | CC BY-SA 4.0* | Sí | Sí |
| Guatecompras OCDS | CC BY 4.0 | Sí | No |
| Wikidata | CC0 | Sí | No |

\* El metadata del dataset dice “No se ha provisto de una licencia”; el footer del
portal declara CC BY-SA 4.0. Se adopta CC BY-SA 4.0, se anota la discrepancia en el
manifest y en `/health`, y cada evidencia de RGAE lleva esa licencia y su
`retrievedAt`. Ver `docs/SNAPSHOT.md`.

## Qué falta

- Pipeline/CLI de ingesta: descarga asistida, normalización, carga idempotente a D1
  y archivo en R2.
- Merge de entidades entre RGAE, OCDS y Wikidata (hoy los adapters son puros y
  producen stubs/entidades por fuente).
- Búsqueda FTS5 si D1 la soporta (bloque comentado en la migración).
- Rate limiting, auth/API keys, cuotas y monitoreo de Workers.
- Job programado de snapshots y verificación de checksums.
- UI de atribución de licencias y revisión legal de ShareAlike.
- Validación más estricta de CUI/NIT y resolución de homónimos.
- Pruebas automatizadas de adapters y rutas (el smoke es solo de integración).

## Estructura

```
src/
  adapters/   rgae.ts, ocds.ts, wikidata.ts (puros, sin I/O)
  lib/        csv.ts, ids.ts, demo.ts, merge.ts
  db.ts       helpers D1 opcionales
  index.ts    Hono + rutas + CORS + validación
  sources.ts  catálogo de fuentes, licencias y manifest
  types.ts    tipos del worker (Env, DocumentRecord, health)
migrations/   0001_init.sql
docs/         SNAPSHOT.md
scripts/      smoke.mjs
```
