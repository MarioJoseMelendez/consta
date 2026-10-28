/**
 * Resolución de identidad en un solo viaje.
 *
 * El plan de queries es una llamada previa y no cuenta como ronda.
 * Después hay como máximo tres rondas: cada una busca en Tavily y Wikidata,
 * y la IA actualiza candidatos y decide si sigue o se detiene.
 * Un valor solo sobrevive si cita una URL devuelta por esas búsquedas.
 */

import {
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
} from "@consta/contracts";
import {
  callOpenRouter,
  searchTavily,
  searchWikidata,
  type GeneralEnv,
  type GeneralError,
} from "./generalFuncs";

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

const PLAN_SYSTEM = [
  "Eres el planificador de identidad de Consta, una herramienta periodística de registros públicos.",
  "Respondes únicamente con un objeto JSON. No uses markdown ni texto alrededor.",
  "No inventes hechos, identificadores, cargos ni relaciones.",
  "El nombre y la descripción son la consulta del periodista, no evidencia.",
  "Propón entre 3 y 5 búsquedas cortas para distinguir personas, empresas o instituciones homónimas.",
  "Puedes incluir Guatemala, NIT, DPI, CUI o razón social como pista de búsqueda, nunca como un dato ya conocido.",
  "Escribe interpretation, query y purpose en español.",
  'Forma: {"interpretation":"INTERPRETACION","queries":[{"query":"CONSULTA","purpose":"PROPOSITO"}]}',
  "Reemplaza INTERPRETACION, CONSULTA y PROPOSITO. No los dejes literales ni uses puntos suspensivos.",
].join("\n");

const ROUND_SYSTEM = [
  "Eres el analista de identidad de Consta. Respondes únicamente con un objeto JSON. No uses markdown.",
  "Solo puedes afirmar lo que esté escrito en los resultados etiquetados de Tavily o Wikidata.",
  "El nombre y la descripción del periodista orientan la búsqueda y no son una fuente.",
  "No inventes ni completes datos. Si un campo no está en los resultados, status es \"not_found\" y value es null.",
  "Cada valor found, conflicting o alleged necesita sources cuya url sea una de las URLs entregadas. title y url son obligatorios.",
  "source solo puede ser \"tavily\" o \"wikidata\", y debe coincidir con el resultado citado.",
  "Una alegación no verificada usa status \"alleged\". Si las fuentes no coinciden, status es \"conflicting\" y value describe el conflicto sin elegir un ganador.",
  "type solo puede ser \"person\", \"enterprise\" o \"unknown\".",
  "Incluye siempre estos 15 campos: type, name, socialName, nationalID, taxesID, aliases, dateOfBirth, nationality, address, legalRepresentative, incorporationDate, website, email, phone, occupation.",
  "nationalID es CUI o DPI. taxesID es NIT. No los intercambies.",
  "Devuelve como máximo 5 candidatos distintos. Si ninguno queda sostenido por una fuente, candidates es [].",
  "En la ronda 3, action es \"stop\" y nextQueries es [].",
  "Si todavía hay homónimos y quedan rondas, action es \"continue\" y nextQueries trae de 1 a 5 búsquedas nuevas.",
  "Si ya se puede distinguir al sujeto, o no hay más pistas públicas, action es \"stop\".",
  'Forma: {"candidates":[{"id":"c1","label":"ETIQUETA","description":"DESCRIPCION","fields":[{"key":"name","value":"VALOR","status":"found","sources":[{"source":"wikidata","title":"TITULO","url":"https://ejemplo.invalid/fuente"}]}]}],"decision":{"action":"stop","reason":"MOTIVO","nextQueries":[]}}',
  "Reemplaza ETIQUETA, DESCRIPCION, VALOR, TITULO, MOTIVO y la URL de ejemplo por datos de los resultados. No uses puntos suspensivos.",
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
  "ETIQUETA",
  "DESCRIPCION",
  "VALOR",
  "TITULO",
  "MOTIVO",
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
    retries: 0 as const,
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
    const purpose = clip(entry.purpose, 300);
    if (!query || !purpose) continue;
    const key = query.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({ query, purpose });
    if (queries.length === MAX_PLAN_QUERIES) break;
  }

  if (queries.length < MIN_PLAN_QUERIES) return null;
  return { interpretation, queries };
}

