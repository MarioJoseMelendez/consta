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
  emptyIdentityField,
  identityFieldLabel,
  type IdentityCandidate,
  type IdentityDecision,
  type IdentityField,
  type IdentityFieldKey,
  type IdentityFieldStatus,
  type IdentityInvestigationResponse,
  type IdentityPlan,
  type IdentityPlanQuery,
  type IdentityQueryResult,
  type IdentityRound,
  type IdentitySearchItem,
  type IdentitySource,
  type IdentitySourceRef,
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

export const IDENTITY_NAME_MAX = 200;
export const IDENTITY_DETAILS_MAX = 2000;

const MAX_ROUNDS = 3;
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

/** Clave wikiData del pedido, mapeada al id canónico `wikidata`. */
const IDENTITY_TOOLS_JSON =
  '{"tools":[{"wikidata":"Es una wiki para data específica. Sirve para saber si el nombre es una persona o una empresa."},{"tavily":"Para buscar en la web, en registros públicos y en noticieros."}]}';

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
  occupation: "La ocupación, el cargo o la actividad.",
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
  "El nombre y la descripción son la consulta del periodista, no evidencia.",
  "Diccionario de herramientas. Usa solo estas. No inventes una tercera:",
  IDENTITY_TOOLS_JSON,
  "Diccionario de datos que debes intentar encontrar. Si un dato no está en la fuente, queda not_found. No inventes el valor:",
  IDENTITY_FIELDS_JSON,
  'Cada consulta incluye "tool" con exactamente "wikidata" o "tavily".',
  'Cada "purpose" nombra el campo que esa consulta busca, con la clave y la etiqueta, por ejemplo "taxesID / NIT", "socialName / Razón social" o "address / Dirección".',
  'No sirve un purpose solo genérico ("historia", "conocer", "contexto", "identificar") sin una clave de campo.',
  'La primera consulta es exactamente el nombre consultado, sin palabras de más, tool "wikidata", purpose "type / Tipo". Sirve para saber si es persona o empresa.',
  'La segunda es el mismo nombre, tool "tavily", purpose "type / Tipo", para ver si es una figura pública en noticieros.',
  "No busques NIT, razón social, DPI ni cargo hasta saber el tipo. En el plan solo van esas dos consultas.",
  "Escribe interpretation, query y purpose en español.",
  'Forma: {"interpretation":"INTERPRETACION","queries":[{"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"wikidata"}]}',
  'Reemplaza INTERPRETACION, CONSULTA, CLAVE y ETIQUETA. purpose lleva la clave real del diccionario. tool es "wikidata" o "tavily". No dejes los marcadores literales ni uses puntos suspensivos.',
].join("\n");

