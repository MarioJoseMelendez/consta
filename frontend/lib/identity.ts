import type {
  IdentityInvestigation,
  IdentityInvestigationRequest,
  IdentityInvestigationResponse,
} from "@consta/contracts";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"
).replace(/\/+$/, "");

export const IDENTITY_TIMEOUT_MS = 180_000;

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

export async function investigateIdentity(
  input: IdentityInvestigationRequest,
): Promise<IdentityInvestigationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);

  try {
    const details = input.details?.trim();
    const response = await fetch(`${API_BASE}/identity/investigate`, {
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
      }),
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
        "La investigación superó los 180 segundos.",
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
