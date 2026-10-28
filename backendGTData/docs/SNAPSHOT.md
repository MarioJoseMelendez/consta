# Snapshot de fuentes GT

Consta es snapshot-first. El request path del worker **nunca** descarga ni scrapea
fuentes: lee D1/R2. Este documento describe cómo obtener y procesar los snapshots
fuera del worker. No contiene datos reales de personas ni empresas.

## Resumen de fuentes

| Fuente | URL exacta | Volumen | Cadencia | Licencia |
| --- | --- | --- | --- | --- |
| RGAE proveedores (CSV) | `https://datos.minfin.gob.gt/datastore/dump/da2806c2-c18b-4d16-bb28-f357fb8da231?bom=True` | 293,439 filas | No declarada; snapshot manual periódico | CC BY-SA 4.0 (ver discrepancia) |
| RGAE representantes (CSV) | `https://datos.minfin.gob.gt/datastore/dump/bc72d096-df28-464b-948c-15a5f60517fe?bom=True` | 14,363 filas | No declarada; snapshot manual periódico | CC BY-SA 4.0 (ver discrepancia) |
| Guatecompras OCDS (índice) | `https://ocds.guatecompras.gt/files?year=2026&month=9` | Índice mensual | Mensual | CC BY 4.0 |
| Guatecompras OCDS (ZIP) | `https://ocds.guatecompras.gt/file/json/2026/9` | ~35 MB (septiembre 2026) | Mensual | CC BY 4.0 |
| Wikidata SPARQL | `https://query.wikidata.org/sparql?query=...&format=json` | Variable | Bajo demanda | CC0 |

URLs de contexto:

- RGAE proveedores: `https://datos.minfin.gob.gt/dataset/registro-de-proveedores`
- RGAE representantes: `https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales`
- Portal Guatecompras OCDS: `https://ocds.guatecompras.gt/`
- Portal Wikidata: `https://www.wikidata.org/`

El tamaño en bytes de los CSV de RGAE no se fija aquí: debe medirse al descargar.
No inventar checksums ni fechas de corte.

## Licencias y atribución

### RGAE — CC BY-SA 4.0 con discrepancia documentada

El metadata del dataset de RGAE indica: “No se ha provisto de una licencia”. El
footer del portal `datos.minfin.gob.gt` declara CC BY-SA 4.0. Consta adopta
**CC BY-SA 4.0** y registra la discrepancia en el manifest y en `/health`. Cada
evidencia de RGAE lleva la licencia `CC BY-SA 4.0` y su `retrievedAt`.

- `commercialOk`: `true`
- `shareAlike`: `true`
- Atribución: Ministerio de Finanzas Públicas de Guatemala — RGAE.
- Una base derivada que mezcle o transforme estos datos debe respetar ShareAlike.
- Conservar por fila la URL de la fuente y la fecha de obtención.

### Guatecompras OCDS — CC BY 4.0

- `commercialOk`: `true`
- Atribución: Guatecompras / Gobierno de Guatemala, datos OCDS.
- Indicar que los datos fueron transformados al modelo de Consta.

### Wikidata — CC0

- `commercialOk`: `true`
- No exige atribución, pero se conserva el QID y la URL del ítem como trazabilidad.

### Base de datos mixta

El manifest declara la licencia más restrictiva (CC BY-SA 4.0) con una nota que
enumera las fuentes. Cada `Evidence` y cada `DocumentRecord` conserva su propia
licencia. No se debe presentar una mezcla como si tuviera una única licencia.

## RGAE: descarga manual o asistida

El portal de RGAE bloquea requests server-side con **403**. El worker no intenta
descargar, evadir el bloqueo ni automatizar un navegador.

Procedimiento:

1. Abrir la URL del dump en un navegador de escritorio, desde una red normal.
2. Descargar el CSV manualmente (o mediante un flujo asistido por una persona).
3. Guardar el archivo con un nombre fechado, por ejemplo:
   `snapshots/2026-10-06/rgae-prov.csv` y `rgae-reps.csv`.
4. Verificar que el archivo inicia con BOM UTF-8 (`EF BB BF`) y que el header
   contiene columnas de NIT y nombre/razón social.
5. Registrar en un archivo de control: URL exacta, fecha/hora de obtención,
   tamaño en bytes, cantidad de filas y SHA-256.
6. Calcular el checksum fuera del worker, por ejemplo con PowerShell:
   `Get-FileHash .\rgae-prov.csv -Algorithm SHA256`.