function withConsultedName(plan: IdentityPlan, name: string): IdentityPlan {
  const needle = name.toLocaleLowerCase("es");
  const already = plan.queries.some((item) =>
    item.query.toLocaleLowerCase("es").includes(needle),
  );
  if (already) return plan;
  return {
    interpretation: plan.interpretation,
    queries: [
      { query: name, purpose: "Nombre tal como lo consultó el periodista." },
      ...plan.queries,
    ].slice(0, MAX_PLAN_QUERIES),
  };
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

function readSources(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
): IdentitySourceRef[] {
  if (!Array.isArray(value)) return [];
  const sources: IdentitySourceRef[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    const item = findCatalogItem(catalog, entry.url);
    if (!item || seen.has(item.url)) continue;
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

function normalizeField(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
): IdentityField | null {
  if (!isRecord(value) || !isFieldKey(value.key)) return null;
  const key = value.key;
  const sources = readSources(value.sources, catalog);
  let status = isFieldStatus(value.status) ? value.status : null;
  let fieldValue = readLooseValue(value.value);

  if (key === "type" && fieldValue) {
    fieldValue = canonicalizeType(fieldValue);
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

    if (Array.isArray(entry.fields)) {
      for (const field of entry.fields) {
        const normalized = normalizeField(field, catalog);
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

function readDecision(
  value: unknown,
  priorQueries: Set<string>,
): IdentityDecision | null {
  if (!isRecord(value)) return null;
  if (value.action !== "continue" && value.action !== "stop") return null;
  const reason = clip(value.reason, 500) ?? "";
  const nextQueries: string[] = [];

  if (value.action === "continue" && Array.isArray(value.nextQueries)) {
    for (const entry of value.nextQueries) {
      const query = clip(entry, 300);
      if (!query) continue;
      const key = query.toLocaleLowerCase("es");
      if (priorQueries.has(key)) continue;
      if (nextQueries.some((item) => item.toLocaleLowerCase("es") === key)) continue;
      nextQueries.push(query);
      if (nextQueries.length === MAX_PLAN_QUERIES) break;
    }
  }

  if (value.action === "continue" && nextQueries.length === 0) {
    return { action: "stop", reason, nextQueries: [] };
  }

  return {
    action: value.action,
    reason,
    nextQueries: value.action === "continue" ? nextQueries : [],
  };
}

function readRoundUpdate(
  value: unknown,
  catalog: Map<string, IdentitySearchItem>,
  priorQueries: Set<string>,
): { candidates: IdentityCandidate[]; decision: IdentityDecision } | null {
  const payload = unwrapPayload(value, "round");
  if (!isRecord(payload)) return null;
  const candidates = normalizeCandidates(payload.candidates, catalog);
  const decision = readDecision(payload.decision, priorQueries);
  if (!candidates || !decision) return null;
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
  query: string,
): Promise<IdentityQueryResult> {
  const [tavily, wikidata] = await Promise.all([
    searchTavily(env, query, {
      limit: SEARCH_LIMIT,
      includeRawContent: false,
      timeoutMs: SEARCH_TIMEOUT_MS,
    }),
    searchWikidata(env, query, {
      limit: SEARCH_LIMIT,
      timeoutMs: SEARCH_TIMEOUT_MS,
    }),
  ]);

  const items: IdentitySearchItem[] = [];
  const errors: IdentityQueryResult["errors"] = [];

  for (const result of [tavily, wikidata]) {
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

  return { query, items, errors };
}

function planPrompt(name: string, details?: string): string {
  return [
    `Nombre consultado: ${name}`,
    details
      ? `Descripción del periodista, no es evidencia: ${details}`
      : "Sin descripción adicional.",
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
  const lines = [
    `Nombre consultado: ${input.name}`,
    input.details
      ? `Descripción del periodista, no es evidencia: ${input.details}`
      : "Sin descripción adicional.",
    `Ronda ${input.round} de ${MAX_ROUNDS}.`,
    input.round === MAX_ROUNDS
      ? 'Esta es la última ronda. decision.action debe ser "stop" y nextQueries debe ser [].'
      : "Si todavía hay ambigüedad, puedes pedir otra ronda con nextQueries nuevas.",
    "",
    "Candidatos actuales:",
    JSON.stringify(input.candidates),
    "",
    "Resultados de esta ronda. sources.url solo puede ser una de estas URLs:",
  ];

  for (const search of input.searches) {
    lines.push("", `Consulta: ${search.query}`);
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

function dedupeQueries(queries: string[], prior: Set<string>): string[] {
  const next: string[] = [];
  for (const query of queries) {
    const cleaned = clip(query, 300);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("es");
    if (prior.has(key) || next.some((item) => item.toLocaleLowerCase("es") === key)) {
      continue;
    }
    next.push(cleaned);
  }
  return next;
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
  const plan = parsedPlan ? withConsultedName(parsedPlan, subject) : null;
  if (!plan) {
    return emptyResult({
      code: "invalid_plan",
      message: "El plan de búsqueda no incluyó consultas utilizables.",
    });
  }

  const catalog = new Map<string, IdentitySearchItem>();
  const priorQueries = new Set<string>();
  let queries = plan.queries.map((item) => item.query);
  let candidates: IdentityCandidate[] = [];
  const rounds: IdentityRound[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const roundQueries = dedupeQueries(queries, priorQueries);
    if (roundQueries.length === 0) break;
    for (const query of roundQueries) priorQueries.add(query.toLocaleLowerCase("es"));

    const searches = await Promise.all(
      roundQueries.map((query) => searchIdentityQuery(env, query)),
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

    if (!roundCall.ok) {
      logModelFailure(`ronda ${round}`, roundCall.attempts, roundCall.error?.code);
      rounds.push({ round, queries: roundQueries, searches, decision: null });
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

    const roundJson = await parseModelJson(env, roundCall.text, ROUND_MAX_TOKENS);
    if (!roundJson.ok) {
      rounds.push({ round, queries: roundQueries, searches, decision: null });
      return {
        plan,
        rounds,
        candidates,
        error: fromGeneralError(
          roundJson.error,
          "La actualización de candidatos no llegó en JSON válido.",
        ),
      };
    }

    const update = readRoundUpdate(roundJson.value, catalog, priorQueries);
    if (!update) {
      rounds.push({ round, queries: roundQueries, searches, decision: null });
      return {
        plan,
        rounds,
        candidates,
        error: {
          code: "invalid_model_json",
          message: "La actualización de candidatos no incluyó una decisión utilizable.",
        },
      };
    }

    candidates = update.candidates;
    rounds.push({
      round,
      queries: roundQueries,
      searches,
      decision: update.decision,
    });
    if (round === MAX_ROUNDS || update.decision.action === "stop") break;
    queries = update.decision.nextQueries;
  }

  return { plan, rounds, candidates };
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
