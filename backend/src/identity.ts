/**
 * Resolución de identidad en un solo viaje.
 *
 * El plan de queries es una llamada previa y no cuenta como ronda.
 * Después hay como máximo tres rondas. Cada consulta usa la herramienta
 * que eligió el modelo (`wikidata` o `tavily`). Si la herramienta falta o
 * no es válida, esa consulta se busca en las dos. La IA actualiza
 * candidatos y decide si sigue o se detiene.
 * Cada consulta intenta encontrar un campo del perfil. Primero se determina
 * si el nombre es una persona o una empresa. Una persona se rastrea en
 * noticieros y registros; una empresa, en registros públicos.
 * Si el modelo no nombra el campo, se le adjunta uno según ese tipo.
 * Un valor solo sobrevive si cita una URL devuelta por esas búsquedas.
 */

import {
  IDENTITY_FIELD_DEFINITIONS,
  IDENTITY_FIELD_KEYS,
  IDENTITY_MAX_EXTRA_SEARCHES,
  emptyIdentityField,
  identityFieldLabel,
  type IdentityCandidate,
  type IdentityClaim,
  type IdentityConfidence,
  type IdentityConnectionState,
  type IdentityConnectionsRequest,
  type IdentityConnectionsResponse,
  type IdentityEntity,
  type IdentityDecision,
  type IdentityField,
  type IdentityFieldKey,
  type IdentityFieldStatus,
  type IdentityInvestigation,
  type IdentityInvestigationResponse,
  type IdentityPlan,
  type IdentityPlanQuery,
  type IdentityProfileType,
  type IdentityQueryResult,
  type IdentityRound,
  type IdentitySearchItem,
  type IdentitySource,
  type IdentitySourceRef,
  type IdentitySummary,
  type IdentityToolQuery,
} from "@consta/contracts";
import {
  callOpenRouter,
  searchTavily,
  searchWikidata,
  type GeneralEnv,
  type GeneralError,
} from "./generalFuncs";
import { confidenceForScore, scoreResults, type ResultToScore } from "./sourceScore";
import {
  occupationCandidates,
  readOccupationImage,
  savedKey,
  searchSavedClaims,
} from "./db";

export const IDENTITY_NAME_MAX = 200;
export const IDENTITY_DETAILS_MAX = 2000;
export const IDENTITY_INTEREST_MAX = 1000;

const PUBLIC_INTEREST_FOCUS =
  "conexiones de interés público: partidos políticos, fondeo, empresas asociadas y apoyo externo";

function journalistDetailNote(details?: string): string {
  return details
    ? `Descripción del periodista, no es evidencia: ${details}`
    : "Sin descripción adicional.";
}

/** Foco que el periodista escribe; si falta, la búsqueda va a interés público. */
export function journalistInterestNote(interest?: string): string {
  const trimmed = interest?.trim();
  if (trimmed) {
    return `Interés de investigación del periodista, no es evidencia: ${trimmed}. Priorízalo cuando haya rastro público; si no lo hay, sigue con ${PUBLIC_INTEREST_FOCUS}.`;
  }
  return `Sin interés de investigación específico. Enfócate en ${PUBLIC_INTEREST_FOCUS}.`;
}

function publicInterestSearchLines(): string[] {
  return [
    "En esta vuelta busca conexiones públicas de interés periodístico, con nombres concretos:",
    "- partidos políticos, movimientos, cargos o militancia;",
    "- fondeo: donaciones, contratos, licitaciones, patrocinios;",
    "- empresas asociadas, sociedades, juntas, representantes legales;",
    "- apoyo externo: ONG, gobiernos, organismos, lobby, campañas.",
  ];
}

const MAX_ROUNDS = 3;
const CONNECTION_ROUNDS = 3;
const MIN_PLAN_QUERIES = 1;
const MAX_PLAN_QUERIES = 5;
const MAX_CANDIDATES = 5;
const SEARCH_LIMIT = 5;
const SEARCH_TIMEOUT_MS = 12_000;
const MODEL_TIMEOUT_MS = 45_000;
const PLAN_MAX_TOKENS = 900;
const ROUND_MAX_TOKENS = 4_500;
const IDENTITY_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
] as const;

const FIELD_KEYS = new Set<string>(IDENTITY_FIELD_KEYS);

/** Herramientas que el modelo puede elegir. `bd` es la base compartida. */
const IDENTITY_TOOLS_JSON =
  '{"tools":[{"wikidata":"Es una wiki para data específica. Sirve para saber si el nombre es una persona o una empresa."},{"tavily":"Para buscar en la web, en registros públicos y en noticieros."},{"bd":"Base de investigaciones previas de Consta. Devuelve afirmaciones ya guardadas, con su nivel de corroborancia, su puntaje y sus fuentes originales. Úsala para reutilizar trabajo ya verificado, no para inventar datos."}]}';

/** Qué hay que buscar en cada campo. Una línea, en el orden del contrato. */
const FIELD_LOOK_FOR: Record<IdentityFieldKey, string> = {
  type: "Si es persona, empresa o institución.",
  name: "El nombre con el que la fuente identifica a la entidad.",
  socialName: "La razón social o el nombre legal registrado.",
  nationalID: "El CUI o DPI, solo si es una persona.",
  taxesID: "El NIT, número de identificación tributaria.",
  aliases: "Otros nombres, siglas o alias.",
  dateOfBirth: "La fecha de nacimiento, si es una persona.",
  nationality: "La nacionalidad o el país.",
  address: "La dirección física o la sede.",
  legalRepresentative: "El nombre del representante legal.",
  incorporationDate: "La fecha de constitución o fundación.",
  website: "El sitio web oficial.",
  email: "El correo electrónico.",
  phone: "El teléfono.",
  occupation: "La ocupación o el cargo principal. Si la fuente nombra varios, elige uno solo.",
};

/** Término corto para una búsqueda web de ese campo. */
const FIELD_SEARCH_TERM: Record<IdentityFieldKey, string> = {
  type: "tipo",
  name: "nombre",
  socialName: "razón social",
  nationalID: "DPI",
  taxesID: "NIT",
  aliases: "alias",
  dateOfBirth: "fecha de nacimiento",
  nationality: "nacionalidad",
  address: "dirección",
  legalRepresentative: "representante legal",
  incorporationDate: "fecha de constitución",
  website: "sitio web",
  email: "correo",
  phone: "teléfono",
  occupation: "ocupación",
};

/** Cómo reconocer que un purpose o una consulta ya nombra el campo. */
const FIELD_TERMS: Record<IdentityFieldKey, readonly string[]> = {
  type: ["type", "tipo"],
  name: ["name", "nombre"],
  socialName: ["socialName", "razón social", "razon social", "nombre legal"],
  nationalID: ["nationalID", "CUI", "DPI", "documento nacional"],
  taxesID: ["taxesID", "NIT", "identificación tributaria", "identificacion tributaria"],
  aliases: ["aliases", "alias", "siglas"],
  dateOfBirth: ["dateOfBirth", "fecha de nacimiento", "nacimiento"],
  nationality: ["nationality", "nacionalidad"],
  address: ["address", "dirección", "direccion"],
  legalRepresentative: ["legalRepresentative", "representante legal"],
  incorporationDate: [
    "incorporationDate",
    "fecha de constitución",
    "fecha de constitucion",
    "fecha de fundación",
    "fecha de fundacion",
  ],
  website: ["website", "sitio web", "sitio", "página web", "pagina web"],
  email: ["email", "correo"],
  phone: ["phone", "teléfono", "telefono"],
  occupation: ["occupation", "ocupación", "ocupacion"],
};

/**
 * Orden para adjuntar un campo cuando el modelo no nombra ninguno.
 * El tipo va primero. El resto depende de si ya se sabe que es persona o empresa.
 */
const FIELD_TARGET_ORDER: readonly IdentityFieldKey[] = [
  "type",
  "name",
  "occupation",
  "aliases",
  "nationality",
  "dateOfBirth",
  "nationalID",
  "socialName",
  "taxesID",
  "address",
  "website",
  "phone",
  "email",
  "legalRepresentative",
  "incorporationDate",
];

const PERSON_FIELDS: readonly IdentityFieldKey[] = [
  "occupation",
  "aliases",
  "dateOfBirth",
  "nationality",
  "nationalID",
  "address",
];

const ENTERPRISE_FIELDS: readonly IdentityFieldKey[] = [
  "socialName",
  "taxesID",
  "address",
  "website",
  "phone",
  "legalRepresentative",
  "incorporationDate",
  "email",
];

const IDENTITY_FIELDS_JSON = JSON.stringify({
  fields: IDENTITY_FIELD_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    lookFor: FIELD_LOOK_FOR[definition.key],
  })),
});

const PLAN_SYSTEM = [
  "Eres el planificador de identidad de Consta, una herramienta periodística de registros públicos.",
  "Respondes únicamente con un objeto JSON. No uses markdown ni texto alrededor.",
  "No inventes hechos, identificadores, cargos ni relaciones. Una pista de búsqueda no es un dato ya conocido.",
  "El nombre, la descripción y el interés de investigación son la consulta del periodista, no evidencia.",
  "Diccionario de herramientas. Usa solo estas. No inventes una tercera:",
  IDENTITY_TOOLS_JSON,
  "Diccionario de datos que debes intentar encontrar. Si un dato no está en la fuente, queda not_found. No inventes el valor:",
  IDENTITY_FIELDS_JSON,
  'Cada consulta incluye "tool" con exactamente "wikidata", "tavily" o "bd".',
  'Cada "purpose" nombra el campo que esa consulta busca, con la clave y la etiqueta, por ejemplo "taxesID / NIT", "socialName / Razón social" o "address / Dirección".',
  'No sirve un purpose solo genérico ("historia", "conocer", "contexto", "identificar") sin una clave de campo.',
  'Puedes empezar con una consulta a "bd" usando el nombre exacto: devuelve afirmaciones ya guardadas y evita repetir trabajo.',
  'La siguiente consulta es exactamente el nombre consultado, sin palabras de más, tool "wikidata", purpose "type / Tipo". Sirve para saber si es persona o empresa.',
  'La última es el mismo nombre, tool "tavily", purpose "type / Tipo", para ver si es una figura pública en noticieros.',
  "No busques NIT, razón social, DPI ni cargo hasta saber el tipo. En el plan solo van esas consultas y, si aplica, la de bd.",
  "Escribe interpretation, query y purpose en español.",
  'Forma: {"interpretation":"INTERPRETACION","queries":[{"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"wikidata"}]}',
  'Reemplaza INTERPRETACION, CONSULTA, CLAVE y ETIQUETA. purpose lleva la clave real del diccionario. tool es "wikidata", "tavily" o "bd". No dejes los marcadores literales ni uses puntos suspensivos.',
].join("\n");

const ROUND_SYSTEM = [
  "Eres el analista de identidad de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en los resultados etiquetados de Tavily, Wikidata o la base bd. Los resultados de bd traen afirmaciones ya guardadas con sus fuentes originales.",
  "El nombre, la descripción y el interés de investigación del periodista orientan la búsqueda y no son una fuente.",
  "No inventes ni completes datos. Si un campo no está en los resultados, no lo incluyas: queda not_found.",
  "Un candidato es una persona, empresa o institución nombrada en un resultado. No hace falta NIT, DPI ni un perfil completo.",
  "Si un resultado nombra al sujeto, devuélvelo. name queda \"found\" con la URL de ese resultado. Los campos que no aparezcan se omiten y quedan \"not_found\".",
  "Cada resultado de Wikidata ya es una entidad y puede ser su propio candidato.",
  "candidates queda [] solo cuando ningún resultado nombra una persona, empresa o institución.",
  "Cada valor found, conflicting o alleged necesita sources cuya url sea una de las URLs entregadas. title y url son obligatorios.",
  "source solo puede ser \"tavily\", \"wikidata\" o \"bd\", y debe coincidir con el resultado citado. Si citas bd, el backend usa las fuentes originales guardadas.",
  "Una alegación no verificada usa status \"alleged\". Si las fuentes no coinciden, status es \"conflicting\" y value describe el conflicto sin elegir un ganador.",
  "type solo puede ser \"person\", \"enterprise\" o \"unknown\".",
  "nationalID es CUI o DPI. taxesID es NIT. No los intercambies.",
  "Devuelve como máximo 5 candidatos distintos.",
  "Diccionario de herramientas. Usa solo estas. No inventes una tercera:",
  IDENTITY_TOOLS_JSON,
  "Diccionario de datos a encontrar. No inventes un valor que no esté escrito en los resultados:",
  IDENTITY_FIELDS_JSON,
  'Cada nextQuery elige una herramienta y nombra el campo que busca: {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"tavily"}.',
  'tool solo puede ser "wikidata", "tavily" o "bd". No uses cadenas sueltas ni otra herramienta.',
  "Primero decide type: person o enterprise. No busques el resto hasta tener ese tipo.",
  "Si type es person, es una figura pública: nextQueries van a noticieros (occupation, aliases, dateOfBirth, nationality) y a registros públicos para nationalID. No pidas NIT, razón social ni fecha de constitución.",
  "Si type es enterprise, nextQueries van a registros públicos: socialName, taxesID, address, website, phone, legalRepresentative, incorporationDate. No la busques como noticia.",
  "Si type sigue unknown, la única nextQuery distingue persona o empresa. No pidas un NIT.",
  "wikidata: el query es el nombre o un alias corto. tavily para una persona: el nombre más el dato, en noticieros. tavily para una empresa: el nombre más el dato del registro.",
  "bd: úsala cuando el sujeto o una conexión ya pueda estar investigada. Devuelve afirmaciones guardadas con su corroborancia y fuentes; no la uses para completar un campo que la fuente no dice.",
  "En la ronda 3, action es \"stop\" y nextQueries es [].",
  "Si quedan campos en not_found, quedan rondas y hay una búsqueda pública concreta para esos campos, action es \"continue\" y nextQueries trae de 1 a 5 búsquedas nuevas.",
  "Si no hay más pistas públicas para los campos que faltan, action es \"stop\". No inventes valores para llenar el perfil.",
  "Cada campo puede incluir note: una frase corta en español, solo cuando el valor no es lo que el campo parece. Por ejemplo, una dirección de la oficina en el Congreso y no del domicilio del diputado. Si no hace falta aclarar, omite note. La nota tiene que salir del resultado.",
  'Forma: {"candidates":[{"id":"c1","label":"ETIQUETA","description":"DESCRIPCION","fields":[{"key":"name","value":"VALOR","status":"found","sources":[{"source":"wikidata","title":"TITULO","url":"https://ejemplo.invalid/fuente"}]}]}],"decision":{"action":"stop","reason":"MOTIVO","nextQueries":[]}}',
  "Reemplaza ETIQUETA, DESCRIPCION, VALOR, TITULO, MOTIVO, CLAVE y la URL de ejemplo por datos de los resultados. No uses puntos suspensivos.",
].join("\n");

