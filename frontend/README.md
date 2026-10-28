# Consta — frontend

Interfaz editorial para investigación de registros públicos con enfoque
Guatemala. Cruza identidades, vínculos, claims y evidencia, manteniendo visible
la fuente y la licencia de cada dato.

> **Estado:** demo navegable. Las entidades, relaciones, montos y canales que se
> muestran por defecto son ficticios. No describen personas, empresas ni
> contratos reales. La etiqueta **DEMO** aparece en las vistas que usan el bundle
> local.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript.
- Export estático (`output: "export"`) para Cloudflare Pages.
- CSS propio en `app/globals.css`; sin Tailwind, UI kits, íconos externos ni
  librerías de gráficos.
- `@consta/contracts` como fuente de tipos y datos demo del workspace.

## Requisitos

- Node.js >= 20.9.
- pnpm, trabajando desde el monorepo de Consta.
- Dependencias instaladas desde la raíz del repositorio. El paquete declara
  `@consta/contracts` como dependencia de workspace.

## Comandos

Desde `frontend/`:

```bash
pnpm dev        # servidor de desarrollo
pnpm build      # build estático; genera out/
pnpm typecheck  # verificación de tipos
```

Para revisar el build exportado localmente:

```bash
npx serve out
```

No hay servidor Next en producción: el resultado es una carpeta de archivos
estáticos.

## Rutas

| Ruta | Contenido |
| --- | --- |
| `/` | Landing editorial: propuesta, caso demo, cobertura, método y manifiesto. |
| `/workspace` | Buscador, resultados, expediente, grafo, claims, pasos y evidencia. Acepta `?q=` y `?id=`. |
| `/channels` | Registro de canales con licencia, `commercial_ok`, estado, última sincronización, filas y capacidades. |
| `404` | Página de error con salida al inicio o al caso demo. |

### Estado en la URL del workspace

- `?q=Nexo` ejecuta una búsqueda local y actualiza la lista de resultados.
- `?id=gt-nit%3A90000017` abre directamente un expediente demo.
- Al seleccionar un nodo o un resultado se hace `router.replace` con `id`,
  preservando `q`. Así se puede compartir o recargar la selección.

## Flujo de datos

1. La landing y `/channels` leen el manifiesto y los canales demo de
   `@consta/contracts`.
2. El workspace arranca con resultados demo (`searchDemoEntities`), para que la
   interfaz sea navegable sin backend.
3. En paralelo intenta consultar la API local con timeout corto
   (1.6 s por petición). Si la respuesta tiene la forma esperada, usa los datos
   vivos y muestra **API local**; si no, conserva el fallback demo.
4. El expediente se compone con la entidad, sus relaciones, evidencia, claims y
   pasos del run. Si la API no devuelve un run, el cliente deriva claims y grafo
   desde el bundle.
5. La selección de nodos en el SVG, la lista de vínculos y el rail de resultados
   comparten el mismo `selectedId`.

### API esperada

`NEXT_PUBLIC_API_URL` define la base. Valor por defecto:
`http://localhost:8787`.

El cliente prueba variantes de ruta para tolerar backends en distintas etapas:

| Operación | Rutas probadas |
| --- | --- |
| Búsqueda | `GET /search?q=`, `/v1/search?q=`, `/api/search?q=` |
| Entidad | `GET /entities/:id`, `/entity/:id`, `/v1/entities/:id`, `/v1/entity/:id` |
| Análisis | `POST /analyze`, `/v1/analyze`, `/api/analyze` con `{ "entityId": "...", "depth": 1 }` |

Formas aceptadas:

- Búsqueda: un array de ítems o `{ "items": [...] }`, eventualmente envuelto en
  `data`, `result` o `search`. Cada ítem necesita al menos `id` y `title`.
- Entidad: un bundle con `entity`, `relationships` y `evidence`, eventualmente
  envuelto en `data`, `result` o `bundle`.