const ROUND_SYSTEM = [
  "Eres el analista de identidad de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en los resultados etiquetados de Tavily o Wikidata.",
  "El nombre y la descripción del periodista orientan la búsqueda y no son una fuente.",
  "No inventes ni completes datos. Si un campo no está en los resultados, no lo incluyas: queda not_found.",
  "Un candidato es una persona, empresa o institución nombrada en un resultado. No hace falta NIT, DPI ni un perfil completo.",
  "Si un resultado nombra al sujeto, devuélvelo. name queda \"found\" con la URL de ese resultado. Los campos que no aparezcan se omiten y quedan \"not_found\".",
  "Cada resultado de Wikidata ya es una entidad y puede ser su propio candidato.",
  "candidates queda [] solo cuando ningún resultado nombra una persona, empresa o institución.",
  "Cada valor found, conflicting o alleged necesita sources cuya url sea una de las URLs entregadas. title y url son obligatorios.",
  "source solo puede ser \"tavily\" o \"wikidata\", y debe coincidir con el resultado citado.",
  "Una alegación no verificada usa status \"alleged\". Si las fuentes no coinciden, status es \"conflicting\" y value describe el conflicto sin elegir un ganador.",
  "type solo puede ser \"person\", \"enterprise\" o \"unknown\".",
  "nationalID es CUI o DPI. taxesID es NIT. No los intercambies.",
  "Devuelve como máximo 5 candidatos distintos.",
  "Diccionario de herramientas. Usa solo estas. No inventes una tercera:",
  IDENTITY_TOOLS_JSON,
  "Diccionario de datos a encontrar. No inventes un valor que no esté escrito en los resultados:",
  IDENTITY_FIELDS_JSON,
  'Cada nextQuery elige una herramienta y nombra el campo que busca: {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"tavily"}.',
  'tool solo puede ser "wikidata" o "tavily". No uses cadenas sueltas ni otra herramienta.',
  "Primero decide type: person o enterprise. No busques el resto hasta tener ese tipo.",
  "Si type es person, es una figura pública: nextQueries van a noticieros (occupation, aliases, dateOfBirth, nationality) y a registros públicos para nationalID. No pidas NIT, razón social ni fecha de constitución.",
  "Si type es enterprise, nextQueries van a registros públicos: socialName, taxesID, address, website, phone, legalRepresentative, incorporationDate. No la busques como noticia.",
  "Si type sigue unknown, la única nextQuery distingue persona o empresa. No pidas un NIT.",
  "wikidata: el query es el nombre o un alias corto. tavily para una persona: el nombre más el dato, en noticieros. tavily para una empresa: el nombre más el dato del registro.",
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

function readLooseValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clip(String(value), 500);
  }
  if (typeof value === "string") return clip(value, 500);
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((item) => clip(item, 160))
    .filter((item): item is string => item !== null);
  if (parts.length === 0) return null;
  return clip(parts.join(", "), 500);
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
  attempts: Array<{ model: string; code?: string }>,
  code: string | undefined,
): void {
  const summary = attempts
    .map((attempt) => `${attempt.model}:${attempt.code ?? "ok"}`)
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
    if (!item || seen.has(item.url) || !itemMentions(item, names)) continue;
    seen.add(item.url);
    sources.push({
      source: item.source,
      title: item.title,
      url: item.url,
    });
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
  const sources: IdentitySource[] =
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

function planPrompt(name: string, details?: string): string {
  return [
    `Nombre consultado: ${name}`,
    details
      ? `Descripción del periodista, no es evidencia: ${details}`
      : "Sin descripción adicional.",
    "Diccionario de herramientas. Elige una por consulta. No inventes otra:",
    IDENTITY_TOOLS_JSON,
    "Diccionario de datos que cada consulta debe intentar encontrar. purpose nombra la clave. No inventes los valores:",
    IDENTITY_FIELDS_JSON,
    "Primero hay que saber si es persona o empresa. No pidas NIT, razón social ni cargo en el plan.",
    'Cada query lleva "tool": "wikidata" o "tavily" y purpose "type / Tipo".',
    "La primera es el nombre exacto en wikidata. La segunda es el mismo nombre en tavily, para noticieros.",
    "Devuelve solo el JSON del plan.",
  ].join("\n");
}

function roundPrompt(input: {
  name: string;
  details?: string;
  round: number;
  searches: IdentityQueryResult[];
  candidates: IdentityCandidate[];
}): string {
  const missing = formatMissing(missingFieldKeys(input.candidates));
  const lines = [
    `Nombre consultado: ${input.name}`,
    input.details
      ? `Descripción del periodista, no es evidencia: ${input.details}`
      : "Sin descripción adicional.",
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
    'Si action es "continue", nextQueries es una lista de objetos {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"wikidata"} o {"query":"CONSULTA","purpose":"CLAVE / ETIQUETA","tool":"tavily"}.',
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
        : "Herramienta ausente o inválida: se buscó en wikidata y en tavily.",
    );
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
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      sources.push(sourceRef(item));
      if (sources.length === 5) break;
    }
    if (sources.length === 5) break;
  }
  if (sources.length === 0) return null;
  const value =
    entries.length === 1
      ? entries[0].value
      : entries
          .map((entry) => entry.value)
          .join(" · ")
          .slice(0, 500);
  return {
    key,
    label: identityFieldLabel(key),
    value,
    status: entries.length === 1 ? "found" : "conflicting",
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
): Promise<IdentityInvestigationResponse> {
  const subject = name.trim();
  const context = details?.trim() || undefined;

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

  const planCall = await callOpenRouter(
    env,
    [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: planPrompt(subject, context) },
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

  return candidates.map((candidate) => ({
    ...candidate,
    fields: candidate.fields.map((field) => {
      if (field.status === "not_found" || !field.value?.trim()) {
        return { ...field, score: null, confidence: null };
      }
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
        sources,
        score,
        confidence: confidenceForScore(score),
      };
    }),
  }));
}

export async function investigateIdentity(
  env: GeneralEnv,
  name: string,
  details?: string,
): Promise<IdentityInvestigationResponse> {
  try {
    return await runInvestigation(env, name, details);
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