const REPAIR_SYSTEM = [
  "Corrige el texto para que sea un único objeto JSON válido.",
  "No cambies hechos, URLs ni estados. No agregues datos.",
  "Responde solo con el JSON, sin markdown.",
].join(" ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLACEHOLDER_TEXT = new Set([
  "INTERPRETACION",
  "CONSULTA",
  "PROPOSITO",
  "CLAVE",
  "ETIQUETA",
  "CLAVE / ETIQUETA",
  "DESCRIPCION",
  "VALOR",
  "TITULO",
  "MOTIVO",
  "NOTA",
]);

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) return null;
  if (PLACEHOLDER_TEXT.has(cleaned.toLocaleUpperCase("es"))) return null;
  if (cleaned.includes("ejemplo.invalid")) return null;
  return cleaned.slice(0, max);
}

function readNote(value: unknown): string | null {
  const note = clip(value, 280);
  if (!note || note.toLocaleLowerCase("es") === "null") return null;
  return note;
}

const EMPTY_VALUE_TOKENS = new Set([
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "ninguno",
  "ninguna",
  "sin dato",
  "sin datos",
  "no aplica",
]);

function isEmptyFieldValue(value: string): boolean {
  return EMPTY_VALUE_TOKENS.has(
    value.trim().toLocaleLowerCase("es").replace(/[.]+$/, ""),
  );
}

function readLooseValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clip(String(value), 500);
  }
  if (typeof value === "string") {
    const text = clip(value, 500);
    return text && !isEmptyFieldValue(text) ? text : null;
  }
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((item) => clip(item, 160))
    .filter(
      (item): item is string => item !== null && !isEmptyFieldValue(item),
    );
  if (parts.length === 0) return null;
  return clip(parts.join(", "), 500);
}

function readOccupation(value: unknown): string | null {
  return pickSingleOccupation(value);
}

/**
 * Un cargo, no una lista. Si ya hay uno guardado en el perfil, se conserva;
 * si la fuente nombra varios, se toma el primero que no sea la lista completa.
 */
export function pickSingleOccupation(
  value: unknown,
  preferred?: string | null,
): string | null {
  const stored = collapseOccupationList(preferred);
  if (stored) return stored;
  return collapseOccupationList(occupationTextOf(value));
}

function occupationTextOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clip(String(value), 120);
  }
  if (typeof value === "string") {
    const text = clip(value, 120);
    return text && !isEmptyFieldValue(text) ? text : null;
  }
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((item) => clip(item, 80))
    .filter(
      (item): item is string => item !== null && !isEmptyFieldValue(item),
    );
  if (parts.length === 0) return null;
  return clip(parts.join(", "), 120);
}

function collapseOccupationList(value: string | null | undefined): string | null {
  if (!value || isEmptyFieldValue(value)) return null;
  const parts = occupationCandidates(value);
  if (parts.length === 0) return clip(value, 120);
  const fullKey = savedKey(value);
  return parts.find((part) => savedKey(part) !== fullKey) ?? parts[0] ?? null;
}

async function preferStoredOccupation(
  env: GeneralEnv,
  value: string | null,
): Promise<string | null> {
  const picked = pickSingleOccupation(value);
  if (!picked) return null;
  const parts = occupationCandidates(value ?? picked);
  for (const part of parts) {
    const cached = await readOccupationImage(env.DB, part);
    if (cached) return part;
  }
  return picked;
}

function emptyResult(
  error: NonNullable<IdentityInvestigationResponse["error"]>,
): IdentityInvestigationResponse {
  return {
    plan: { interpretation: "", queries: [] },
    rounds: [],
    candidates: [],
    error,
  };
}

function identityModels(env: GeneralEnv): string[] {
  const preferred = env.OPENROUTER_MODEL?.trim();
  const models = preferred ? [preferred, ...IDENTITY_MODELS] : [...IDENTITY_MODELS];
  return [...new Set(models)].slice(0, IDENTITY_MODELS.length);
}

function modelCallOptions(env: GeneralEnv, maxTokens: number) {
  return {
    models: identityModels(env),
    temperature: 0.1,
    maxTokens,
    timeoutMs: MODEL_TIMEOUT_MS,
    retries: 1,
    retryDelayMs: 600,
  };
}

function logModelFailure(
  stage: string,
  attempts: Array<{ provider?: string; model: string; code?: string }>,
  code: string | undefined,
): void {
  const summary = attempts
    .map(
      (attempt) =>
        `${attempt.provider ? `${attempt.provider}/` : ""}${attempt.model}:${
          attempt.code ?? "ok"
        }`,
    )
    .join(", ");
  console.error(`[consta-api] identity ${stage}`, code ?? "error", summary);
}

function fromGeneralError(error: GeneralError | undefined, fallback: string) {
  return {
    code: error?.code ?? "model_error",
    message: error?.message ?? fallback,
    ...(error?.retryable !== undefined ? { retryable: error.retryable } : {}),
  };
}

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? trimmed).trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

async function parseModelJson(
  env: GeneralEnv,
  text: string,
  maxTokens: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: GeneralError }> {
  const parsed = tryParseJson(text);
  if (parsed !== null) return { ok: true, value: parsed };

  const repair = await callOpenRouter(
    env,
    [
      { role: "system", content: REPAIR_SYSTEM },
      { role: "user", content: text.slice(0, 14_000) },
    ],
    { ...modelCallOptions(env, maxTokens), temperature: 0 },
  );

  if (!repair.ok) {
    return {
      ok: false,
      error: repair.error ?? {
        code: "invalid_model_json",
        message: "No se pudo reparar el JSON del modelo.",
      },
    };
  }

  const repaired = tryParseJson(repair.text);
  if (repaired === null) {
    return {
      ok: false,
      error: {
        code: "invalid_model_json",
        message: "El modelo no devolvió un objeto JSON utilizable.",
      },
    };
  }

  return { ok: true, value: repaired };
}

function unwrapPayload(value: unknown, marker: "plan" | "round"): unknown {
  if (!isRecord(value)) return value;
  if (marker === "plan" && Array.isArray(value.queries)) return value;
  if (
    marker === "round" &&
    (Array.isArray(value.candidates) || isRecord(value.decision))
  ) {
    return value;
  }
  for (const key of ["plan", "result", "data", "output"] as const) {
    const nested = value[key];
    if (!isRecord(nested)) continue;
    if (marker === "plan" && Array.isArray(nested.queries)) return nested;
    if (
      marker === "round" &&
      (Array.isArray(nested.candidates) || isRecord(nested.decision))
    ) {
      return nested;
    }
  }
  return value;
}

function readTool(value: unknown): IdentitySource | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLocaleLowerCase("es");
  if (token === "wikidata") return "wikidata";
  if (token === "tavily") return "tavily";
  if (token === "bd") return "bd";
  return null;
}

function queryKey(query: string, tool: IdentitySource | null): string {
  return `${tool ?? "*"}:${query.toLocaleLowerCase("es")}`;
}

function readDirectedQuery(entry: unknown): IdentityToolQuery | null {
  if (typeof entry === "string") {
    const query = clip(entry, 300);
    return query ? { query, tool: null } : null;
  }
  if (!isRecord(entry)) return null;
  const query = clip(entry.query, 300);
  if (!query) return null;
  const purpose = clip(entry.purpose, 300);
  const tool = readTool(entry.tool);
  return purpose ? { query, tool, purpose } : { query, tool };
}

function readPlan(value: unknown): IdentityPlan | null {
  const payload = unwrapPayload(value, "plan");
  if (!isRecord(payload) || !Array.isArray(payload.queries)) return null;
  const interpretation = clip(payload.interpretation, 800);
  if (!interpretation) return null;

  const queries: IdentityPlanQuery[] = [];
  const seen = new Set<string>();
  for (const entry of payload.queries) {
    if (!isRecord(entry)) continue;
    const query = clip(entry.query, 300);
    if (!query) continue;
    const purpose = clip(entry.purpose, 300) ?? "";
    const tool = readTool(entry.tool);
    const key = queryKey(query, tool);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({ query, purpose, tool });
    if (queries.length === MAX_PLAN_QUERIES) break;
  }

  if (queries.length < MIN_PLAN_QUERIES) return null;
  return { interpretation, queries };
}