- Análisis: un run con `steps`, `claims` y, opcionalmente, `graph`. Si no hay
  `graph`, se construye a partir de las relaciones.

El backend debe permitir CORS desde el dominio del frontend. Al ser
`NEXT_PUBLIC_*`, la URL se incorpora en tiempo de build.

## Variables de entorno

Copiar `.env.example` a `.env.local` si se quiere apuntar a otra API:

```bash
NEXT_PUBLIC_API_URL=https://api.example.org
```

Sin variable, el cliente usa `http://localhost:8787` y cae al modo demo cuando
no hay respuesta válida.

## Deploy en Cloudflare Pages

El proyecto genera archivos estáticos en `frontend/out`.

Configuración recomendada para el monorepo:

- **Root directory:** raíz del repositorio.
- **Build command:** `pnpm --filter @consta/frontend build`
- **Build output directory:** `frontend/out`
- **Node version:** 20.9 o superior.
- **Environment variable:** `NEXT_PUBLIC_API_URL` con la URL HTTPS del backend.

Notas:

- No se usa servidor Next, ISR ni rutas dinámicas del servidor.
- `trailingSlash: true` publica `/workspace/`, `/channels/` y el `404.html`
  generado.
- Las imágenes están sin optimización (`images.unoptimized`), porque no hay
  runtime de Next.
- Si se sirve el frontend desde otro dominio, la API debe aceptar CORS.

## Sistema visual

- Tinta `#0b0f0e`, papel `#f3efe4`, lima `#d8ff3e`, naranja `#ff6b3d`.
- Tipografía display serif, texto de sistema, metadatos monoespaciados.
- Bordes finos, retícula de fondo, tarjetas de papel y composición tipo
  expediente.
- Breakpoints en `app/globals.css`: 1400, 1180, 1100, 980, 900, 820, 760, 620,
  520, 460 y 380 px.
- El grafo SVG cambia a disposición radial compacta por debajo de 760 px y
  respeta `prefers-reduced-motion`.
- La tabla de canales se convierte en tarjetas apiladas en pantallas pequeñas.

## Accesibilidad

- Enlace de salto al contenido, landmarks y jerarquía de encabezados.
- Navegación por teclado en el grafo (`Enter`/`Espacio` sobre nodos) y foco
  visible.
- Estados de identidad y canal no dependen solo del color: llevan etiqueta.
- El botón de búsqueda conserva nombre accesible cuando se oculta su texto en
  móvil.
- La tabla de canales mantiene semántica de tabla; las etiquetas visuales de las
  tarjetas se generan con `data-label`.

## Estructura

```text
frontend/
├─ app/
│  ├─ channels/page.tsx      # registro de canales
│  ├─ workspace/page.tsx     # Suspense + metadata
│  ├─ not-found.tsx
│  ├─ layout.tsx
│  ├─ globals.css
│  └─ page.tsx               # landing
├─ components/
│  ├─ workspace/Workspace.tsx
│  ├─ ChannelsRegistry.tsx
│  ├─ Graph.tsx
│  ├─ Dossier.tsx
│  ├─ EvidenceList.tsx
│  └─ ...
├─ lib/
│  ├─ api.ts                 # cliente, timeout y fallback
│  ├─ model.ts               # vista, grafo y claims derivados
│  └─ format.ts
├─ public/favicon.svg
├─ next.config.ts
└─ README.md
```

## Límites conocidos

- No hay autenticación, persistencia, ingesta ni jobs de análisis en este
  paquete; eso vive en el backend.
- La búsqueda demo es un subconjunto ficticio de cinco entidades.
- El filtro **Solo commercial_ok** es de cliente y opera sobre el snapshot
  `demoChannels`.
- Los enlaces de evidencia apuntan a datasets de origen, no a una fila única
  inexistente.
- Las licencias mostradas son parte del contrato de canal; no sustituyen una
  revisión legal.
