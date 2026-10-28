# Consta

**Del registro a la conexión.**

Consta es una herramienta de investigación que conecta entidades, empresas y
personas a partir de registros públicos, con evidencia citada y separación
explícita entre hechos, probabilidades y ausencias.

GT-first e internacionalizable: el país se modela como un `CountryPack` con
`SourceAdapter`s, esquemas de identificadores y locales. Los canales de datos son
endpoints HTTP remotos que el analyzer consume **server-side**; el navegador
nunca habla directo con las fuentes.

> **Modo demo.** Las entidades, vínculos, montos y expedientes que se ven hoy son
> ficticios. No describen personas, empresas ni contratos reales. Cada respuesta
> del backend y del canal GT lo declara en headers y en los datos.

## Arquitectura

```text
frontend/        Next.js App Router, static export → Cloudflare Pages
backend/         Analyzer Hono + Workers: API para el frontend, grafo y expediente
backendGTData/   Channel GT: RGAE, Guatecompras OCDS y Wikidata → D1/R2
packages/contracts/  Tipos compartidos y datos demo ficticios
```

Flujo:

```text
Navegador → backend (analyzer) → backendGTData (Channel GT) → snapshot D1
                    ↓
              grafo + claims + evidencia
```

- `backendGTData` es snapshot-first: el request path solo lee D1/R2. No scrapea,
  no descarga y no ejecuta browser automation.
- `backend` puede consumir el Channel GT con `GT_DATA_URL`. Si el canal no
  responde, usa el bundle demo local para no romper el workspace.
- `frontend` es un static export de Next.js. En producción apunta a la URL del
  analyzer con `NEXT_PUBLIC_API_URL`.

## Arranque

Requisitos: Node.js >= 20.9 y pnpm 12.

```bash
pnpm install
pnpm dev
```

Servicios:

| Servicio | URL | Comando |
| --- | --- | --- |
| Frontend | http://localhost:3000 | `pnpm dev:web` |
| Analyzer | http://localhost:8787 | `pnpm dev:api` |
| Channel GT | http://localhost:8788 | `pnpm dev:gt` |

Para que el analyzer consuma el Channel GT en local:

```bash
cp backend/.dev.vars.example backend/.dev.vars
# backend/.dev.vars
GT_DATA_URL=http://localhost:8788
```

Sin `GT_DATA_URL`, el analyzer usa los datos demo locales. Si el canal está
configurado pero no responde, el analyzer hace fallback al bundle demo local y
expone `X-Consta-Fallback: local-demo`.

### Rutas del analyzer

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/health` | Estado del servicio |
| `GET` | `/manifest` | Manifest del analyzer |
| `GET` | `/search?q=` | Búsqueda para el frontend |
| `GET` | `/entities/:id` | Bundle de entidad para el frontend |
| `GET` | `/tools/search_entities?q=` | Tool channel/v1 |
| `GET` | `/tools/get_entity?id=` | Tool channel/v1 |
| `GET` | `/tools/get_relationships?id=` | Tool channel/v1 |
| `GET` | `/tools/get_evidence?ids=` | Tool channel/v1 |
| `GET` | `/tools/get_document?id=` | Metadata registrada; no acepta URLs |
| `POST` | `/analyze` | Grafo, claims y expediente |

Ejemplo:

```bash
curl "http://localhost:8787/search?q=Aurora"
curl "http://localhost:8787/entities/gt-nit%3A90000025"
curl -X POST "http://localhost:8787/analyze" \
  -H "Content-Type: application/json" \
  -d '{"entityId":"gt-nit:90000025","depth":1}'
```

### Rutas del Channel GT

```text
GET /manifest
GET /health
GET /tools/search_entities?q=&limit=
GET /tools/get_entity?id=
GET /tools/get_relationships?id=
GET /tools/get_evidence?ids=
GET /tools/get_document?id=
```

El contrato completo está en `packages/contracts/src/types.ts`.

## Datos y licencias

| Fuente | Licencia | `commercial_ok` | ShareAlike |
| --- | --- | --- | --- |
| RGAE proveedores | CC BY-SA 4.0* | Sí | Sí |
| RGAE representantes | CC BY-SA 4.0* | Sí | Sí |
| Guatecompras OCDS | CC BY 4.0 | Sí | No |
| Wikidata | CC0 | Sí | No |

\* El metadata del dataset de RGAE indica “No se ha provisto de una licencia”;
el footer del portal declara CC BY-SA 4.0. Consta adopta CC BY-SA 4.0 y registra
la discrepancia en el manifest y en `/health`. Cada evidencia conserva su propia
licencia y su `retrievedAt`; la base mixta no se presenta como una licencia única.

El código de Consta es **AGPL-3.0-only**. Cada Channel mantiene su propia
licencia de datos y muestra `commercial_ok`. Los datos de demostración son
ficticios y no están cubiertos por las licencias de las fuentes reales.

El detalle de descarga, checksums, cadencia y carga D1 está en
`backendGTData/docs/SNAPSHOT.md`.

## Build y deploy

```bash
pnpm typecheck
pnpm build

# Frontend → Cloudflare Pages (out/)
pnpm --filter @consta/frontend build

# Analyzer y Channel GT → Cloudflare Workers
pnpm deploy:api
pnpm deploy:gt
```

El frontend usa `output: "export"`, `trailingSlash: true` e imágenes sin
optimización. En Pages configura `NEXT_PUBLIC_API_URL` con la URL pública del
analyzer. En el analyzer configura `GT_DATA_URL` con la URL pública del Channel
GT y `CORS_ORIGINS` con el dominio del frontend.

Los bindings D1/R2 están comentados en ambos `wrangler.jsonc` hasta que exista
un snapshot cargado. Ver `backendGTData/README.md` para el proceso.

## Estado

- [x] Monorepo y contratos compartidos.
- [x] Analyzer Hono con búsqueda, bundle, grafo, claims y expediente.
- [x] Channel GT con contrato `channel/v1`, modo demo y adapters puros.
- [x] Frontend Next.js con landing, workspace y registro de canales.
- [x] Fallback demo y consumo opcional del Channel GT.
- [ ] Snapshot real de RGAE/OCDS cargado en D1 (RGAE requiere descarga manual).
- [ ] Ingesta programada, checksums y R2.
- [ ] Auth, rate limiting y revisión legal de ShareAlike.
- [ ] Dossier asistido por el modelo del evento.

## Licencia

Código: [AGPL-3.0-only](LICENSE). Datos: la licencia de cada fuente, visible en
cada evidencia y en el manifest del Channel.
