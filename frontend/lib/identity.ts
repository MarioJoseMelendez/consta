import type {
  IdentityClaim,
  IdentityConnectionRound,
  IdentityConnectionState,
  IdentityConnectionsRequest,
  IdentityConnectionsResponse,
  IdentityInvestigation,
  IdentityInvestigationRequest,
  IdentityInvestigationResponse,
  IdentitySummary,
} from "@consta/contracts";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"
).replace(/\/+$/, "");

/** El plan y hasta tres rondas de búsqueda y modelo: varios minutos. */
export const IDENTITY_TIMEOUT_MS = 300_000;
/** Una vuelta de conexiones puede tardar más: búsquedas + scoring + modelo. */
export const CONNECTION_TIMEOUT_MS = 300_000;

export class IdentityApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly partial: IdentityInvestigation | null;

  constructor(
    message: string,
    code: string,
    status: number,
    retryable: boolean,
    partial: IdentityInvestigation | null,
  ) {
    super(message);
    this.name = "IdentityApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.partial = partial;
  }
}

export class ConnectionApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly partial: IdentityConnectionState | null;

  constructor(
    message: string,
    code: string,
    status: number,
    retryable: boolean,
    partial: IdentityConnectionState | null,
  ) {
    super(message);
    this.name = "ConnectionApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.partial = partial;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readError(value: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} | null {
  if (!isRecord(value)) return null;
  const error = isRecord(value.error) ? value.error : value;
  if (typeof error.message !== "string" || !error.message.trim()) return null;
  return {
    code: typeof error.code === "string" ? error.code : "request_failed",
    message: error.message.trim(),
    retryable: error.retryable === true,
  };
}

function isInvestigation(value: unknown): value is IdentityInvestigationResponse {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.plan) &&
    Array.isArray(value.plan.queries) &&
    Array.isArray(value.rounds) &&
    Array.isArray(value.candidates)
  );
}

function hasPartial(value: IdentityInvestigation): boolean {
  return (
    value.plan.queries.length > 0 ||
    value.rounds.length > 0 ||
    value.candidates.length > 0
  );
}

function isSummary(value: unknown): value is IdentitySummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.who === "string" &&
    typeof value.findings === "string" &&
    typeof value.text === "string" &&
    typeof value.claims === "number"
  );
}

function isConnectionState(value: unknown): value is IdentityConnectionState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.claims) &&
    Array.isArray(value.rounds) &&
    isSummary(value.summary) &&
    typeof value.canContinue === "boolean" &&
    (value.stoppedReason == null || typeof value.stoppedReason === "string")
  );
}

/**
 * Normaliza el estado acumulado. Los elementos de `claims` y `rounds` ya
 * vienen del backend; solo se comprueba la estructura del sobre para no
 * reenviar datos de una respuesta inválida en la siguiente vuelta.
 */
function connectionStateOf(value: unknown): IdentityConnectionState | null {
  if (!isConnectionState(value)) return null;
  return {
    claims: value.claims as IdentityClaim[],
    rounds: value.rounds as IdentityConnectionRound[],
    summary: value.summary,
    canContinue: value.canContinue,
    stoppedReason: value.stoppedReason ?? null,
  };
}

/**
 * En un 502 el backend puede devolver solo lo acumulado. Ahí se tolera un
 * resumen incompleto: lo importante es no perder afirmaciones ya tejidas.
 */
function partialConnectionStateOf(
  value: unknown,
): IdentityConnectionState | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.rounds)
  ) {
    return null;
  }
  const claims = value.claims as IdentityClaim[];
  return {
    claims,
    rounds: value.rounds as IdentityConnectionRound[],
    summary: isSummary(value.summary)
      ? value.summary
      : { who: "", findings: "", text: "", claims: claims.length },
    canContinue: value.canContinue === true,
    stoppedReason:
      typeof value.stoppedReason === "string" ? value.stoppedReason : null,
  };
}

async function postIdentity(
  path: string,
  body: unknown,
): Promise<IdentityInvestigationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    let payload: unknown = null;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      payload = null;
    }

    const investigation = isInvestigation(payload) ? payload : null;
    const partial =
      investigation && hasPartial(investigation) ? investigation : null;
    const bodyError = readError(payload);
    const attachedError = investigation ? readError(investigation) : null;
    const failure = attachedError ?? bodyError;

    if (!response.ok) {
      throw new IdentityApiError(
        failure?.message ??
          `La investigación no pudo completarse (${response.status}).`,
        failure?.code ?? "request_failed",
        response.status,
        failure?.retryable ?? false,
        partial,
      );
    }

    if (!investigation) {
      throw new IdentityApiError(
        "La respuesta de identidad no tiene el formato esperado.",
        "invalid_response",
        response.status,
        false,
        null,
      );
    }

    return investigation;
  } catch (error) {
    if (error instanceof IdentityApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new IdentityApiError(
        "La investigación superó los 300 segundos.",
        "timeout",
        0,
        true,
        null,
      );
    }
    throw new IdentityApiError(
      "No se pudo contactar el servicio de identidad.",
      "network_error",
      0,
      true,
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function investigateIdentity(
  input: IdentityInvestigationRequest,
): Promise<IdentityInvestigationResponse> {
  const details = input.details?.trim();
  return postIdentity("/identity/investigate", {
    name: input.name.trim(),
    ...(details ? { details } : {}),
  });
}

export async function requestMoreIdentity(input: {
  name: string;
  details?: string;
  investigation: IdentityInvestigation;
}): Promise<IdentityInvestigationResponse> {
  const details = input.details?.trim();
  return postIdentity("/identity/more", {
    name: input.name.trim(),
    ...(details ? { details } : {}),
    investigation: input.investigation,
  });
}

export async function requestIdentityConnections(
  input: IdentityConnectionsRequest,
): Promise<IdentityConnectionsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
  const details = input.details?.trim();

  try {
    const response = await fetch(`${API_BASE}/identity/connections`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name.trim(),
        ...(details ? { details } : {}),
        investigation: input.investigation,
        candidateId: input.candidateId,
        ...(input.connection ? { connection: input.connection } : {}),
        ...(input.branchContext ? { branchContext: input.branchContext } : {}),
      }),
    });

    let payload: unknown = null;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      payload = null;
    }

    const state = connectionStateOf(payload);
    const partial = partialConnectionStateOf(payload);
    const failure = readError(payload);

    if (!response.ok) {
      throw new ConnectionApiError(
        failure?.message ??
          `Las conexiones no pudieron completarse (${response.status}).`,
        failure?.code ?? "request_failed",
        response.status,
        failure?.retryable ?? false,
        partial,
      );
    }

    if (!state) {
      throw new ConnectionApiError(
        "La respuesta de conexiones no tiene el formato esperado.",
        "invalid_response",
        response.status,
        false,
        null,
      );
    }

    return {
      ...state,
      ...(failure
        ? {
            error: {
              code: failure.code,
              message: failure.message,
              ...(failure.retryable ? { retryable: true } : {}),
            },
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof ConnectionApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ConnectionApiError(
        "Las conexiones superaron los 300 segundos.",
        "timeout",
        0,
        true,
        null,
      );
    }
    throw new ConnectionApiError(
      "No se pudo contactar el servicio de conexiones.",
      "network_error",
      0,
      true,
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}
