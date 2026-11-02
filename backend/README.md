# Consta API (`@consta/backend`)

API HTTP de Consta para investigación de registros públicos, construida con
TypeScript, [Hono](https://hono.dev/) y Cloudflare Workers.

> **Modo demo.** Las entidades, relaciones, evidencias y análisis que devuelven
> las rutas de expediente son ficticios. No representan empresas ni personas
> reales. El manifiesto declara el modo demo y esas respuestas incluyen la
> cabecera `X-Consta-Demo: true`.
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
pnpm --filter @consta/backend test
pnpm --filter @consta/backend typecheck
pnpm --filter @consta/backend build
pnpm --filter @consta/backend deploy
```

`test` ejecuta `node --test` con el runner nativo de Node sobre
`backend/test/sourceScore.test.ts`. No requiere dependencias ni red: el loader
`test/register.mjs` resuelve imports relativos sin extensión a `.ts` con
`--experimental-strip-types`.

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
| `POST` | `/identity/connections` | Una vuelta del loop de conexiones sobre un candidato confirmado. Acepta `{ name, details?, investigation, candidateId, connection?, branchContext }` y devuelve `{ claims, rounds, summary, canContinue, stoppedReason }`.

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

curl -X POST "http://localhost:8787/identity/connections" \
  -H "Content-Type: application/json" \
  -d '{"name":"Banco de Guatemala","details":"banco central","investigation": {...}, "candidateId": "c1", "connection": {...}, "branchContext": {"entityId": "ent1", "claimId": "clm1", "label": "rama1"}}'
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
    "message": "No existe una entidad demo con id \"gt-nit:000\"".
  }
}
```

Códigos usados: `missing_parameter`, `invalid_parameter`, `invalid_json`,
`invalid_body`, `entity_not_found`, `document_not_found`, `not_found`,
`invalid_plan`, `invalid_model_json`, `candidate_not_found` e `internal_error`
(este último con `retryable: true`). La identidad también puede reenviar el
código de Tavily u OpenRouter, por ejemplo `missing_api_key`.

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

Usa `TAVILY_API_KEY` y un modelo (`OPENROUTER_API_KEY`, con `NVIDIA_API_KEY`
como respaldo). Sin la key de búsqueda, o sin ninguna key de modelo, la
respuesta es `missing_api_key` y la ruta no se marca como demo.

La puntuación quedó recalibrada: una sola fuente fuerte ya alcanza `probable`,
pero una fuente nunca pasa de 79 puntos, así que `corroborated` exige al menos
dos orígenes independientes. Un origen no es un host: dos notas del mismo medio
cuentan una sola vez y una nota sindicada o republicada en otro dominio, con el
mismo titular (normalizado sin acentos, puntuación ni el sufijo del medio, o con un
solapamiento de tokens de 0.92 o más), tampoco corrobora. `scoreResults` ya no
premia la repetición dentro del mismo medio ni dentro de un solo dominio.
Las pruebas deterministas de esta regla viven en `backend/test` y se ejecutan
con `pnpm --filter @consta/backend test`.

### Conexiones

`POST /identity/connections` es el paso siguiente a la confirmación de un
candidato. El cuerpo es
{`"name": "...", "details": "...", "investigation": {...}, "candidateId": "c1", "connection": {...}, "branchContext": {"entityId": "...", "claimId": "...", "label": "..."}}`.

**`branchContext`** es un objeto opcional que permite profundizar en una rama específica de la investigación. Este contexto ayuda a enfocar las búsquedas en conexiones de segundo grado y a conectar hallazgos con el sujeto principal.

- **`entityId`**: Identificador de una entidad específica dentro de la investigación.
- **`claimId`**: Identificador de una afirmación específica.
- **`label`**: Etiqueta descriptiva para el contexto de la rama.

El endpoint ahora valida que `branchContext` sea un objeto válido y que sus campos sean cadenas.

Cada request ejecuta **una sola vuelta** para no agotar el timeout de 300 s. El
frontend encadena hasta tres mientras `canContinue` sea `true`. La parada es
anticipada cuando no hay afirmaciones nuevas.

En la primera llamada, sin `connection`, el backend:

1. Busca el candidato por `candidateId`.
2. Crea la afirmación raíz `root`: texto
   `El sujeto investigado es <etiqueta>.`, `round: 0`, `parentId: null` y
   `sources` con la unión de las fuentes de los campos del candidato (máximo
   5, con el `score` que dejó la investigación inicial).
3. Arma `summary.who` con `candidate.description` o, si falta, una frase con
   tipo, ocupación, nacionalidad y dirección. `findings` empieza en
   "Todavía no hay afirmaciones probables.".
4. Devuelve `canContinue: true` si el candidato existe.

Si ya viene `connection` con `canContinue: false` o con tres rondas, se
devuelve sin cambios.

Cada vuelta hace, en este orden:

1. **Plan de conexiones.** Una llamada al modelo recibe el nombre, `details`,
   `summary.who`, la afirmación raíz, las afirmaciones acumuladas y las
   consultas previas. Devuelve de 1 a 5 consultas con el mismo formato
   `{ query, purpose, tool }` de la investigación (`tool` es `wikidata` o
   `tavily`; si falta o no es válido, la consulta se busca en ambas). `purpose`
   describe la conexión o afirmación a explorar, no un campo de perfil. Se
   descartan las consultas que repiten una `queryKey` previa.

2. **Búsquedas.** Se ejecutan con `searchIdentityQuery`, la misma función de la
   investigación. Si no hay resultados, la vuelta se detiene con
   `stoppedReason: "sin resultados"`.

3. **Minipaso de identificación por lote.** Una sola llamada al modelo recibe
   los resultados numerados del lote y elige hasta 5 instituciones, empresas y
   personas públicas más importantes. No puede inventar: cada `name` debe
   aparecer en el `title` o el `snippet` de algún resultado (se comprueba con
   `mentionsName`) y se descarta al sujeto consultado y a las entidades ya
   resueltas. Cada entidad se resuelve en una pasada: `searchIdentityQuery`
   con `{ query: name, tool: null }`, una ronda sintética y
   `candidatesFromPublicResults`. Se elige el candidato cuyo `label` o `name`
   coincide mejor; si no hay, queda una entidad mínima `type: "unknown"` con
   descripción "Sin identidad pública resuelta.". Estas búsquedas se agregan a
   `rounds[].searches` (y a la lista de fuentes del razonamiento) y al catálogo
   de la vuelta. No hay una llamada de scoring por entidad.

4. **Razonamiento.** Otra llamada recibe el nombre, `details`, `summary.who`, la
   afirmación raíz, las afirmaciones acumuladas, las entidades identificadas y
   la lista **numerada** de fuentes de la vuelta (`source`, `title`, `snippet`;
   nunca URLs). Devuelve solo
   `{"claims":[{"afirmacion":"...","parentText":"...","entidades":["..."],
   "fuentes":[1,2],"confianza":"probable"}]}`. `fuentes` son índices de la
   lista numerada: el backend los convierte en enlaces y descarta la afirmación
   si no queda ninguna fuente válida. `parentText` se resuelve contra las
   afirmaciones ya acumuladas para armar el hilo; `entidades` se cruza con las
   identificadas en el minipaso anterior y se descarta al sujeto.

5. **Tarjeta de cada identidad.** No se vuelve a correr `investigateIdentity`.
   La tarjeta se llena con tipo, descripción y fuentes que ya trajo el
   minipaso de identificación. El sujeto queda fuera: su ficha ya está
   confirmada en el panel.

La respuesta es `{ claims, rounds, summary, canContinue, stoppedReason }`.
`claims` acumula la raíz y las afirmaciones nuevas con sus fuentes, entidades,
puntaje y confianza. `rounds[]` guarda las consultas, búsquedas, entidades y
afirmaciones de cada vuelta. `summary` mantiene el contexto del sujeto y el
conteo de afirmaciones. El frontend agrupa en un solo hilo todas las
afirmaciones que unen al mismo par; el clic abre la tabla con texto, fuentes y
confianza (incierto, probable, corroborado). Las etiquetas de relación
(«hermano», «ministro») se derivan del texto para el hilo y para esa tabla.

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
siguiente modelo. Si la cuota diaria `free-models-per-day` se agota (la
comparten todos los `:free`), si la clave de OpenRouter falla o si ningún
modelo devuelve texto, pasa a NVIDIA NIM (`NVIDIA_BASE_URL`, por defecto
`https://integrate.api.nvidia.com/v1`) con `NVIDIA_MODEL` o, si falta,
`nemotron-3.5-lightning` y luego `bolt`. El resultado indica el proveedor que
atendió (`provider`). Los intentos quedan en `attempts` con su `provider`,
`model` y código de error.

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
| `NVIDIA_API_KEY` | API key server-side de NVIDIA NIM, respaldo de OpenRouter. | Vacío: no hay respaldo. |
| `NVIDIA_BASE_URL` | Base de NVIDIA NIM. | `https://integrate.api.nvidia.com/v1`. |
| `NVIDIA_MODEL` | Modelo de NVIDIA preferido; si falta, usa lightning y bolt. | Vacío. |

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
