# Consta API (`@consta/backend`)

API HTTP de Consta para investigación de registros públicos, construida con
TypeScript, [Hono](https://hono.dev/) y Cloudflare Workers.

> **Modo demo.** Las entidades, relaciones, evidencias y análisis que devuelven
> las rutas de expediente son ficticios. No representan empresas ni personas
> reales. El manifiesto declara el modo demo y esas respuestas incluyen la
> cabecera `X-Consta-Demo: true`. No uses esos datos como fuente de verdad.
>
> `POST /identity/investigate` es distinto: busca en Tavily y Wikidata y no
> envía `X-Consta-Demo`. Un campo sin URL de esas búsquedas queda en
> `not_found`.

## Stack

- TypeScript (strict, sin emisión; Wrangler hace el bundle).
- Hono.
- Cloudflare Workers + Wrangler.
- Contratos compartidos desde `@consta/contracts` (tipos y datos demo).

## Comandos

Desde la raíz del repo:

```bash
pnpm install          # instala el workspace
pnpm dev:api          # API en http://localhost:8787
pnpm typecheck        # tsc --noEmit en todos los paquetes
pnpm build            # build de todos los paquetes
pnpm deploy:api       # wrangler deploy (requiere sesión de Cloudflare)
```

Directo en el paquete:

```bash
pnpm --filter @consta/backend dev
pnpm --filter @consta/backend typecheck
pnpm --filter @consta/backend build
pnpm --filter @consta/backend deploy
```

`build` ejecuta `wrangler deploy --dry-run --outdir dist`, así que valida el
bundle sin publicar. `wrangler dev` carga variables desde `.dev.vars`; usa
`.dev.vars.example` como plantilla.

## Rutas

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `GET` | `/` | Información del servicio y enlaces a `/manifest` y `/health`. |
| `GET` | `/manifest` | Descriptor del analyzer (`contract: "analyzer/v1"`) con sus canales. |
| `GET` | `/health` | `{ ok, service, environment, time }`. |
| `GET` | `/tools/search_entities?q=` | `SearchResponse` con entidades demo. `q` es opcional; sin `q` devuelve una muestra. |
| `GET` | `/search?q=` | Alias para el frontend; misma respuesta que `/tools/search_entities`. |
| `GET` | `/tools/get_entity?id=` | `EntityBundle` (entidad, relaciones y evidencia). `404` si no existe. |
| `GET` | `/entities/:id` | Alias para el frontend; mismo bundle que `/tools/get_entity`. |
| `GET` | `/entity/:id` | Alias adicional del bundle. |
| `GET` | `/tools/get_relationships?id=` | `{ entityId, relationships, evidence }` de la entidad. `404` si no existe. |
| `GET` | `/tools/get_evidence?ids=a,b` | `{ items: Evidence[] }`. Sin `ids` devuelve toda la evidencia demo. |
| `GET` | `/tools/get_document?id=` | Metadatos `{ id, title, url, license, content_type }` de una evidencia. `404` si no existe. |
| `POST` | `/analyze` | `AnalysisRun` demo. Acepta `{ entityId?, query?, depth? }`. |
| `POST` | `/identity/investigate` | Investigación de identidad. Acepta `{ name, details? }` y devuelve `{ plan, rounds, candidates }`. No lleva `X-Consta-Demo`. |
| `POST` | `/identity/more` | Hasta dos búsquedas extra. Acepta `{ name, details?, investigation }` y busca NIT, teléfono, correo, representante legal, dirección y documento nacional. |

### Ejemplos

```bash
curl "http://localhost:8787/health"
curl "http://localhost:8787/manifest"
curl "http://localhost:8787/tools/search_entities?q=nexo"
curl "http://localhost:8787/tools/get_entity?id=gt-nit%3A90000017"
curl "http://localhost:8787/tools/get_relationships?id=gt-nit%3A90000017"
curl "http://localhost:8787/tools/get_evidence?ids=ev-rep-nexo,ev-ocds-nexo"
curl "http://localhost:8787/tools/get_document?id=ev-ocds-nexo"

curl -X POST "http://localhost:8787/analyze" \
  -H "Content-Type: application/json" \
  -d '{"entityId":"gt-nit:90000017","depth":2}'

curl -X POST "http://localhost:8787/identity/investigate" \
  -H "Content-Type: application/json" \
  -d '{"name":"Banco de Guatemala","details":"banco central"}'
```

Validaciones relevantes:

- `id`, `entityId` y cada valor de `ids` deben ser cadenas no vacías de hasta
  200 caracteres.
- `q` y `query` admiten hasta 200 caracteres.
- `ids` acepta hasta 100 IDs separados por coma; se eliminan duplicados.
- `depth` solo puede ser `1` o `2`.
- `POST /analyze` exige `entityId` o `query`; si se envía `entityId`, debe
  existir en los datos demo.
- `get_document` y los endpoints de entidad devuelven `404` cuando el ID no
  existe.

`get_document` es una vista de metadatos: no descarga bytes. En demo,
`content_type` se deriva del tipo de evidencia (`record` → `application/json`,
`document` → `application/pdf`, `dataset` → `text/csv`).

## Errores

Todos los errores usan la forma `ApiError` del contrato:

```json
{
  "error": {
    "code": "entity_not_found",
    "message": "No existe una entidad demo con id \"gt-nit:000\"."
  }
}
```

Códigos usados: `missing_parameter`, `invalid_parameter`, `invalid_json`,
`invalid_body`, `entity_not_found`, `document_not_found`, `not_found`,
`invalid_plan`, `invalid_model_json` e `internal_error` (este último con
`retryable: true`). La identidad también puede reenviar el código de Tavily u
OpenRouter, por ejemplo `missing_api_key`.

## Identidad

`POST /identity/investigate` resuelve candidatos a partir de un nombre y una
descripción opcional. El cuerpo es `{ "name": "...", "details": "..." }`.
`name` es obligatorio y admite hasta 200 caracteres. `details` es opcional y
admite hasta 2000.

El backend hace, en este orden:

1. Una llamada al modelo arma el plan. Esta llamada no cuenta como ronda. El
   modelo recibe el diccionario de herramientas y el de los 15 campos. La
   primera ola no busca NIT ni cargo: son dos consultas para saber si el
   nombre es persona o empresa. Wikidata recibe el nombre exacto. Tavily
   recibe el mismo nombre en noticieros.
2. Hasta tres rondas. Cada query se busca solo en la herramienta elegida. Si
   la herramienta falta o no es `wikidata` ni `tavily`, esa query se busca en
   ambas y no se descarta. Si el tipo ya es persona, las consultas siguientes
   van a noticieros (cargo, alias, nacimiento, nacionalidad) y el DPI queda
   en un registro. Si es empresa, van a registros públicos (NIT, razón social,
   dirección, sitio, teléfono, representante, constitución). Si el tipo sigue
   sin resolverse, la siguiente consulta solo intenta distinguirlo.
3. El modelo actualiza `candidates`. La ronda siguiente no depende de que
   pida NIT: se arma con el tipo ya encontrado. En la tercera ronda no hay
   otra búsqueda. Un perfil incompleto sigue siendo un candidato: si el
   modelo no devuelve ninguno y las búsquedas nombraron al sujeto, la
   respuesta trae una entidad por cada resultado de Wikidata o, si Wikidata
   no trajo ninguna, un candidato cuyo nombre citan las páginas de Tavily.
   El resto de campos queda en `not_found`.

La respuesta es `{ plan, rounds, candidates }`. Cada candidato trae los 15
campos del contrato, en el orden de `IDENTITY_FIELD_DEFINITIONS`. Cada campo
tiene `value`, `status` (`found`, `not_found`, `conflicting` o `alleged`),
`note` (una aclaración opcional, por ejemplo que una dirección es de una
oficina y no del domicilio), `score`, `confidence` y `sources[]` con
`source`, `title` y `url`. Después de armar los candidatos, `scoreResults`
hace una sola llamada al modelo y puntúa cada resultado: primaria, secundaria
o terciaria, si es fuente oficial y si el dato se repite en una, dos o más
fuentes. Ese puntaje va de 1 a 100. De 1 a 50 el dato es incierto y no se
muestra. De 51 a 79 se muestra como probable. De 80 a 100 se muestra como
corroborado. Si el modelo cita una URL que no
salió de Tavily o Wikidata, esa fuente se descarta. Un valor que se queda sin
fuente pasa a `not_found` y `value: null` (`type` guarda `unknown`).

Si el plan no llega a generarse, la respuesta es un `ApiError` con estado 502.
Si una ronda posterior falla y ya hay plan o búsquedas, el estado es 502 y el
cuerpo incluye lo acumulado más `error`. El JSON del modelo tiene un intento
de reparación; si tampoco parsea, el error es `invalid_model_json`.

Usa `TAVILY_API_KEY` y `OPENROUTER_API_KEY`. Sin esas keys la búsqueda o el
modelo devuelven `missing_api_key` y la ruta no se marca como demo.

## CORS

Se permite explícitamente:

- `http://localhost:3000` (frontend local).
- Cualquier origen `https://*.pages.dev` (producción y previews de Cloudflare
  Pages).
- Orígenes adicionales listados en `CORS_ORIGINS` (separados por coma), por
  ejemplo un dominio propio.

Métodos: `GET`, `POST`, `OPTIONS`. Cabeceras permitidas: `Content-Type`,
`Authorization`. La cabecera de respuesta `X-Consta-Demo` se expone al
navegador. No se habilitan credenciales.

## Integración con el Channel GT

El analyzer puede consumir `@consta/gt-data` server-side. Configura
`GT_DATA_URL` (por ejemplo `http://localhost:8788`) y las tools `/tools/*`,
`/search` y `/entities/:id` se resuelven contra el canal. `POST /analyze`
obtiene el bundle del canal y construye el grafo y los claims con
`src/analyze.ts`.

Si el canal no responde, el backend usa el bundle demo local y responde con
`X-Consta-Fallback: local-demo`. Cuando sí responde, añade
`X-Consta-Channel: gt`. El canal tiene un timeout corto y un cooldown para no
bloquear el workspace cuando está caído.

El navegador nunca llama al Channel directamente: solo habla con este analyzer.

## Herramientas generales

`src/generalFuncs.ts` expone dos búsquedas fijas. Ninguna lanza excepciones:
devuelven `{ ok, source, query, items, retrievedAt, error? }`.

| Función | Fuente | Key |
| --- | --- | --- |
| `searchWikidata(env, query, options?)` | Wikidata `wbsearchentities` | No |
| `searchTavily(env, query, options?)` | Tavily Search + contenido | `TAVILY_API_KEY` |

Cada item trae `title` y `url`. Wikidata añade `id` (QID), `snippet` y
`license: "CC0-1.0"`. Tavily añade `snippet`, `content` (Markdown completo de la
página), `score` y `publishedDate`. Tavily no declara una licencia única: el
contenido es de terceros.

Opciones: `limit`, `language` (solo Wikidata), `timeoutMs`; en Tavily también
`searchDepth`, `includeRawContent`, `timeRange` y `topic`. Por defecto Tavily
pide `raw_content` en Markdown. Timeout por defecto: 10 s. Sin key,
`searchTavily` devuelve `missing_api_key` sin lanzar. `searchWikidata` no
lanza: un 429, un 5xx, un timeout o un error de red se reintenta dos veces.

### `callOpenRouter`

`callOpenRouter(env, messages, options?)` llama a OpenRouter y prueba modelos
free que declaran salida de texto. Si `/models` responde, filtra por `:free` y
`output_modalities` con `text`; si no, usa una lista de respaldo. Reintenta
429, 5xx, timeout, errores de red y una respuesta sin texto antes de pasar al
siguiente modelo.

Devuelve `{ ok, text, model, usage?, attempts, error? }`. No lanza. Un 401 de
la clave detiene el recorrido. Un 403 que nombra a un modelo concreto lo salta
y prueba el siguiente.

Opciones: `models`, `temperature`, `maxTokens`, `timeoutMs`, `retries` y
`retryDelayMs`.

## Variables de entorno

| Variable | Uso | Default |
| --- | --- | --- |
| `ENVIRONMENT` | Valor de `environment` en `/health`. | `development` (local); `demo` en `wrangler.jsonc`. |
| `CORS_ORIGINS` | Orígenes extra permitidos, separados por coma. | Vacío. |
| `GT_DATA_URL` | URL base del Channel GT que consume el analyzer. | Vacío: usa el bundle demo local. |
| `TAVILY_API_KEY` | API key server-side de Tavily. | Vacío: `searchTavily` devuelve `missing_api_key`. |
| `TAVILY_BASE_URL` | Base de Tavily. | `https://api.tavily.com`. |
| `TAVILY_SEARCH_DEPTH` | `basic`, `advanced`, `fast` o `ultra-fast`. | `basic`. |
| `TAVILY_INCLUDE_RAW_CONTENT` | Pide el contenido completo en la búsqueda. | `true`. |
| `WIKIDATA_API_URL` | Endpoint de la API de Wikidata. | `https://www.wikidata.org/w/api.php`. |
| `WIKIDATA_LANGUAGE` | Idioma de búsqueda en Wikidata. | `es`. |
| `OPENROUTER_API_KEY` | API key server-side de OpenRouter. | Vacío: `callOpenRouter` devuelve `missing_api_key`. |
| `OPENROUTER_BASE_URL` | Base de OpenRouter. | `https://openrouter.ai/api/v1`. |
| `OPENROUTER_MODEL` | Modelo preferido; se prueba primero. | Vacío. |
| `OPENROUTER_MODELS` | Lista separada por comas; reemplaza el descubrimiento. | Vacío. |
| `OPENROUTER_SITE_URL` | `HTTP-Referer` para OpenRouter. | Vacío. |
| `OPENROUTER_APP_NAME` | `X-Title` para OpenRouter. | Vacío. |

Copia `.dev.vars.example` a `.dev.vars` para desarrollo local. `.dev.vars` está
ignorado por git.

## Datos demo

Los datos viven en `packages/contracts/src/demo.ts` y son compartidos con el
frontend. El backend los usa como fallback y, si `GT_DATA_URL` está configurado,
consume el Channel GT. No hay base de datos ni ingesta propia todavía.

`POST /analyze` ya no devuelve un run estático: construye el grafo, los claims y
los pasos a partir del bundle de la entidad solicitada (o del primer resultado de
`query`). `depth` se valida para el contrato futuro; hoy el análisis es de primer
grado.

## Pendiente para conectar D1 y R2

1. Crear la base y el bucket:
   `pnpm --filter @consta/backend exec wrangler d1 create consta` y
   `pnpm --filter @consta/backend exec wrangler r2 bucket create consta-evidence`.
2. Descomentar los bindings en `wrangler.jsonc`, completar `database_id` y
   desplegar. Los nombres previstos son `DB` (D1) y `EVIDENCE_BUCKET` (R2).
3. Añadir migraciones SQL (entidades, identificadores, relaciones, evidencia y
   procedencias) y una capa de repositorio que sustituya las funciones demo de
   `@consta/contracts`.
4. Guardar documentos originales en R2 y cambiar `get_document` para devolver
   metadatos reales y, si aplica, un stream o URL firmada. Mantener licencia y
   atribución por registro.
5. Implementar ingesta de canales, autenticación/rate limiting y pruebas de
   integración. Nada de esto está incluido aún.

## Archivos

```text
backend/
  .dev.vars.example
  README.md
  package.json
  tsconfig.json
  wrangler.jsonc
  src/
    analyze.ts   # grafo, claims y run determinista
    gt.ts        # cliente del Channel GT con timeout y fallback
    index.ts     # Hono, rutas, CORS y validación
```