7. Procesar con los adapters puros y cargar D1 en el orden indicado abajo.

No incluir los CSV crudos en el repositorio. Los binarios, si se archivan, van a
R2 (binding `EVIDENCE_BUCKET`) y la metadata a la tabla `documents`.

## Guatecompras OCDS: procesamiento mensual

1. Consultar el índice del mes: `https://ocds.guatecompras.gt/files?year=2026&month=9`.
2. Descargar el ZIP: `https://ocds.guatecompras.gt/file/json/2026/9` (~35 MB).
3. Descomprimir en un directorio temporal fuera del worker.
4. Leer cada JSON y extraer `releases` (o `records[].compiledRelease`).
5. Mapear con `src/adapters/ocds.ts`:
   - `mapOcdsReleases(releases, { retrievedAt, sourceUrl })`
   - o `mapOcdsPayload(package, options)`
6. El adapter produce entidades (buyer, parties, suppliers), relaciones
   `AWARDED_CONTRACT`, evidencia por adjudicación y documentos.
7. Cargar D1 y, si se decide archivar el ZIP, subirlo a R2 y registrar su
   metadata en `documents`.

Campos OCDS que el adapter tolera ausentes: `buyer`, `parties`, `awards`,
`suppliers`, `tender`, `documents`, `value`, `date`, `status`, `identifier`.
Si un release no trae comprador o proveedores utilizables, no se inventa la
relación; se conserva la evidencia que sí exista.

## Wikidata: consulta SPARQL de ejemplo

La consulta se ejecuta fuera del worker. Guardar el JSON y mapearlo con
`src/adapters/wikidata.ts`.

```sparql
SELECT ?item ?itemLabel ?itemDescription ?countryLabel ?website ?instanceOfLabel WHERE {
  VALUES ?item { wd:Q0000000 }   # placeholder: sustituir por un QID real
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P31 ?instanceOf. }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "es,en".
  }
}
LIMIT 25
```

Búsqueda por texto (sin datos reales; sustituir el literal):

```sparql
SELECT ?item ?itemLabel ?itemDescription WHERE {
  ?item rdfs:label ?label .
  FILTER(LANG(?label) = "es" && CONTAINS(LCASE(?label), "texto de ejemplo"))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
LIMIT 25
```

Endpoint: `https://query.wikidata.org/sparql?query=...&format=json`.
Respetar la política de uso de Wikidata (User-Agent identificable, sin abuso).

## Orden de carga en D1

1. `sync_runs` (estado `running`).
2. `entities`.
3. `identifiers` (`normalized_value` obligatorio; NIT sin guiones, CUI a 13 dígitos).
4. `relationships` (requiere que existan `from_id` y `to_id`).
5. `evidence`.
6. `documents`.
7. Actualizar `sync_runs` a `success`, `partial` o `failed` con conteos y error.

Cada lote debe ser idempotente: usar `INSERT ... ON CONFLICT ... DO UPDATE` sobre
las claves primarias. No borrar una entidad si un snapshot posterior no la trae;
marcar el estado correspondiente.

## Fechas y evidencia

- `retrievedAt`: fecha/hora ISO de obtención del snapshot. Obligatoria en toda
  evidencia y documento.
- `Evidence.license`: licencia de la fuente, obligatoria.
- `Evidence.url`: URL de la fuente o del documento. No se resuelve en runtime.
- `date`: fecha del acto o de la fila, si la fuente la provee.
- No usar la fecha actual del worker para simular una obtención.

## R2

R2 solo almacena binarios y artefactos grandes (CSV, ZIP, PDFs descargados por el
pipeline). El worker no lee binarios para `get_document`; devuelve la metadata de
la tabla `documents`. Cualquier descarga de archivo debe hacerse en un job de
ingesta o en una herramienta separada, nunca desde un query param.

## Checklist antes de habilitar D1

- [ ] Migración aplicada (`wrangler d1 migrations apply ...`).
- [ ] Snapshot descargado y checksum registrado.
- [ ] Filas contadas y comparadas con el origen.
- [ ] Entidades cargadas antes que relaciones.
- [ ] Evidencia con `license` y `retrieved_at`.
- [ ] Documentos con `url`, `content_type` y `license`.
- [ ] `sync_runs` con estado final y conteos.
- [ ] `/health` en modo `d1` sin errores.
- [ ] Revisión legal de atribución y ShareAlike.