function urlKey(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

function addToCatalog(
  catalog: Map<string, IdentitySearchItem>,
  items: IdentitySearchItem[],
): void {
  for (const item of items) {
    const key = urlKey(item.url);
    if (!key || catalog.has(key)) continue;
    catalog.set(key, item);
  }
}

function findCatalogItem(
  catalog: Map<string, IdentitySearchItem>,
  url: string,
): IdentitySearchItem | undefined {
  const key = urlKey(url);
  if (!key) return undefined;
  const exact = catalog.get(key);
  if (exact) return exact;

  const pathKey = key.split("?")[0] ?? key;
  let match: IdentitySearchItem | undefined;
  for (const [itemKey, item] of catalog) {
    if ((itemKey.split("?")[0] ?? itemKey) !== pathKey) continue;
    if (match) return undefined;
    match = item;
  }
  return match;
}

function itemMentions(item: IdentitySearchItem, names: readonly string[]): boolean {
  return names.some(
    (name) =>
      name.length > 0 &&
      (mentionsName(item.title, name) || mentionsName(item.snippet, name)),
  );
}

function readSources(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
  names: readonly string[],
): IdentitySourceRef[] {
  if (!Array.isArray(value)) return [];
  const sources: IdentitySourceRef[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    const item = findCatalogItem(catalog, entry.url);
    if (!item || !itemMentions(item, names)) continue;
    for (const source of expandedSources(item)) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }

  return sources;
}

function canonicalizeType(value: string): "person" | "enterprise" | null {
  const token = value.trim().toLocaleLowerCase("es");
  if (token === "person" || token === "persona" || token === "individual") {
    return "person";
  }
  if (
    token === "enterprise" ||
    token === "empresa" ||
    token === "company" ||
    token === "organizacion" ||
    token === "organización" ||
    token === "organization"
  ) {
    return "enterprise";
  }
  return null;
}

function isFieldKey(value: unknown): value is IdentityFieldKey {
  return typeof value === "string" && FIELD_KEYS.has(value);
}

function isFieldStatus(value: unknown): value is IdentityFieldStatus {
  return (
    value === "found" ||
    value === "not_found" ||
    value === "conflicting" ||
    value === "alleged"
  );
}

function notFoundField(key: IdentityFieldKey): IdentityField {
  return emptyIdentityField(key);
}

function isShortAlias(value: string): boolean {
  if (/\b(acusad|accused|sentenc|condenad)\b/i.test(value)) return false;
  const words = value.trim().split(/\s+/);
  return words.length > 0 && words.length <= 5;
}

function normalizeField(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
  names: readonly string[],
): IdentityField | null {
  if (!isRecord(value) || !isFieldKey(value.key)) return null;
  const key = value.key;
  const sources = readSources(value.sources, catalog, names);
  let status = isFieldStatus(value.status) ? value.status : null;
  let fieldValue = readLooseValue(value.value);

  if (key === "type" && fieldValue) {
    fieldValue = canonicalizeType(fieldValue);
  }
  if (key === "occupation" && fieldValue) {
    fieldValue = pickSingleOccupation(fieldValue);
  }
  if (key === "aliases" && fieldValue && !isShortAlias(fieldValue)) {
    return notFoundField(key);
  }

  if (fieldValue === null || sources.length === 0 || status === "not_found") {
    return notFoundField(key);
  }

  if (status === null) status = "found";

  return {
    key,
    label: identityFieldLabel(key),
    value: fieldValue,
    status,
    sources,
    note: readNote(value.note),
    score: null,
    confidence: null,
  };
}

function uniqueId(raw: string | null, index: number, used: Set<string>): string {
  const seed = raw?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || `c${index + 1}`;
  let id = seed;
  let suffix = 2;
  while (used.has(id)) {
    id = `${seed}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function normalizeCandidates(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
  consultedName: string,
): IdentityCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const used = new Set<string>();
  const candidates: IdentityCandidate[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const label = clip(entry.label, 180);
    if (!label) continue;
    const description = clip(entry.description, 500) ?? "";
    const byKey = new Map<IdentityFieldKey, IdentityField>();
    const names = [label, consultedName];

    if (Array.isArray(entry.fields)) {
      for (const field of entry.fields) {
        const normalized = normalizeField(field, catalog, names);
        if (normalized) byKey.set(normalized.key, normalized);
      }
    }

    candidates.push({
      id: uniqueId(clip(entry.id, 40), candidates.length, used),
      label,
      description,
      fields: IDENTITY_FIELD_KEYS.map((key) => byKey.get(key) ?? notFoundField(key)),
    });

    if (candidates.length === MAX_CANDIDATES) break;
  }

  return candidates;
}

function readAction(value: unknown): "continue" | "stop" | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLocaleLowerCase("es").replace(/[.!]+$/g, "");
  if (token === "stop" || token === "detener" || token === "parar" || token === "finalizar") {
    return "stop";
  }
  if (token === "continue" || token === "continuar" || token === "seguir") return "continue";
  return null;
}

function readDecision(
  value: unknown,
  priorQueries: Set<string>,
): IdentityDecision | null {
  if (!isRecord(value)) return null;
  const action = readAction(value.action);
  if (!action) return null;
  const reason = clip(value.reason, 500) ?? "";
  const nextQueries: IdentityToolQuery[] = [];

  if (action === "continue" && Array.isArray(value.nextQueries)) {
    for (const entry of value.nextQueries) {
      const directed = readDirectedQuery(entry);
      if (!directed) continue;
      const key = queryKey(directed.query, directed.tool);
      if (priorQueries.has(key)) continue;
      if (nextQueries.some((item) => queryKey(item.query, item.tool) === key)) continue;
      nextQueries.push(directed);
      if (nextQueries.length === MAX_PLAN_QUERIES) break;
    }
  }

  if (action === "continue" && nextQueries.length === 0) {
    return { action: "stop", reason, nextQueries: [] };
  }

  return {
    action,
    reason,
    nextQueries: action === "continue" ? nextQueries : [],
  };
}

function readRoundUpdate(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
  priorQueries: Set<string>,
  consultedName: string,
): { candidates: IdentityCandidate[]; decision: IdentityDecision } | null {
  const payload = unwrapPayload(value, "round");
  if (!isRecord(payload)) return null;
  const candidates = Array.isArray(payload.candidates)
    ? (normalizeCandidates(payload.candidates, catalog, consultedName) ?? [])
    : [];
  const decision = readDecision(payload.decision, priorQueries) ?? {
    action: "stop",
    reason: clip(isRecord(payload.decision) ? payload.decision.reason : null, 500) ?? "",
    nextQueries: [],
  };
  return { candidates, decision };
}

function toSearchItem(
  source: IdentitySource,
  item: { title: string; url: string; snippet?: string; publishedDate?: string; license?: string },
): IdentitySearchItem | null {
  const title = item.title.trim();
  const url = item.url.trim();
  if (!title || !url || !urlKey(url)) return null;
  return {
    source,
    title,
    url,
    ...(item.snippet ? { snippet: item.snippet } : {}),
    ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
    ...(item.license ? { license: item.license } : {}),
  };
}

async function searchIdentityQuery(
  env: GeneralEnv,
  directed: IdentityToolQuery,
): Promise<IdentityQueryResult> {
  if (directed.tool === "bd") {
    const items = await searchSavedClaims(env.DB, directed.query, SEARCH_LIMIT);
    return {
      query: directed.query,
      tool: "bd",
      items,
      errors: env.DB
        ? []
        : [
            {
              source: "bd",
              code: "db_unavailable",
              message: "La base de investigaciones no está disponible.",
            },
          ],
    };
  }

  const sources: Array<"tavily" | "wikidata"> =
    directed.tool === null ? ["tavily", "wikidata"] : [directed.tool];

  const results = await Promise.all(
    sources.map((source) =>
      source === "tavily"
        ? searchTavily(env, directed.query, {
            limit: SEARCH_LIMIT,
            includeRawContent: false,
            timeoutMs: SEARCH_TIMEOUT_MS,
            ...(wantsNews(directed.purpose) ? { topic: "news" as const } : {}),
          })
        : searchWikidata(env, directed.query, {
            limit: SEARCH_LIMIT,
            timeoutMs: SEARCH_TIMEOUT_MS,
          }),
    ),
  );

  const items: IdentitySearchItem[] = [];
  const errors: IdentityQueryResult["errors"] = [];

  for (const result of results) {
    if (!result.ok && result.error) {
      errors.push({
        source: result.source,
        code: result.error.code,
        message: result.error.message,
      });
    }
    for (const item of result.items) {
      const searchItem = toSearchItem(result.source, item);
      if (searchItem) items.push(searchItem);
    }
  }

  return {
    query: directed.query,
    tool: directed.tool,
    items,
    errors,
  };
}

function hasTerm(text: string, term: string): boolean {
  const hay = text.toLocaleLowerCase("es");
  const needle = term.toLocaleLowerCase("es");
  if (!needle) return false;
  const word = /[\p{L}\p{N}]/u;
  let from = 0;
  while (from <= hay.length - needle.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : hay.charAt(at - 1);
    const afterAt = at + needle.length;
    const after = afterAt >= hay.length ? "" : hay.charAt(afterAt);
    if (!word.test(before) && !word.test(after)) return true;
    from = at + 1;
  }
  return false;
}

function mentionedFieldKeys(text: string): IdentityFieldKey[] {
  const found = IDENTITY_FIELD_KEYS.filter((key) =>
    FIELD_TERMS[key].some((term) => hasTerm(text, term)),
  );
  if (found.includes("socialName") && found.includes("name")) {
    return found.filter((key) => key !== "name");
  }
  return found;
}

function primaryField(keys: readonly IdentityFieldKey[]): IdentityFieldKey | null {
  for (const key of FIELD_TARGET_ORDER) {
    if (keys.includes(key)) return key;
  }
  return keys[0] ?? null;
}

function missingFieldKeys(candidates: IdentityCandidate[]): IdentityFieldKey[] {
  if (candidates.length === 0) return [...IDENTITY_FIELD_KEYS];
  const missing = new Set<IdentityFieldKey>();
  for (const candidate of candidates) {
    for (const field of candidate.fields) {
      if (field.status === "not_found") missing.add(field.key);
    }
  }
  return IDENTITY_FIELD_KEYS.filter((key) => missing.has(key));
}

function formatMissing(keys: readonly IdentityFieldKey[]): string {
  if (keys.length === 0) return "Ningún campo sigue en not_found.";
  return keys.map((key) => `${key} / ${identityFieldLabel(key)}`).join(", ");
}

function fieldPurpose(key: IdentityFieldKey): string {
  return `Busca ${key} / ${identityFieldLabel(key)}.`;
}

type SubjectKind = "person" | "enterprise" | "unknown";

const NEWS_PERSON_FIELDS = new Set<IdentityFieldKey>([
  "occupation",
  "aliases",
  "dateOfBirth",
  "nationality",
]);

function wantsNews(purpose: string | undefined): boolean {
  return /noticiero|noticia/i.test(purpose ?? "");
}

function subjectKind(candidates: IdentityCandidate[]): SubjectKind {
  const kinds = new Set<"person" | "enterprise">();
  for (const candidate of candidates) {
    const type = candidate.fields.find((field) => field.key === "type");
    if (type?.status !== "found") continue;
    if (type.value === "person" || type.value === "enterprise") kinds.add(type.value);
  }
  if (kinds.size !== 1) return "unknown";
  return kinds.has("person") ? "person" : "enterprise";
}

/**
 * Primera ola: solo el tipo. Después, noticieros si es persona y registros
 * públicos si es empresa. Si el tipo sigue sin resolverse, no se pide un NIT.
 */
function followUpQueries(
  name: string,
  kind: SubjectKind,
  missing: readonly IdentityFieldKey[],
  prior: Set<string>,
): IdentityToolQuery[] {
  if (kind === "unknown") {
    const query = clip(`${name} persona o empresa`, 300);
    if (!query) return [];
    const directed: IdentityToolQuery = {
      query,
      tool: "tavily",
      purpose: "type / Tipo. Distingue si es persona o empresa.",
    };
    return prior.has(queryKey(directed.query, directed.tool)) ? [] : [directed];
  }

  const order = kind === "person" ? PERSON_FIELDS : ENTERPRISE_FIELDS;
  const queries: IdentityToolQuery[] = [];
  for (const key of order) {
    if (!missing.includes(key)) continue;
    const news = kind === "person" && NEWS_PERSON_FIELDS.has(key);
    const term = news && key === "occupation" ? "cargo" : FIELD_SEARCH_TERM[key];
    const query = clip(`${name} ${term}`, 300);
    if (!query) continue;
    const directed: IdentityToolQuery = {
      query,
      tool: "tavily",
      purpose: news
        ? `${fieldPurpose(key)} Noticieros.`
        : `${fieldPurpose(key)} Registro público.`,
    };
    if (prior.has(queryKey(directed.query, directed.tool))) continue;
    queries.push(directed);
    if (queries.length === 4) break;
  }
  return queries;
}

function kindReason(kind: SubjectKind): string {
  if (kind === "person") {
    return "Es una persona. Lo que falta se busca en noticieros y en registros públicos.";
  }
  if (kind === "enterprise") {
    return "Es una empresa. Lo que falta se busca en registros públicos.";
  }
  return "Todavía no está claro si es persona o empresa.";
}

function finishRound(
  round: number,
  base: IdentityDecision,
  candidates: IdentityCandidate[],
  subject: string,
  priorQueries: Set<string>,
): { decision: IdentityDecision; next: IdentityToolQuery[] } {
  if (round >= MAX_ROUNDS) {
    return { decision: { action: "stop", reason: base.reason, nextQueries: [] }, next: [] };
  }
  const kind = subjectKind(candidates);
  const next = followUpQueries(subject, kind, missingFieldKeys(candidates), priorQueries);
  if (next.length === 0) {
    return { decision: { action: "stop", reason: base.reason, nextQueries: [] }, next: [] };
  }
  return {
    decision: { action: "continue", reason: kindReason(kind), nextQueries: next },
    next,
  };
}

function aimPlan(plan: IdentityPlan, name: string): IdentityPlan {
  const consulted = clip(name, 300) ?? name;
  return {
    interpretation: plan.interpretation,
    queries: [
      {
        query: consulted,
        tool: "wikidata",
        purpose: "type / Tipo. Determina si es persona o empresa.",
      },
      {
        query: consulted,
        tool: "tavily",
        purpose: "type / Tipo. Figura pública en noticieros.",
      },
    ],
  };
}

function planPrompt(name: string, details?: string, interest?: string): string {
  return [
    `Nombre consultado: ${name}`,
    journalistDetailNote(details),
    interest
      ? `Interés de investigación del periodista, no es evidencia: ${interest}. Úsalo solo para desambiguar al sujeto, no para inventar campos.`
      : "Sin interés de investigación específico.",
    "Diccionario de herramientas. Elige una por consulta. No inventes otra:",
    IDENTITY_TOOLS_JSON,
    "Diccionario de datos que cada consulta debe intentar encontrar. purpose nombra la clave. No inventes los valores:",
    IDENTITY_FIELDS_JSON,
    "Primero hay que saber si es persona o empresa. No pidas NIT, razón social ni cargo en el plan.",
    'Cada query lleva "tool": "wikidata", "tavily" o "bd" y purpose "type / Tipo".',
    "Puedes añadir primero una consulta a bd con el nombre exacto, para reutilizar investigaciones guardadas.",
    "La consulta de wikidata es el nombre exacto. La de tavily es el mismo nombre, para noticieros.",
    "Devuelve solo el JSON del plan.",
  ].join("\n");
}

function roundPrompt(input: {
  name: string;
  details?: string;
  interest?: string;
  round: number;
  searches: IdentityQueryResult[];
  candidates: IdentityCandidate[];
}): string {
  const missing = formatMissing(missingFieldKeys(input.candidates));
  const lines = [
    `Nombre consultado: ${input.name}`,
    journalistDetailNote(input.details),
    input.interest
      ? `Interés de investigación del periodista, no es evidencia: ${input.interest}. Úsalo solo para desambiguar al sujeto, no para inventar campos.`
      : "Sin interés de investigación específico.",
    `Ronda ${input.round} de ${MAX_ROUNDS}.`,
    input.round === MAX_ROUNDS
      ? 'Esta es la última ronda. decision.action debe ser "stop" y nextQueries debe ser [].'
      : "Si type ya es person, nextQueries van a noticieros (cargo, alias, nacimiento, nacionalidad) y el DPI queda en registros. Si type es enterprise, nextQueries van a registros (NIT, razón social, dirección, sitio, teléfono). Si type sigue unknown, una sola nextQuery distingue persona o empresa.",
    "Diccionario de herramientas. Elige una por nextQuery. No inventes otra:",
    IDENTITY_TOOLS_JSON,
    "Diccionario de datos. No inventes un valor que no esté en los resultados:",
    IDENTITY_FIELDS_JSON,
    `Campos que siguen en not_found: ${missing}.`,
    "Cada nextQuery apunta a uno de esos campos. Una figura pública se rastrea en noticieros. Una empresa, en registros públicos. No mezcles esos caminos.",
    "Si un valor no es lo que el campo parece, pon note en ese campo. Ejemplo: la dirección es de una oficina y no del domicilio.",
    "Si una fuente nombra a la entidad, el candidato es obligatorio. Los campos que la fuente no trae siguen en not_found. No inventes el valor.",
    'Si action es "continue", nextQueries es una lista de objetos {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"wikidata"}, {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"tavily"} o {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"bd"}.',
    "",
    "Candidatos actuales:",
    JSON.stringify(input.candidates),
    "",
    "Cada persona, empresa o institución nombrada aquí es un candidato, aunque falte el NIT o el documento.",
    "Resultados de esta ronda. sources.url solo puede ser una de estas URLs:",
  ];

  for (const search of input.searches) {
    lines.push("", `Consulta: ${search.query}`);
    lines.push(
      search.tool
        ? `Herramienta usada: ${search.tool}`
        : "Herramienta ausente o inválida: se buscó en wikidata y en tavily.",    );
    for (const error of search.errors) {
      lines.push(`Error ${error.source}: ${error.message}`);
    }
    if (search.items.length === 0) lines.push("Sin resultados.");
    for (const item of search.items) {
      lines.push(`- source: ${item.source}`);
      lines.push(`  title: ${item.title}`);
      lines.push(`  url: ${item.url}`);
      if (item.snippet) lines.push(`  snippet: ${item.snippet.slice(0, 280)}`);
      if (item.publishedDate) lines.push(`  publishedDate: ${item.publishedDate}`);
      if (item.license) lines.push(`  license: ${item.license}`);
    }
  }

  lines.push("", "Devuelve solo el JSON con candidates y decision.");
  return lines.join("\n");
}

function dedupeQueries(
  queries: IdentityToolQuery[],
  prior: Set<string>,
): IdentityToolQuery[] {
  const next: IdentityToolQuery[] = [];
  for (const item of queries) {
    const cleaned = clip(item.query, 300);
    if (!cleaned) continue;
    const directed: IdentityToolQuery = item.purpose
      ? { query: cleaned, tool: item.tool, purpose: item.purpose }
      : { query: cleaned, tool: item.tool };
    const key = queryKey(directed.query, directed.tool);
    if (
      prior.has(key) ||
      next.some((existing) => queryKey(existing.query, existing.tool) === key)
    ) {
      continue;
    }
    next.push(directed);
  }
  return next;
}

function sourceRef(item: IdentitySearchItem): IdentitySourceRef {
  return { source: item.source, title: item.title, url: item.url };
}

/**
 * Un resultado de `bd` no se cita como fuente: se expande a las fuentes
 * originales con las que se guardó la afirmación.
 */
function expandedSources(item: IdentitySearchItem): IdentitySourceRef[] {
  if (item.source === "bd" && item.saved && item.saved.sources.length > 0) {
    return item.saved.sources;
  }
  return [sourceRef(item)];
}

function mentionsName(text: string | undefined, name: string): boolean {
  if (!text) return false;
  return text.toLocaleLowerCase("es").includes(name.toLocaleLowerCase("es"));
}

const SKIPPED_SITE_HOST =
  /(^|\.)(wikipedia|wikidata|facebook|instagram|twitter|x|youtube|tiktok|linkedin|tavily|google|bing)\.[a-z.]+$/i;

function siteOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[),.;]+$/g, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (SKIPPED_SITE_HOST.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = value.toLocaleLowerCase("es").replace(/\s+/g, "");
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

function pullPhones(text: string): string[] {
  const values: string[] = [];
  const re = /(?:\+\s?502[\s.-]*)?(?:\(?\d{3,4}\)?[\s.-]+)\d{3,4}(?:[\s.-]+\d{2,4})?/g;
  for (const match of text.matchAll(re)) {
    const raw = match[0].replace(/\s+/g, " ").trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    values.push(raw);
  }
  return uniqueTexts(values);
}

function pullNits(text: string): string[] {
  const values: string[] = [];
  const re = /NIT(?:\s*(?:\/\s*ID)?\s*)[:\s-]*([0-9][0-9.\s]{3,16}[0-9](?:\s*-\s*[0-9kK])?)/gi;
  for (const match of text.matchAll(re)) {
    const compact = match[1].replace(/[\s.]+/g, "");
    const digits = compact.replace(/\D/g, "");
    if (digits.length < 5 || digits.length > 12) continue;
    values.push(compact);
  }
  return uniqueTexts(values);
}

function pullEmails(text: string): string[] {
  return uniqueTexts(
    [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]),
  );
}

function pullAddresses(text: string): string[] {
  const match = text.match(
    /((?:avenida|av\.|calle|zona|boulevard|blvd\.|kilómetro|km\.)\s+[^.;\n]{8,140})/i,
  );
  const value = match ? clip(match[1], 180) : null;
  return value ? [value] : [];
}

function pullWebsites(text: string, itemUrl: string): string[] {
  const fromText = uniqueTexts(
    [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)]
      .map((match) => siteOrigin(match[0]))
      .filter((value): value is string => value !== null),
  );
  if (fromText.length > 0) return fromText;
  try {
    if (/\.gob\.gt$/i.test(new URL(itemUrl).hostname)) {
      const own = siteOrigin(itemUrl);
      return own ? [own] : [];
    }
  } catch {
    return [];
  }
  return [];
}

function pullLabeled(text: string, label: RegExp): string[] {
  const match = text.match(label);
  const value = match ? clip(match[1], 180) : null;
  return value ? [value] : [];
}

function pullAliases(text: string): string[] {
  const values: string[] = [];
  const re = /(?:siglas?|alias)\s*(?:es|:)\s*["“]?([A-ZÁÉÍÓÚ][^.;\n]{1,40})/g;
  for (const match of text.matchAll(re)) {
    const value = clip(match[1], 40);
    if (value && isShortAlias(value)) values.push(value);
  }
  return uniqueTexts(values);
}

function pullType(text: string): string[] {
  const person =
    /\b(nacido|nació|nacida|ciudadano|ciudadana|político|política|politico|politica|diputado|diputada|alcalde|alcaldesa|periodista|abogado|abogada)\b/i.test(
      text,
    );
  const enterprise =
    /\b(banco|empresa|institución|institucion|sociedad|ministerio|municipalidad|organización|organizacion)\b/i.test(
      text,
    );
  if (person === enterprise) return [];
  return person ? ["person"] : ["enterprise"];
}

function evidenceValues(key: IdentityFieldKey, item: IdentitySearchItem): string[] {
  const text = `${item.title}\n${item.snippet ?? ""}`;
  switch (key) {
    case "website":
      return pullWebsites(text, item.url);
    case "phone":
      return pullPhones(text);
    case "email":
      return pullEmails(text);
    case "taxesID":
      return pullNits(text);
    case "nationalID":
      return uniqueTexts(
        [...text.matchAll(/(?:CUI|DPI)[:\s]*(\d{13})/gi)].map((match) => match[1]),
      );
    case "address":
      return pullAddresses(text);
    case "type":
      return item.source === "wikidata" ? pullType(text) : [];
    case "socialName":
      return pullLabeled(text, /raz[oó]n social[:\s]+([^.;\n]{3,120})/i);
    case "legalRepresentative":
      return pullLabeled(text, /representante legal[:\s]+([^.;\n]{3,80})/i);
    case "incorporationDate":
      return pullLabeled(
        text,
        /(?:constitu\w+|fundad\w+)[^.]{0,40}(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+de\s+\d{4}|\d{4})/i,
      );
    case "aliases":
      return pullAliases(text);
    case "nationality":
      return pullLabeled(text, /nacionalidad[:\s]+([^.;\n]{3,40})/i);
    case "dateOfBirth":
      return pullLabeled(text, /(?:fecha de nacimiento|naci[oó]|nacida)[:\s]+([^.;\n]{4,40})/i);
    case "occupation":
      return pullLabeled(text, /(?:ocupaci[oó]n|cargo)\s*:\s*([^.;\n]{3,80})/i);
    default:
      return [];
  }
}

function sourcedField(
  key: IdentityFieldKey,
  pairs: Array<{ value: string; item: IdentitySearchItem }>,
): IdentityField | null {
  const grouped = new Map<string, { value: string; items: IdentitySearchItem[] }>();
  for (const pair of pairs) {
    const id = pair.value.toLocaleLowerCase("es").replace(/\s+/g, "");
    const current = grouped.get(id);
    if (current) current.items.push(pair.item);
    else grouped.set(id, { value: pair.value, items: [pair.item] });
  }
  if (grouped.size === 0) return null;
  const entries = [...grouped.values()];
  const sources: IdentitySourceRef[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const item of entry.items) {
      for (const source of expandedSources(item)) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
        if (sources.length === 5) break;
      }
      if (sources.length === 5) break;
    }
    if (sources.length === 5) break;
  }
  if (sources.length === 0) return null;
  const occupation =
    key === "occupation" ? pickSingleOccupation(entries[0]?.value) : null;
  const value =
    occupation ??
    (entries.length === 1
      ? entries[0].value
      : entries
          .map((entry) => entry.value)
          .join(" · ")
          .slice(0, 500));
  if (!value) return null;
  return {
    key,
    label: identityFieldLabel(key),
    value,
    status:
      occupation || entries.length === 1 ? "found" : "conflicting",
    sources,
    note: null,
    score: null,
    confidence: null,
  };
}

/**
 * Completa campos not_found con un valor escrito en la búsqueda de ese campo.
 * No pisa un valor que el modelo ya dejó en found o conflicting.
 */
function fillFromSearches(
  candidates: IdentityCandidate[],
  name: string,
  queries: IdentityToolQuery[],
  searches: IdentityQueryResult[],
): IdentityCandidate[] {
  return candidates.map((candidate) => {
    const label = candidate.label || name;
    let next = candidate;
    const buckets = new Map<IdentityFieldKey, Array<{ value: string; item: IdentitySearchItem }>>();

    const add = (key: IdentityFieldKey, item: IdentitySearchItem, values: string[]) => {
      const bucket = buckets.get(key) ?? [];
      for (const value of values) bucket.push({ value, item });
      buckets.set(key, bucket);
    };

    searches.forEach((search, index) => {
      const target = primaryField(
        queries[index]?.purpose ? mentionedFieldKeys(queries[index].purpose ?? "") : [],
      );
      if (!target || target === "name") return;
      const about = search.items.filter(
        (item) =>
          mentionsName(item.title, label) ||
          mentionsName(item.snippet, label) ||
          mentionsName(item.title, name) ||
          mentionsName(item.snippet, name),
      );
      for (const item of about) {
        add(target, item, evidenceValues(target, item));
      }
    });

    for (const search of searches) {
      for (const item of search.items) {
        if (item.source !== "wikidata") continue;
        if (
          !mentionsName(item.title, label) &&
          !mentionsName(item.snippet, label) &&
          !mentionsName(item.title, name) &&
          !mentionsName(item.snippet, name)
        ) {
          continue;
        }
        add("type", item, evidenceValues("type", item));
      }
    }

    for (const [key, pairs] of buckets) {
      const field = sourcedField(key, pairs);
      if (!field) continue;
      next = {
        ...next,
        fields: next.fields.map((current) =>
          current.key === key && current.status === "not_found" ? field : current,
        ),
      };
    }
    return next;
  });
}

function stopDecision(reason: string): IdentityDecision {
  return { action: "stop", reason, nextQueries: [] };
}

function foundField(
  key: IdentityFieldKey,
  value: string,
  sources: IdentitySourceRef[],
): IdentityField {
  return {
    key,
    label: identityFieldLabel(key),
    value,
    status: "found",
    sources,
    note: null,
    score: null,
    confidence: null,
  };
}

function profileFromName(
  id: string | null,
  label: string,
  description: string,
  name: string,
  sources: IdentitySourceRef[],
  used: Set<string>,
): IdentityCandidate {
  return {
    id: uniqueId(id, used.size, used),
    label,
    description,
    fields: IDENTITY_FIELD_KEYS.map((key) =>
      key === "name" ? foundField(key, name, sources) : notFoundField(key),
    ),
  };
}

/**
 * Si el modelo cierra sin candidatos, igual devolvemos las entidades que
 * las búsquedas ya nombraron. Wikidata trae una por resultado. Si no hubo
 * ninguna, el nombre consultado queda sostenido por las páginas de Tavily
 * que lo mencionan. Ningún otro campo se rellena.
 */
function candidatesFromPublicResults(
  name: string,
  rounds: IdentityRound[],
): IdentityCandidate[] {
  const nameKey = name.toLocaleLowerCase("es");
  const tagged: Array<{ query: string; item: IdentitySearchItem }> = [];
  const seen = new Set<string>();

  for (const round of rounds) {
    for (const search of round.searches) {
      for (const item of search.items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        tagged.push({ query: search.query, item });
      }
    }
  }

  const wikidata = tagged.filter((entry) => entry.item.source === "wikidata");
  const mentioned = wikidata.filter(
    (entry) =>
      mentionsName(entry.item.title, name) || mentionsName(entry.item.snippet, name),
  );
  const fromExactName = wikidata.filter(
    (entry) => entry.query.toLocaleLowerCase("es") === nameKey,
  );
  const pool = mentioned.length > 0 ? mentioned : fromExactName;
  const wikidataItems: IdentitySearchItem[] = [];
  const wikidataSeen = new Set<string>();

  for (const entry of pool) {
    if (wikidataSeen.has(entry.item.url)) continue;
    wikidataSeen.add(entry.item.url);
    wikidataItems.push(entry.item);
  }

  wikidataItems.sort((left, right) => {
    const leftExact = left.title.toLocaleLowerCase("es") === nameKey ? 1 : 0;
    const rightExact = right.title.toLocaleLowerCase("es") === nameKey ? 1 : 0;
    return rightExact - leftExact;
  });

  const used = new Set<string>();
  if (wikidataItems.length > 0) {
    return wikidataItems.slice(0, MAX_CANDIDATES).map((item) => {
      const id = item.url.match(/\/wiki\/(Q\d+)/)?.[1] ?? null;
      return profileFromName(
        id,
        item.title,
        clip(item.snippet, 500) ?? "",
        item.title,
        [sourceRef(item)],
        used,
      );
    });
  }

  const supporting = tagged
    .filter(
      (entry) =>
        entry.item.source === "tavily" &&
        (mentionsName(entry.item.title, name) || mentionsName(entry.item.snippet, name)),
    )
    .slice(0, MAX_CANDIDATES);
  if (supporting.length === 0) return [];

  const description =
    supporting
      .map((entry) => clip(entry.item.snippet, 500))
      .find((snippet): snippet is string => snippet !== null && mentionsName(snippet, name)) ??
    "";

  return [
    profileFromName(
      null,
      name,
      description,
      name,
      supporting.map((entry) => sourceRef(entry.item)),
      used,
    ),
  ];
}

function ensureCandidates(
  current: IdentityCandidate[],
  name: string,
  rounds: IdentityRound[],
): IdentityCandidate[] {
  return current.length > 0 ? current : candidatesFromPublicResults(name, rounds);
}

async function runInvestigation(
  env: GeneralEnv,
  name: string,
  details?: string,
  interest?: string,
): Promise<IdentityInvestigationResponse> {
  const subject = name.trim();
  const context = details?.trim() || undefined;
  const focus = interest?.trim() || undefined;

  if (!subject) {
    return emptyResult({
      code: "missing_parameter",
      message: 'Se requiere "name".',
    });
  }
  if (subject.length > IDENTITY_NAME_MAX) {
    return emptyResult({
      code: "invalid_parameter",
      message: `"name" no puede superar ${IDENTITY_NAME_MAX} caracteres.`,
    });
  }
  if (context && context.length > IDENTITY_DETAILS_MAX) {
    return emptyResult({
      code: "invalid_parameter",
      message: `"details" no puede superar ${IDENTITY_DETAILS_MAX} caracteres.`,
    });
  }
  if (focus && focus.length > IDENTITY_INTEREST_MAX) {
    return emptyResult({
      code: "invalid_parameter",
      message: `"interest" no puede superar ${IDENTITY_INTEREST_MAX} caracteres.`,
    });
  }

  const planCall = await callOpenRouter(
    env,
    [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: planPrompt(subject, context, focus) },
    ],
    modelCallOptions(env, PLAN_MAX_TOKENS),
  );

  if (!planCall.ok) {
    logModelFailure("plan", planCall.attempts, planCall.error?.code);
    return emptyResult(
      fromGeneralError(planCall.error, "No se pudo generar el plan de búsqueda."),
    );
  }

  const planJson = await parseModelJson(env, planCall.text, PLAN_MAX_TOKENS);
  if (!planJson.ok) {
    return emptyResult(
      fromGeneralError(planJson.error, "El plan de búsqueda no llegó en JSON válido."),
    );
  }

  const parsedPlan = readPlan(planJson.value);
  const plan = parsedPlan ? aimPlan(parsedPlan, subject) : null;
  if (!plan) {
    return emptyResult({
      code: "invalid_plan",
      message: "El plan de búsqueda no incluyó consultas utilizables.",
    });
  }

  const catalog = new Map<string, IdentitySearchItem>();
  const priorQueries = new Set<string>();
  let queries: IdentityToolQuery[] = plan.queries.map((item) => ({
    query: item.query,
    tool: item.tool,
    purpose: item.purpose,
  }));
  let candidates: IdentityCandidate[] = [];
  const rounds: IdentityRound[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const roundQueries = dedupeQueries(queries, priorQueries);
    if (roundQueries.length === 0) break;
    for (const item of roundQueries) priorQueries.add(queryKey(item.query, item.tool));

    const searches = await Promise.all(
      roundQueries.map((item) => searchIdentityQuery(env, item)),
    );
    for (const search of searches) addToCatalog(catalog, search.items);

    const roundCall = await callOpenRouter(
      env,
      [
        { role: "system", content: ROUND_SYSTEM },
        {
          role: "user",
          content: roundPrompt({
            name: subject,
            details: context,
            interest: focus,
            round,
            searches,
            candidates,
          }),
        },
      ],
      modelCallOptions(env, ROUND_MAX_TOKENS),
    );

    const baseDecision = !roundCall.ok
      ? stopDecision(
          "La ronda no pudo consultar al modelo. Los campos se leyeron de los resultados.",
        )
      : null;
    if (!roundCall.ok) {
      logModelFailure(`ronda ${round}`, roundCall.attempts, roundCall.error?.code);
    }

    const roundJson = roundCall.ok
      ? await parseModelJson(env, roundCall.text, ROUND_MAX_TOKENS)
      : null;
    const update =
      roundJson?.ok === true
        ? readRoundUpdate(roundJson.value, catalog, priorQueries, subject)
        : null;
    const seed = update?.candidates ?? candidates;
    const noted =
      baseDecision ??
      update?.decision ??
      stopDecision(
        roundJson?.ok === true
          ? "La ronda no incluyó una decisión. Los campos se leyeron de los resultados."
          : "La ronda no llegó en JSON. Los campos se leyeron de los resultados.",
      );
    const provisional: IdentityRound[] = [
      ...rounds,
      { round, queries: roundQueries, searches, decision: noted },
    ];
    candidates = fillFromSearches(
      ensureCandidates(seed, subject, provisional),
      subject,
      roundQueries,
      searches,
    );
    if (!roundCall.ok && candidates.length === 0) {
      rounds.push({ round, queries: roundQueries, searches, decision: noted });
      return {
        plan,
        rounds,
        candidates,
        error: fromGeneralError(
          roundCall.error,
          "No se pudieron actualizar los candidatos.",
        ),
      };
    }

    const step = finishRound(round, noted, candidates, subject, priorQueries);
    rounds.push({ round, queries: roundQueries, searches, decision: step.decision });
    if (step.decision.action === "stop") break;
    queries = step.next;
  }

  return {
    plan,
    rounds,
    candidates: await applyResultScores(
      env,
      ensureCandidates(candidates, subject, rounds),
      rounds,
    ),
  };
}

function collectScoreableResults(
  candidates: IdentityCandidate[],
  rounds: IdentityRound[],
): ResultToScore[] {
  const byUrl = new Map<string, ResultToScore>();
  const add = (url: string, title: string, snippet?: string) => {
    const current = byUrl.get(url);
    if (current) {
      if (!current.snippet && snippet) current.snippet = snippet;
      return;
    }
    byUrl.set(url, snippet ? { url, title, snippet } : { url, title });
  };

  for (const round of rounds) {
    for (const search of round.searches) {
      for (const item of search.items) add(item.url, item.title, item.snippet);
    }
  }
  for (const candidate of candidates) {
    for (const field of candidate.fields) {
      for (const source of field.sources) add(source.url, source.title);
    }
  }
  return [...byUrl.values()];
}

/**
 * El puntaje no rellena datos. Solo marca cada resultado y, con eso,
 * decide si el dato que ya escribió la investigación se muestra.
 */
async function applyResultScores(
  env: GeneralEnv,
  candidates: IdentityCandidate[],
  rounds: IdentityRound[],
): Promise<IdentityCandidate[]> {
  const scored = await scoreResults(env, collectScoreableResults(candidates, rounds), {
    models: identityModels(env),
    timeoutMs: MODEL_TIMEOUT_MS,
  });
  const byUrl = new Map(scored.map((item) => [item.url, item]));

  return Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      fields: await Promise.all(
        candidate.fields.map(async (field) => {
          if (field.status === "not_found" || !field.value?.trim()) {
            return { ...field, score: null, confidence: null };
          }
          const occupation =
            field.key === "occupation"
              ? await preferStoredOccupation(env, field.value)
              : field.value;
          const sources = field.sources.map((source) => {
            const match = byUrl.get(source.url);
            if (!match) return source;
            return {
              ...source,
              tier: match.tier,
              official: match.official,
              repetition: match.repetition,
              score: match.score,
              confidence: match.confidence,
            };
          });
          const scores = sources
            .map((source) => source.score)
            .filter((score): score is number => typeof score === "number");
          let score = scores.length > 0 ? Math.max(...scores) : 1;
          if (field.status === "alleged" || field.status === "conflicting") {
            score = Math.min(score, 70);
          }
          return {
            ...field,
            value: occupation ?? field.value,
            status:
              field.key === "occupation" && occupation
                ? "found"
                : field.status,
            sources,
            score,
            confidence: confidenceForScore(score),
          };
        }),
      ),
    })),
  );
}

function extraCount(rounds: IdentityRound[]): number {
  return rounds.filter((round) => round.round > MAX_ROUNDS).length;
}

const EXTRA_FIELDS = [
  "taxesID",
  "phone",
  "email",
  "legalRepresentative",
  "address",
  "nationalID",
] as const satisfies readonly IdentityFieldKey[];

const EXTRA_TERM: Record<(typeof EXTRA_FIELDS)[number], string> = {
  taxesID: "NIT",
  phone: "teléfono",
  email: "correo",
  legalRepresentative: "representante legal",
  address: "dirección oficina",
  nationalID: "DPI",
};

function fieldNeedsExtra(field: IdentityField | undefined): boolean {
  if (!field) return true;
  return field.confidence !== "probable" && field.confidence !== "corroborated";
}

function extraQueries(
  name: string,
  candidates: IdentityCandidate[],
  prior: Set<string>,
): IdentityToolQuery[] {
  const queries: IdentityToolQuery[] = [];
  for (const key of EXTRA_FIELDS) {
    const needed =
      candidates.length === 0 ||
      candidates.some((candidate) =>
        fieldNeedsExtra(candidate.fields.find((field) => field.key === key)),
      );
    if (!needed) continue;
    const base = clip(`${name} ${EXTRA_TERM[key]}`, 300);
    const alternate = clip(`${name} ${EXTRA_TERM[key]} registro`, 300);
    const query =
      base && !prior.has(queryKey(base, "tavily"))
        ? base
        : alternate && !prior.has(queryKey(alternate, "tavily"))
          ? alternate
          : null;
    if (!query) continue;
    queries.push({
      query,
      tool: "tavily",
      purpose: `${fieldPurpose(key)} Registro público. La dirección puede ser una oficina.`,
    });
  }
  return queries;
}

function mergeExtraCandidates(
  previous: IdentityCandidate[],
  incoming: IdentityCandidate[],
): IdentityCandidate[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;
  return previous.map((candidate) => {
    const update =
      incoming.find((item) => item.id === candidate.id) ??
      incoming.find((item) => item.label === candidate.label);
    if (!update) return candidate;
    return {
      ...candidate,
      description: update.description || candidate.description,
      fields: candidate.fields.map((field) => {
        const next = update.fields.find((item) => item.key === field.key);
        if (!next || next.status === "not_found" || next.sources.length === 0) return field;
        if (field.confidence === "probable" || field.confidence === "corroborated") return field;
        return { ...next, note: next.note ?? field.note, score: null, confidence: null };
      }),
    };
  });
}

function extraPrompt(input: {
  name: string;
  details?: string;
  interest?: string;
  searches: IdentityQueryResult[];
  candidates: IdentityCandidate[];
}): string {
  const lines = [
    `Nombre consultado: ${input.name}`,
    journalistDetailNote(input.details),
    input.interest
      ? `Interés de investigación del periodista, no es evidencia: ${input.interest}. Úsalo solo para desambiguar al sujeto, no para inventar campos.`
      : "Sin interés de investigación específico.",
    "Búsqueda extra. Completa solo NIT, teléfono, correo, representante legal, dirección y documento nacional.",
    "Una dirección de oficina vale. Si lo es, escribe note. Si no hace falta aclarar, omite note.",
    "No inventes valores. Si el resultado no trae el dato, omite el campo.",
    'decision.action es "stop" y nextQueries es [].',
    "",
    "Candidatos actuales:",
    JSON.stringify(input.candidates),
    "",
    "Resultados de esta búsqueda. sources.url solo puede ser una de estas URLs:",
  ];
  for (const search of input.searches) {
    lines.push("", `Consulta: ${search.query}`);
    if (search.items.length === 0) lines.push("Sin resultados.");
    for (const item of search.items) {
      lines.push(`- source: ${item.source}`);
      lines.push(`  title: ${item.title}`);
      lines.push(`  url: ${item.url}`);
      if (item.snippet) lines.push(`  snippet: ${item.snippet.slice(0, 280)}`);
    }
  }
  lines.push("", "Devuelve solo el JSON con candidates y decision.");
  return lines.join("\n");
}

const EXTRA_SYSTEM = [
  "Eres el analista de identidad de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en los resultados de esta búsqueda extra.",
  "Solo completes taxesID (NIT), phone, email, legalRepresentative, address y nationalID (DPI o CUI).",
  "No borres ni reemplaces un dato que ya estaba. Si esta búsqueda no lo trae, omite el campo.",
  "address puede ser la oficina, no solo el domicilio. Si es una oficina, note lo dice en una frase.",
  "Cada valor found necesita sources cuya url sea una de las URLs entregadas.",
  'decision es {"action":"stop","reason":"MOTIVO","nextQueries":[]}.',
].join("\n");

export async function requestExtraIdentitySearch(
  env: GeneralEnv,
  name: string,
  details: string | undefined,
  current: IdentityInvestigation,
  interest?: string,
): Promise<IdentityInvestigationResponse> {
  const subject = name.trim();
  const context = details?.trim() || undefined;
  const focus = interest?.trim() || undefined;
  if (!subject) {
    return emptyResult({ code: "missing_parameter", message: 'Se requiere "name".' });
  }
  if (extraCount(current.rounds) >= IDENTITY_MAX_EXTRA_SEARCHES) {
    return {
      ...current,
      error: {
        code: "extra_limit",
        message: "Solo se pueden pedir dos búsquedas extra.",
      },
    };
  }

  const prior = new Set<string>();
  for (const round of current.rounds) {
    for (const query of round.queries) prior.add(queryKey(query.query, query.tool));
  }
  const roundQueries = dedupeQueries(extraQueries(subject, current.candidates, prior), prior);
  if (roundQueries.length === 0) return current;

  const searches = await Promise.all(
    roundQueries.map((item) => searchIdentityQuery(env, item)),
  );
  const catalog = new Map<string, IdentitySearchItem>();
  for (const round of current.rounds) {
    for (const search of round.searches) addToCatalog(catalog, search.items);
  }
  for (const search of searches) addToCatalog(catalog, search.items);

  const roundCall = await callOpenRouter(
    env,
    [
      { role: "system", content: EXTRA_SYSTEM },
      {
        role: "user",
        content: extraPrompt({
          name: subject,
          details: context,
          interest: focus,
          searches,
          candidates: current.candidates,
        }),
      },
    ],
    modelCallOptions(env, ROUND_MAX_TOKENS),
  );
  if (!roundCall.ok) {
    logModelFailure("búsqueda extra", roundCall.attempts, roundCall.error?.code);
  }
  const roundJson = roundCall.ok
    ? await parseModelJson(env, roundCall.text, ROUND_MAX_TOKENS)
    : null;
  const update =
    roundJson?.ok === true
      ? readRoundUpdate(roundJson.value, catalog, prior, subject)
      : null;
  const roundNumber = MAX_ROUNDS + extraCount(current.rounds) + 1;
  const decision = stopDecision(
    update?.decision.reason ||
      "Búsqueda extra de NIT, teléfono, correo, representante, dirección y documento.",
  );
  const rounds = [
    ...current.rounds,
    { round: roundNumber, queries: roundQueries, searches, decision },
  ];
  const filled = fillFromSearches(
    ensureCandidates(
      mergeExtraCandidates(current.candidates, update?.candidates ?? []),
      subject,
      rounds,
    ),
    subject,
    roundQueries,
    searches,
  );

  return {
    plan: current.plan,
    rounds,
    candidates: await applyResultScores(env, filled, rounds),
  };
}

export async function investigateIdentity(
  env: GeneralEnv,
  name: string,
  details?: string,
  interest?: string,
): Promise<IdentityInvestigationResponse> {
  try {
    return await runInvestigation(env, name, details, interest);
  } catch (error) {
    console.error(
      "[consta-api] identity",
      error instanceof Error ? error.message : "unknown",
    );
    return emptyResult({
      code: "internal_error",
      message: "La investigación de identidad no pudo completarse.",
      retryable: true,
    });
  }
}

function emptyConnectionState(): IdentityConnectionState {
  return {
    claims: [],
    rounds: [],
    summary: {
      who: "Sin contexto.",
      findings: "Todavía no hay afirmaciones probables.",
      text: "Sin contexto. Todavía no hay afirmaciones probables.",
      claims: 0,
    },
    canContinue: false,
    stoppedReason: null,
  };
}

function connectionWho(candidate: IdentityCandidate, name: string): string {
  const type = candidate.fields.find((field) => field.key === "type");
  const occupation = candidate.fields.find((field) => field.key === "occupation");
  const nationality = candidate.fields.find((field) => field.key === "nationality");
  const address = candidate.fields.find((field) => field.key === "address");

  const typeText = type?.value === "person" ? "persona" : type?.value === "enterprise" ? "empresa" : "sin tipo";
  const occupationText = occupation?.value || "sin ocupación";
  const nationalityText = nationality?.value || "sin nacionalidad";
  const addressText = address?.value || "sin dirección";

  return `${typeText}, ${occupationText}, ${nationalityText}, ${addressText}`.trim();
}

function candidateLabel(candidate: IdentityCandidate, name: string): string {
  const label = candidate.label || name;
  const nameField = candidate.fields.find((field) => field.key === "name");
  return nameField?.value || label;
}

function buildRootClaim(name: string, candidate: IdentityCandidate): IdentityClaim {
  const label = candidateLabel(candidate, name);
  const sources = candidate.fields.flatMap((field) => field.sources).slice(0, 5);
  return {
    id: "root",
    text: `El sujeto investigado es ${label}.`,
    parentId: null,
    parentText: "",
    sources,
    entities: [
      {
        id: candidate.id,
        label,
        type: profileType(candidate.fields.find((field) => field.key === "type")?.value),
        description: candidate.description,
        occupation:
          candidate.fields.find((field) => field.key === "occupation")?.value ??
          null,
        sources,
        score: null,
        confidence: null,
      },
    ],
    score: 0,
    confidence: "uncertain",
    round: 0,
  };
}

function buildSubjectEntity(
  name: string,
  candidate: IdentityCandidate,
  root: IdentityClaim,
): IdentityEntity {
  const label = candidateLabel(candidate, name);
  const type = profileType(candidate.fields.find((field) => field.key === "type")?.value);
  const sources = candidate.fields.flatMap((field) => field.sources).slice(0, 5);

  return {
    id: candidate.id,
    label,
    type,
    description: candidate.description,
    sources,
    score: null,
    confidence: null,
  };
}

/** El tipo que declara el contrato; cualquier otro valor queda en "unknown". */
function profileType(value: string | null | undefined): IdentityProfileType {
  return value === "person" || value === "enterprise" ? value : "unknown";
}

/** Misma normalización que usa la vista de conexiones para emparejar textos. */
function normalizeClaimText(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conserva el resumen acumulado: las vueltas siguientes no deben borrar el
 * hilo conductor que ya se explicó. El respaldo solo entra si el estado
 * guardado viene vacío.
 */
function resolveConnectionSummary(
  summary: IdentitySummary | undefined,
  fallback: { who: string; findings: string; text: string; claims: number },
): IdentitySummary {
  const who = summary?.who?.trim() || fallback.who;
  const findings = summary?.findings?.trim() || fallback.findings;
  return {
    who,
    findings,
    text: summary?.text?.trim() || fallback.text,
    claims:
      typeof summary?.claims === "number" && summary.claims > 0
        ? summary.claims
        : fallback.claims,
  };
}

/**
 * El modelo a veces devuelve la lista suelta y a veces dentro de su clave.
 * Sin esto, una respuesta correcta como `{ "queries": [...] }` se lee como
 * vacía y la vuelta se detiene sin buscar.
 */
function readListPayload(value: unknown, key: string): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  if (Array.isArray(value[key])) return value[key] as unknown[];
  for (const wrapper of ["plan", "result", "data", "output"] as const) {
    const nested = value[wrapper];
    if (isRecord(nested) && Array.isArray(nested[key])) {
      return nested[key] as unknown[];
    }
  }
  return null;
}

/** Texto legible de una línea de `findings`, venga como texto u objeto. */
function summaryLine(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!isRecord(value)) return null;
  for (const key of ["details", "detail", "text", "finding", "summary"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** Lee el JSON del resumen; `findings` puede llegar como lista o como texto. */
function readConnectionRoundSummary(value: unknown): IdentitySummary | null {
  const payload =
    isRecord(value) && isRecord(value.summary) ? value.summary : value;
  if (typeof payload === "string") {
    const findings = payload.trim();
    return findings ? { who: "", findings, text: findings, claims: 0 } : null;
  }
  if (!isRecord(payload)) return null;
  const raw = payload.findings ?? payload.hallazgos;
  const lines = Array.isArray(raw)
    ? raw.map(summaryLine).filter((line): line is string => Boolean(line))
    : (() => {
        const single = summaryLine(raw);
        return single ? [single] : [];
      })();
  if (lines.length === 0) {
    const fallback = summaryLine(payload.summary) ?? summaryLine(payload.text);
    if (!fallback) return null;
    lines.push(fallback);
  }
  const findings = lines.join("\n");
  const who = clip(payload.who, 400) ?? "";
  return { who, findings, text: `${who} ${findings}`.trim(), claims: 0 };
}

/**
 * Convierte las afirmaciones crudas del modelo en afirmaciones citables:
 * los índices se vuelven enlaces reales y cada afirmación se puntúa por las
 * fuentes que cita. Una afirmación sin fuentes no entra.
 */
function buildConnectionClaims(
  value: unknown,
  items: readonly IdentitySearchItem[],
  entities: readonly IdentityEntity[],
  round: number,
  prior: readonly IdentityClaim[],
): IdentityClaim[] | null {
  const raw = readConnectionClaims(value);
  if (!raw) return null;

  const subjectLabel =
    prior.find((claim) => claim.id === "root")?.entities[0]?.label ?? "";

  const claims: IdentityClaim[] = [];
  for (const claim of raw) {
    const sources = readConnectionClaimSources(claim, items);
    if (sources.length === 0) continue;
    const score = readConnectionClaimScore(claim, sources);
    const saved = claim.indexes
      .map((index) => items[index])
      .find((item) => item?.source === "bd" && item.saved)?.saved;
    claims.push({
      id: `claim-${round}-${claims.length}`,
      text: claim.text,
      parentId: null,
      parentText: claim.parentText,
      sources,
      entities: readConnectionClaimEntities(claim, entities, subjectLabel),
      score,
      confidence: confidenceForScore(score),
      round,
      ...(saved ? { saved } : {}),
    });
  }
  if (claims.length === 0) return null;

  const byText = new Map<string, string>();
  for (const claim of prior) {
    const key = normalizeClaimText(claim.text);
    if (key && !byText.has(key)) byText.set(key, claim.id);
  }
  for (const claim of claims) {
    const key = normalizeClaimText(claim.text);
    if (key && !byText.has(key)) byText.set(key, claim.id);
  }
  for (const claim of claims) {
    const key = normalizeClaimText(claim.parentText);
    const parentId = key ? byText.get(key) : undefined;
    claim.parentId = parentId && parentId !== claim.id ? parentId : null;
  }

  return claims;
}


interface RawConnectionClaim {
  text: string;
  parentText: string;
  indexes: number[];
}

function readConnectionClaimText(value: unknown, generic: boolean): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (!normalized || normalized.length === 0) return null;
  if (generic && normalized.length > 400) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin evidencia")) return null;
  if (normalized.toLocaleLowerCase("es").includes("no hay afirmaciones")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin resultados")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin conexiones")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin información")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin datos")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin fuentes")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin evidencia")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin pruebas")) return null;
  if (normalized.toLocaleLowerCase("es").includes("sin respaldo")) return null;
  return normalized;
}

function readConnectionClaim(value: unknown): RawConnectionClaim | null {
  if (!isRecord(value)) return null;
  const text = readConnectionClaimText(value.text, false);
  if (!text) return null;
  const parentText = readConnectionClaimText(value.parentText, true);
  if (!parentText) return null;
  if (!Array.isArray(value.indexes)) return null;
  const indexes = value.indexes.filter((index): index is number => typeof index === "number" && index >= 0);
  if (indexes.length === 0) return null;
  return {
    text,
    parentText,
    indexes,
  };
}

function readConnectionClaims(value: unknown): RawConnectionClaim[] | null {
  const list = readListPayload(value, "claims");
  if (!list) return null;
  const claims: RawConnectionClaim[] = [];
  for (const entry of list) {
    const claim = readConnectionClaim(entry);
    if (!claim) continue;
    claims.push(claim);
  }
  return claims.length > 0 ? claims : null;
}

function readConnectionEntities(
  value: unknown,
  items: readonly IdentitySearchItem[] = [],
): IdentityEntity[] | null {
  const list = readListPayload(value, "entities");
  if (!list) return null;
  const entities: IdentityEntity[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const label = clip(entry.label, 180);
    if (!label) continue;
    const key = normalizeClaimText(label);
    if (!key || seen.has(key)) continue;
    // "Familia de X" no es una identidad con la que se pueda establecer una
    // relación; su nodo solo repite al sujeto.
    if (/^familia (de|del) /.test(key)) continue;
    seen.add(key);

    const id =
      clip(entry.id, 40) ?? key.replace(/\s+/g, "-").slice(0, 40);
    const type = profileType(clip(entry.type, 40));
    const description = clip(entry.description, 500) ?? "";
    const occupation = readOccupation(entry.occupation);
    const indexes = Array.isArray(entry.indexes)
      ? entry.indexes.filter(
          (index): index is number => typeof index === "number" && index >= 0,
        )
      : [];

    // Las fuentes de la entidad son las mismas de la vuelta: primero las que
    // el modelo citó por número y, si no citó, las que nombran a la entidad.
    const sources: IdentitySourceRef[] = [];
    const seenUrls = new Set<string>();
    for (const index of indexes) {
      const item = items[index];
      if (!item) continue;
      for (const source of expandedSources(item)) {
        if (seenUrls.has(source.url)) continue;
        seenUrls.add(source.url);
        sources.push(source);
      }
    }
    if (sources.length === 0) {
      for (const source of readConnectionSources(
        items.filter((item) => itemMentions(item, [label])),
      )) {
        sources.push(source);
      }
    }

    entities.push({
      id,
      label,
      type,
      description,
      occupation,
      sources,
      score: null,
      confidence: null,
    });
  }
  return entities;
}

function readConnectionSources(items: readonly IdentitySearchItem[]): IdentitySourceRef[] {
  const sources: IdentitySourceRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const source of expandedSources(item)) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources;
}

function readConnectionClaimSources(claim: RawConnectionClaim, items: readonly IdentitySearchItem[]): IdentitySourceRef[] {
  const sources: IdentitySourceRef[] = [];
  const seen = new Set<string>();
  for (const index of claim.indexes) {
    if (index < 0 || index >= items.length) continue;
    const item = items[index];
    if (!item) continue;
    for (const source of expandedSources(item)) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources;
}

const ENTITY_STOPWORDS = new Set([
  "del",
  "las",
  "los",
  "para",
  "por",
  "con",
  "una",
  "uno",
  "the",
  "and",
]);

/**
 * Las fuentes nombran a la persona con menos palabras que la entidad
 * ("Germán Ávila" por "Germán Ávila Plazas"). Exigir el nombre completo
 * dejaba sin nudo a los familiares que la afirmación sí menciona.
 *
 * `subjectLabel` evita el caso contrario: un familiar puede llamarse igual
 * que el sujeto más un apellido ("Gustavo Petro Sierra"). Ahí las palabras
 * compartidas describen al sujeto, así que solo vale el nombre completo.
 */
export function mentionsEntity(
  text: string,
  label: string,
  subjectLabel?: string,
): boolean {
  const body = normalizeClaimText(text);
  const target = normalizeClaimText(label);
  if (!body || !target) return false;
  if (body.includes(target)) return true;

  const subject = subjectLabel ? normalizeClaimText(subjectLabel) : "";
  if (subject && target.startsWith(`${subject} `)) return false;

  const tokens = target
    .split(" ")
    .filter((token) => token.length >= 3 && !ENTITY_STOPWORDS.has(token));
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => body.includes(token));
  if (tokens.length === 1) return hits.length === 1;
  // El ancla es el primer apellido cuando el nombre tiene tres palabras o
  // más, y el apellido único cuando solo hay dos ("José Ramírez").
  const anchor = tokens.length >= 3 ? tokens[1] : tokens[tokens.length - 1];
  return hits.length >= 2 && hits.includes(anchor);
}

function readConnectionClaimEntities(
  claim: RawConnectionClaim,
  entities: readonly IdentityEntity[],
  subjectLabel?: string,
): IdentityEntity[] {
  return entities.filter((entity) =>
    mentionsEntity(claim.text, entity.label, subjectLabel),
  );
}

/**
 * Separa las identidades que ya tienen un vínculo afirmado con el sujeto de
 * las que solo aparecen conectadas a otra identidad. Las segundas son ramas
 * abiertas: la vuelta siguiente debe intentar cerrarlas contra el sujeto y,
 * si la evidencia no alcanza, dejar de profundizar por ahí.
 */
export function connectionBranches(
  claims: readonly IdentityClaim[],
  subjectLabel: string,
): { linked: string[]; open: string[] } {
  const subjectKey = normalizeClaimText(subjectLabel);
  const labels = new Map<string, string>();
  const linked = new Set<string>();
  const indirect = new Set<string>();

  for (const claim of claims) {
    if (claim.id === "root") continue;
    const entities = claim.entities.filter(
      (entity) => normalizeClaimText(entity.label) !== subjectKey,
    );
    if (entities.length === 0) continue;

    for (const entity of entities) {
      const key = normalizeClaimText(entity.label);
      if (key && !labels.has(key)) labels.set(key, entity.label);
    }

    // Una afirmación de la primera vuelta cuelga del sujeto aunque no lo
    // nombre: "Su hermano José Ramírez fue viceministro".
    const direct =
      (Boolean(subjectKey) &&
        mentionsEntity(claim.text, subjectLabel, subjectLabel)) ||
      claim.parentId === "root" ||
      (!claim.parentId && entities.length === 1);

    if (direct) {
      for (const entity of entities) {
        const key = normalizeClaimText(entity.label);
        if (key) linked.add(key);
      }
      continue;
    }

    // Solo hay cadena entre identidades cuando la afirmación nombra a dos o
    // más, o cuando cuelga de otra afirmación ya conectada.
    if (entities.length >= 2 || claim.parentId) {
      for (const entity of entities) {
        const key = normalizeClaimText(entity.label);
        if (key) indirect.add(key);
      }
    }
  }

  return {
    linked: [...linked].map((key) => labels.get(key) ?? key),
    open: [...indirect]
      .filter((key) => !linked.has(key))
      .map((key) => labels.get(key) ?? key),
  };
}

/** Tres tiempos dentro del mismo loop, no una tercera fase de producto. */
export type ConnectionRoundBeat = "expand-subject" | "expand-second" | "close-subject";

export function connectionRoundBeat(round: number): ConnectionRoundBeat {
  if (round <= 1) return "expand-subject";
  if (round === 2) return "expand-second";
  return "close-subject";
}

/**
 * La vuelta 3 solo corre si hay ramas abiertas: nombres de segundo salto
 * que se puedan cruzar con el sujeto. Sin eso el loop se queda en dos.
 */
export function canContinueConnectionLoop(input: {
  finishedRound: number;
  hasNewClaims: boolean;
  openCount: number;
}): boolean {
  if (!input.hasNewClaims) return false;
  if (input.finishedRound >= CONNECTION_ROUNDS) return false;
  if (
    connectionRoundBeat(input.finishedRound + 1) === "close-subject" &&
    input.openCount === 0
  ) {
    return false;
  }
  return true;
}

function readConnectionClaimConfidence(claim: RawConnectionClaim, sources: IdentitySourceRef[]): IdentityConfidence {
  const uniqueSources = new Set<string>();
  for (const source of sources) {
    uniqueSources.add(source.url);
  }
  const uniqueCount = uniqueSources.size;
  if (uniqueCount === 0) return "uncertain";
  if (uniqueCount === 1) return "probable";
  return "corroborated";
}

function readConnectionClaimScore(claim: RawConnectionClaim, sources: IdentitySourceRef[]): number {
  const uniqueSources = new Set<string>();
  for (const source of sources) {
    uniqueSources.add(source.url);
  }
  const uniqueCount = uniqueSources.size;
  if (uniqueCount === 0) return 1;
  // Una sola fuente puede ser probable, pero nunca corroborada.
  if (uniqueCount === 1) return 52;
  return 80;
}

function buildConnectionSummaryPrompt(input: {
  name: string;
  details?: string;
  interest?: string;
  who: string;
  claims: readonly IdentityClaim[];
}): string {
  const lines = [
    `Nombre consultado: ${input.name}`,
    journalistDetailNote(input.details),
    journalistInterestNote(input.interest),
    `Contexto del sujeto: ${input.who || "Sin contexto."}`,
    "Afirmaciones acumuladas:",
  ];
  const accumulated = input.claims.filter((claim) => claim.id !== "root");
  if (accumulated.length === 0) lines.push("Ninguna todavía.");
  for (const claim of accumulated) lines.push(`- [${claim.id}] ${claim.text}`);
  lines.push("", "Devuelve solo el JSON con findings.");
  return lines.join("\n");
}

function buildConnectionSummary(input: {
  name: string;
  details?: string;
  who: string;
  claims: readonly IdentityClaim[];
}): IdentitySummary {
  const probableClaims = input.claims.filter((claim) =>
    claim.confidence === "probable" || claim.confidence === "corroborated"
  );

  const findings = probableClaims.length > 0
    ? probableClaims
        .map((claim) => `Se encontró que ${claim.text}.`)
        .join("\n")
    : "Todavía no hay afirmaciones probables.";

  return {
    who: input.who,
    findings,
    text: `${input.who} ${findings}`,
    claims: probableClaims.length,
  };
}

function buildConnectionQueriesPrompt(input: {
  name: string;
  details?: string;
  interest?: string;
  who: string;
  rootText: string;
  claims: readonly IdentityClaim[];
  priorQueries: readonly IdentityToolQuery[];
  round: number;
  branch?: {
    entityId?: string;
    claimId?: string;
    label?: string;
  };
}): string {
  const lines = [
    `Nombre consultado: ${input.name}`,
    journalistDetailNote(input.details),
    journalistInterestNote(input.interest),
    `Contexto del sujeto: ${input.who || "Sin contexto."}`,
    `Afirmación raíz: ${input.rootText}`,
    "Afirmaciones acumuladas:",
  ];
  const accumulated = input.claims.filter((claim) => claim.id !== "root");
  if (accumulated.length === 0) lines.push("Ninguna todavía.");
  for (const claim of accumulated) lines.push(`- ${claim.text}`);

  const subjectLabel =
    input.claims.find((claim) => claim.id === "root")?.entities[0]?.label ??
    input.name;
  const branches = connectionBranches(input.claims, subjectLabel);
  lines.push(
    "",
    "Estado de la red:",
    `- Identidades ya conectadas con el sujeto: ${
      branches.linked.join(", ") || "ninguna todavía"
    }.`,
    `- Ramas abiertas (conectadas solo con otra identidad, sin vínculo probado con el sujeto): ${
      branches.open.join(", ") || "ninguna"
    }.`,
  );
  lines.push("", ...publicInterestSearchLines());
  const beat = connectionRoundBeat(input.round);
  const branch = input.branch?.label ?? input.branch?.entityId ?? input.branch?.claimId;
  if (branch) {
    lines.push(
      "",
      `Rama elegida por el periodista: ${branch}.`,
      "Esta vuelta no sigue el tiempo automático (primer grado / segundo salto / cierre). El periodista pidió profundizar aquí.",
      "Todas las consultas deben partir de esa identidad o afirmación. No reabras el sujeto en general.",
      "Aplica el interés de investigación y las conexiones de interés público a esa rama.",
      "Si la fuente une esa rama con el sujeto, incluye también esa consulta de cierre.",
      "No gastes las cinco consultas en un solo tipo de pista. Si no hay rastro público, action es \"stop\" y nextQueries es [].",
    );
  } else if (beat === "expand-subject") {
    lines.push(
      "Vuelta 1: solo primer grado. Busca personas y organizaciones unidas directamente al sujeto.",
      "No profundices en las relaciones de esas identidades entre sí. No combines dos nombres ajenos al sujeto.",
    );
  } else if (beat === "expand-second") {
    lines.push(
      "Vuelta 2: un salto más. Parte de las identidades ya conectadas con el sujeto y busca con quién más se unen (familiar, societario, laboral, contractual o político).",
      "Esas cadenas quedan como ramas abiertas. No gastes consultas en cerrarlas todavía contra el sujeto.",
    );
  } else if (branches.open.length > 0) {
    lines.push(
      "Vuelta 3: solo cierre. Hay ramas abiertas con nombres concretos.",
      "Cada consulta debe combinar el nombre de una rama abierta con el del sujeto, para ver si hay un vínculo público (familiar, societario, laboral, contractual o político).",
      "No amplíes la red. No busques un tercer salto. Si no hay forma pública de cruzar esos nombres, action es \"stop\" y nextQueries es [].",
    );
  } else {
    lines.push(
      "Vuelta 3: no hay ramas abiertas que cruzar con el sujeto. action es \"stop\" y nextQueries es [].",
    );
  }

  lines.push("", "Consultas ya usadas. No las repitas:");
  if (input.priorQueries.length === 0) lines.push("Ninguna todavía.");
  for (const query of input.priorQueries) {
    lines.push(`- ${query.tool ?? "*"}: ${query.query}`);
  }
  lines.push(
    "",
    `Ronda ${input.round} de ${CONNECTION_ROUNDS}.`,
    branch
      ? "Propón de 3 a 5 búsquedas nuevas sobre la rama elegida."
      : "Propón de 3 a 5 búsquedas nuevas que sigan el tiempo de esta ronda.",
    "Devuelve solo el JSON con queries.",
  );
  return lines.join("\n");
}

function buildConnectionEntitiesPrompt(input: {
  name: string;
  items: readonly IdentitySearchItem[];
}): string {
  const lines = [
    `Sujeto consultado: ${input.name}`,
    "",
    "Resultados de esta vuelta. Elige solo entidades nombradas aquí:",
  ];
  input.items.forEach((item, index) => {
    lines.push(`${index + 1}. source: ${item.source}`);
    lines.push(`   title: ${item.title.slice(0, 200)}`);
    if (item.snippet) lines.push(`   snippet: ${item.snippet.slice(0, 280)}`);
  });
  lines.push(
    "",
    "Devuelve las personas y las organizaciones que aparecen nombradas en estos resultados y que no son el sujeto.",
    "Formato exacto:",
    '{"entities":[{"id":"e1","label":"Nombre completo","type":"person","description":"Quién es en una frase","occupation":"Cargo u ocupación o null","indexes":[1,3]}]}',
    'type solo puede ser "person" o "enterprise".',
    "occupation es un solo cargo u ocupación principal que la fuente nombre; si nombra varios, elige uno. Si no aparece, null. No lo inventes.",
    "indexes son los números de las fuentes de esta vuelta donde aparece la entidad. Usa [] si no la encuentras en ninguna.",
    'Si no hay entidades distintas al sujeto, devuelve {"entities":[]}.',
  );
  return lines.join("\n");
}

function buildConnectionClaimsPrompt(input: {
  name: string;
  details?: string;
  interest?: string;
  who: string;
  rootText: string;
  claims: readonly IdentityClaim[];
  entities: readonly IdentityEntity[];
  items: readonly IdentitySearchItem[];
  round: number;
  branch?: {
    entityId?: string;
    claimId?: string;
    label?: string;
  };
}): string {
  const lines = [
    `Nombre consultado: ${input.name}`,
    journalistDetailNote(input.details),
    journalistInterestNote(input.interest),
    `Contexto del sujeto: ${input.who || "Sin contexto."}`,
    `Afirmación raíz: ${input.rootText}`,
    "Afirmaciones acumuladas:",
  ];
  const accumulated = input.claims.filter((claim) => claim.id !== "root");
  if (accumulated.length === 0) lines.push("Ninguna todavía.");
  for (const claim of accumulated) lines.push(`- [${claim.id}] ${claim.text}`);

  const subjectLabel =
    input.claims.find((claim) => claim.id === "root")?.entities[0]?.label ??
    input.name;
  const branches = connectionBranches(input.claims, subjectLabel);
  const beat = connectionRoundBeat(input.round);
  const branch = input.branch?.label ?? input.branch?.entityId ?? input.branch?.claimId;
  lines.push(
    "",
    "Estado de la red:",
    `- Identidades conectadas con el sujeto: ${
      branches.linked.join(", ") || "ninguna todavía"
    }.`,
    `- Ramas abiertas: ${branches.open.join(", ") || "ninguna"}.`,
    "Redacta cada afirmación con su origen y su destino. Si la fuente une A con B, escribe la relación entre A y B.",
    "Si además la fuente une B con el sujeto, escríbelo en otra afirmación que nombre al sujeto y la relación.",
    "Si la fuente solo conecta dos identidades entre sí, no atribuyas esa relación al sujeto: la rama queda abierta.",
    "Si la fuente nombra partido, fondeo, empresa asociada o apoyo externo, escríbelo como afirmación con origen y destino.",
  );
  if (branch) {
    lines.push(
      `El periodista pidió profundizar en ${branch}.`,
      "Prioriza afirmaciones de esa rama: partidos, fondeo, empresas asociadas, apoyo externo, y el cierre contra el sujeto solo si la fuente lo dice.",
      "No atribuyas al sujeto lo que la fuente solo afirma de la rama.",
    );
  } else if (beat === "close-subject") {
    lines.push(
      "Esta vuelta solo busca el cierre: la afirmación más importante nombra al sujeto y a la identidad de la rama abierta.",
    );
  } else {
    lines.push(
      "Si la evidencia de esta vuelta cierra una rama abierta contra el sujeto, esa afirmación es la más importante: redáctala nombrando al sujeto.",
    );
  }

  lines.push("", "Entidades identificadas en esta vuelta:");
  if (input.entities.length === 0) lines.push("Ninguna.");
  for (const entity of input.entities) {
    lines.push(`- ${entity.label} (${entity.type}): ${entity.description}`);
  }
  lines.push("", "Fuentes numeradas de esta vuelta. Cita solo estos números:");
  input.items.forEach((item, index) => {
    lines.push(`${index + 1}. source: ${item.source}`);
    lines.push(`   title: ${item.title.slice(0, 200)}`);
    if (item.snippet) lines.push(`   snippet: ${item.snippet.slice(0, 280)}`);
  });
  lines.push("", "Devuelve solo el JSON con claims.");
  return lines.join("\n");
}

const CONNECTION_PLAN_SYSTEM = [
  "Eres el planificador de conexiones de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en las afirmaciones acumuladas o en el contexto del sujeto.",
  "El nombre, la descripción y el interés de investigación son la consulta del periodista, no evidencia.",
  "No inventes ni completes datos. Si no hay pistas públicas para seguir, action es \"stop\" y nextQueries es [].",
  "Diccionario de herramientas. Usa solo estas. No inventes una tercera:",
  IDENTITY_TOOLS_JSON,
  "Hay tres tiempos en el mismo loop. La vuelta 1 solo busca conexiones directas del sujeto. La vuelta 2 busca un salto más desde esas identidades. La vuelta 3, si hay ramas abiertas con nombres concretos, solo cruza esos nombres con el sujeto. No mezcles los tres tiempos.",
  "En cada vuelta busca conexiones de interés público: partidos, fondeo, empresas asociadas, apoyo externo. Si el periodista escribió un interés de investigación, priorízalo.",
  "Si el mensaje nombra una rama elegida por el periodista, ignora el tiempo de la ronda y sigue solo esa rama, con el mismo foco de interés público.",
  "Sigue las instrucciones de la ronda en el mensaje del usuario.",
  "Una relación entre dos identidades no es una relación con el sujeto. Si la fuente no une la última conexión con el sujeto, la rama queda abierta.",
  "Si una rama abierta no tiene evidencia pública que la una al sujeto, dilo en purpose y no sigas profundizando por ella.",
  "Cada nextQuery lleva \"query\", \"purpose\" y \"tool\": \"wikidata\", \"tavily\" o \"bd\". purpose describe la conexión o afirmación a explorar, no un campo de perfil.",
  "bd devuelve afirmaciones ya guardadas con su corroborancia y sus fuentes originales; úsala para reutilizar conexiones ya verificadas.",
  "Si falta tool, la consulta se busca en wikidata y en tavily. Si tool no es válido, también.",
  "Si no hay afirmaciones nuevas, action es \"stop\" y nextQueries es [].",
  "Devuelve solo el JSON con queries.",
].join("\n");

const CONNECTION_ENTITY_SYSTEM = [
  "Eres el identificador de entidades de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en los resultados de la búsqueda.",
  "El nombre consultado es el sujeto de la investigación. No lo incluyas en entities.",
  "Incluye personas y organizaciones que la afirmación necesite para conectar al sujeto con alguien más: familiares, socios, funcionarios, empresas, ministerios.",
  "Incluye también partidos, fondos, empresas asociadas, organismos de apoyo y las personas que los representen, cuando la fuente los nombre.",
  "Incluye también las entidades que aparecen conectadas con otra entidad ya conocida, aunque la fuente no las una al sujeto.",
  "Cada entidad lleva id, label, type, description, occupation e indexes. type es person o enterprise; occupation es un solo cargo principal que la fuente nombre o null; indexes cita los números de las fuentes.",
  'Devuelve solo el JSON con entities: {"entities":[...]}. Si no hay entidades distintas al sujeto, entities es [].',
].join("\n");

const CONNECTION_CLAIM_SYSTEM = [
  "Eres el razonador de conexiones de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en las fuentes numeradas de esta vuelta. Si una fuente es bd, la afirmación ya trae sus fuentes originales.",
  "El nombre, la descripción y el interés de investigación son la consulta del periodista, no evidencia.",
  "No inventes ni completes datos. Si no hay afirmaciones nuevas, claims es [].",
  "Cada claim lleva \"text\", \"parentText\" e \"indexes\": una lista de números de las fuentes numeradas de esta vuelta.",
  "Cuando reutilices una afirmación de bd, mantén su contenido y cita el número de esa fuente; el backend conserva la corroborancia y las fuentes originales.",
  "El texto debe nombrar a las personas y organizaciones de la fuente y la relación cuando la fuente la diga: hermano, socia, ministro, representante legal, empleado, militante, donante, contratista, patrocinador.",
  "Si la fuente nombra partido, fondeo, empresa asociada o apoyo externo, escríbelo como afirmación con origen y destino.",
  "Cada claim debe dejar claro el origen y el destino de la relación. No atribuyas al sujeto una relación que la fuente solo afirma entre otras dos personas.",
  "Si la fuente une dos identidades entre sí y no con el sujeto, escríbelo así: la cadena queda abierta.",
  "Si la fuente cierra esa cadena con el sujeto, redacta otra afirmación que nombre al sujeto y la relación; esa es la conexión que se busca.",
  "Si no hay fuentes, claims es [].",
  "Devuelve solo el JSON con claims.",
].join("\n");

const CONNECTION_SUMMARY_SYSTEM = [
  "Eres el resumidor de conexiones de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en las afirmaciones acumuladas.",
  "El nombre, la descripción y el interés de investigación son la consulta del periodista, no evidencia.",
  "Distingue las conexiones directas con el sujeto de las cadenas entre identidades. Si una cadena no cierra en el sujeto, dilo sin presentarla como conexión del sujeto.",
  "Devuelve solo el JSON con findings: una lista de frases en texto plano, no de objetos.",
].join("\n");

const CONNECTION_PLAN_MAX_TOKENS = 4_500;
const CONNECTION_ENTITY_MAX_TOKENS = 2_000;
const CONNECTION_CLAIM_MAX_TOKENS = 4_500;
const CONNECTION_SUMMARY_MAX_TOKENS = 2_000;

async function runConnectionRound(
  env: GeneralEnv,
  input: {
    name: string;
    details?: string;
    interest?: string;
    candidate: IdentityCandidate;
    state: IdentityConnectionState;
    subject: IdentityEntity;
    who: string;
    branchContext?: {
      entityId?: string;
      claimId?: string;
      label?: string;
    };
  },
): Promise<IdentityConnectionsResponse> {
  const { state, candidate, name, details, interest, who, branchContext } = input;
  const round = state.rounds.length + 1;
  const rootText =
    state.claims.find((claim) => claim.id === "root")?.text ??
    `El sujeto investigado es ${candidateLabel(candidate, name)}.`;
  const subjectLabel =
    state.claims.find((claim) => claim.id === "root")?.entities[0]?.label ?? name;
  const hasJournalistBranch = Boolean(
    branchContext?.entityId || branchContext?.claimId || branchContext?.label,
  );

  // La vuelta de cierre no se paga si no hay nombres de segundo salto
  // que cruzar con el sujeto. El periodista que elige una rama sí entra.
  if (
    !hasJournalistBranch &&
    connectionRoundBeat(round) === "close-subject" &&
    connectionBranches(state.claims, subjectLabel).open.length === 0
  ) {
    return {
      ...state,
      canContinue: false,
      stoppedReason: "sin ramas abiertas que cruzar con el sujeto",
    };
  }

  const priorKeys = new Set<string>();
  const priorQueries: IdentityToolQuery[] = [];
  for (const previous of state.rounds) {
    for (const query of previous.queries) {
      const key = queryKey(query.query, query.tool);
      if (priorKeys.has(key)) continue;
      priorKeys.add(key);
      priorQueries.push(query);
    }
  }

  const planCall = await callOpenRouter(
    env,
    [
      { role: "system", content: CONNECTION_PLAN_SYSTEM },
      {
        role: "user",
        content: buildConnectionQueriesPrompt({
          name,
          details,
          interest,
          who,
          rootText,
          claims: state.claims,
          priorQueries,
          round,
          branch: branchContext,
        }),
      },
    ],
    modelCallOptions(env, CONNECTION_PLAN_MAX_TOKENS),
  );

  if (!planCall.ok) {
    logModelFailure(`conexiones plan ${round}`, planCall.attempts, planCall.error?.code);
    return {
      ...state,
      canContinue: false,
      stoppedReason: "El plan de conexiones no pudo consultar al modelo.",
      error: fromGeneralError(
        planCall.error,
        "No se pudo planificar la vuelta de conexiones.",
      ),
    };
  }

  const planJson = await parseModelJson(env, planCall.text, CONNECTION_PLAN_MAX_TOKENS);
  if (!planJson.ok) {
    return {
      ...state,
      canContinue: false,
      stoppedReason: "El plan de conexiones no llegó en JSON válido.",
      error: fromGeneralError(
        planJson.error,
        "El plan de conexiones no llegó en JSON válido.",
      ),
    };
  }

  const queries = readConnectionQueries(planJson.value, priorKeys);
  if (queries.length === 0) {
    return { ...state, canContinue: false, stoppedReason: "sin búsquedas nuevas" };
  }

  const searches = await Promise.all(
    queries.map((query) => searchIdentityQuery(env, query)),
  );
  const catalog = new Map<string, IdentitySearchItem>();
  for (const search of searches) addToCatalog(catalog, search.items);
  const items = [...catalog.values()];

  if (items.length === 0) {
    // Un timeout de Tavily o Wikidata no significa que el sujeto no tenga
    // conexiones. Si hubo error de red, se permite otra vuelta; si las
    // búsquedas respondieron vacías, el loop se detiene.
    const hadErrors = searches.some((search) => search.errors.length > 0);
    const canRetry = hadErrors && round < CONNECTION_ROUNDS;
    const reason = hadErrors
      ? "Las búsquedas fallaron o agotaron el tiempo de espera."
      : "sin resultados";
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities: [],
          claims: [],
          reason,
          stopped: !canRetry,
        },
      ],
      canContinue: canRetry,
      stoppedReason: reason,
    };
  }

  const entityCall = await callOpenRouter(
    env,
    [
      { role: "system", content: CONNECTION_ENTITY_SYSTEM },
      {
        role: "user",
        content: buildConnectionEntitiesPrompt({
          name,
          items,
        }),
      },
    ],
    modelCallOptions(env, CONNECTION_ENTITY_MAX_TOKENS),
  );

  if (!entityCall.ok) {
    logModelFailure(`conexiones entidades ${round}`, entityCall.attempts, entityCall.error?.code);
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities: [],
          claims: [],
          reason: "El minipaso de identificación no pudo consultar al modelo.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "El minipaso de identificación no pudo completarse.",
    };
  }

  const entityJson = await parseModelJson(env, entityCall.text, CONNECTION_ENTITY_MAX_TOKENS);
  if (!entityJson.ok) {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities: [],
          claims: [],
          reason: "El minipaso de identificación no llegó en JSON válido.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "El minipaso de identificación no llegó en JSON válido.",
    };
  }

  const resolvedEntities = readConnectionEntities(entityJson.value, items);
  if (!resolvedEntities) {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities: [],
          claims: [],
          reason: "No se identificaron entidades nuevas.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "No se identificaron entidades nuevas.",
    };
  }

  // La tarjeta de cada identidad se llena con lo que este minipaso ya
  // extrajo (tipo, descripción, fuentes). No se vuelve a correr
  // investigateIdentity: esa búsqueda es del sujeto confirmado, no de
  // cada nudo del mapa.
  const entities = resolvedEntities;
  const priorClaims = state.claims;

  const claimCall = await callOpenRouter(
    env,
    [
      { role: "system", content: CONNECTION_CLAIM_SYSTEM },
      {
        role: "user",
        content: buildConnectionClaimsPrompt({
          name,
          details,
          interest,
          who,
          rootText,
          claims: priorClaims,
          entities,
          items,
          round,
          branch: branchContext,
        }),
      },
    ],
    modelCallOptions(env, CONNECTION_CLAIM_MAX_TOKENS),
  );

  if (!claimCall.ok) {
    logModelFailure(`conexiones claims ${round}`, claimCall.attempts, claimCall.error?.code);
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities,
          claims: [],
          reason: "El razonamiento no pudo consultar al modelo.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "El razonamiento no pudo completarse.",
    };
  }

  const claimJson = await parseModelJson(env, claimCall.text, CONNECTION_CLAIM_MAX_TOKENS);
  if (!claimJson.ok) {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities,
          claims: [],
          reason: "El razonamiento no llegó en JSON válido.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "El razonamiento no llegó en JSON válido.",
    };
  }

  const claims = buildConnectionClaims(claimJson.value, items, entities, round, state.claims);
  if (!claims) {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities,
          claims: [],
          reason: "No se encontraron afirmaciones nuevas.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "No se encontraron afirmaciones nuevas.",
    };
  }

  const summaryCall = await callOpenRouter(
    env,
    [
      { role: "system", content: CONNECTION_SUMMARY_SYSTEM },
      {
        role: "user",
        content: buildConnectionSummaryPrompt({
          name,
          details,
          interest,
          who,
          claims: [...priorClaims, ...claims],
        }),
      },
    ],
    modelCallOptions(env, CONNECTION_SUMMARY_MAX_TOKENS),
  );

  if (!summaryCall.ok) {
    logModelFailure(`conexiones summary ${round}`, summaryCall.attempts, summaryCall.error?.code);
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities,
          claims,
          reason: "El resumen no pudo consultar al modelo.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "El resumen no pudo completarse.",
    };
  }

  const summaryJson = await parseModelJson(env, summaryCall.text, CONNECTION_SUMMARY_MAX_TOKENS);
  if (!summaryJson.ok) {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities,
          claims,
          reason: "El resumen no llegó en JSON válido.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "El resumen no llegó en JSON válido.",
    };
  }

  const summary = readConnectionRoundSummary(summaryJson.value);
  if (!summary) {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        {
          round,
          queries,
          searches,
          entities,
          claims,
          reason: "No se pudo leer el resumen.",
          stopped: true,
        },
      ],
      canContinue: false,
      stoppedReason: "No se pudo leer el resumen.",
    };
  }

  const newClaims = claims.filter(
    (claim) =>
      !priorClaims.some(
        (existing) =>
          normalizeClaimText(existing.text) === normalizeClaimText(claim.text),
      ),
  );

  const whoText = summary.who || state.summary.who;
  const accumulated = [...priorClaims, ...newClaims];
  const openCount = connectionBranches(accumulated, subjectLabel).open.length;
  const canContinue = canContinueConnectionLoop({
    finishedRound: round,
    hasNewClaims: newClaims.length > 0,
    openCount,
  });
  const newState = {
    ...state,
    claims: accumulated,
    rounds: [
      ...state.rounds,
      {
        round,
        queries,
        searches,
        entities,
        claims: newClaims,
        reason: summary.findings,
        stopped: !canContinue,
      },
    ],
    summary: {
      who: whoText,
      findings: summary.findings,
      text: `${whoText} ${summary.findings}`.trim(),
      claims: accumulated.filter(
        (claim) => claim.confidence !== "uncertain",
      ).length,
    },
    canContinue,
    stoppedReason: !canContinue
      ? newClaims.length === 0
        ? "sin afirmaciones nuevas"
        : openCount === 0 && round < CONNECTION_ROUNDS
          ? "sin ramas abiertas que cruzar con el sujeto"
          : null
      : null,
  };

  return newState;
}

function readConnectionQueries(value: unknown, priorKeys: Set<string>): IdentityToolQuery[] {
  const list = readListPayload(value, "queries") ?? readListPayload(value, "nextQueries");
  if (!list) return [];
  const queries: IdentityToolQuery[] = [];
  for (const entry of list) {
    const directed = readDirectedQuery(entry);
    if (!directed) continue;
    const key = queryKey(directed.query, directed.tool);
    if (priorKeys.has(key)) continue;
    if (queries.some((existing) => queryKey(existing.query, existing.tool) === key)) continue;
    queries.push(directed);
    if (queries.length === MAX_PLAN_QUERIES) break;
  }
  return queries;
}

export async function investigateIdentityConnections(
  env: GeneralEnv,
  request: IdentityConnectionsRequest,
): Promise<IdentityConnectionsResponse> {
  const name = request.name.trim();
  const details = request.details?.trim() || undefined;
  const interest = request.interest?.trim() || undefined;
  const candidates = Array.isArray(request.investigation?.candidates)
    ? request.investigation.candidates
    : [];
  const foundCandidate = candidates.find(
    (item) => isRecord(item) && item.id === request.candidateId,
  );
  const candidate =
    foundCandidate && isRecord(foundCandidate)
      ? (foundCandidate as unknown as IdentityCandidate)
      : null;

  if (!candidate) {
    return {
      ...emptyConnectionState(),
      stoppedReason: "No se encontró el candidato en la investigación.",
      error: {
        code: "candidate_not_found",
        message: `No existe el candidato "${request.candidateId}" en la investigación.`,
      },
    };
  }

  const who = clip(connectionWho(candidate, name), 400) ?? candidateLabel(candidate, name);
  const existing = request.connection;
  let state: IdentityConnectionState;

  if (existing && isRecord(existing)) {
    const claims = Array.isArray(existing.claims) ? existing.claims : [];
    const rounds = Array.isArray(existing.rounds) ? existing.rounds : [];
    let root = claims.find((claim) => claim.id === "root");
    if (!root) {
      root = buildRootClaim(name, candidate);
      claims.unshift(root);
    }
    state = {
      claims,
      rounds,
      summary: resolveConnectionSummary(existing.summary, {
        who,
        findings: "Todavía no hay afirmaciones probables.",
        text: `${who} Todavía no hay afirmaciones probables.`,
        claims: 0,
      }),
      canContinue:
        typeof existing.canContinue === "boolean" ? existing.canContinue : true,
      stoppedReason:
        typeof existing.stoppedReason === "string" ? existing.stoppedReason : null,
    };
  } else {
    const root = buildRootClaim(name, candidate);
    const subject = buildSubjectEntity(name, candidate, root);
    root.entities = [subject];
    const findings = "Todavía no hay afirmaciones probables.";
    state = {
      claims: [root],
      rounds: [],
      summary: { who, findings, text: `${who} ${findings}`, claims: 0 },
      canContinue: true,
      stoppedReason: null,
    };
  }

  // Una rama elegida por el periodista abre una vuelta más aunque el loop
  // acumulado ya se hubiera detenido.
  const branch = request.branchContext
    ? {
        entityId: request.branchContext.entityId?.trim() || undefined,
        claimId: request.branchContext.claimId?.trim() || undefined,
        label: request.branchContext.label?.trim() || undefined,
      }
    : undefined;
  const hasBranch = Boolean(branch?.entityId || branch?.claimId || branch?.label);
  if (existing && !hasBranch && (!state.canContinue || state.rounds.length >= CONNECTION_ROUNDS)) {
    return state;
  }

  const rootClaim = state.claims.find((claim) => claim.id === "root");
  const subject =
    rootClaim?.entities?.find((entity) => entity.id === candidate.id) ??
    (rootClaim ? buildSubjectEntity(name, candidate, rootClaim) : buildSubjectEntity(name, candidate, buildRootClaim(name, candidate)));

  try {
    return await runConnectionRound(env, {
      name,
      details,
      interest,
      candidate,
      state,
      subject,
      who,
      branchContext: hasBranch ? branch : undefined,
    });
  } catch (error) {
    console.error(
      "[consta-api] identity connections",
      error instanceof Error ? error.message : "unknown",
    );
    return {
      ...state,
      canContinue: false,
      stoppedReason: "La vuelta de conexiones no pudo completarse.",
      error: {
        code: "internal_error",
        message: "La vuelta de conexiones no pudo completarse.",
      },
    };
  }
}
