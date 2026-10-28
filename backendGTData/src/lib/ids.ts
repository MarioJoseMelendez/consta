/**
 * Identificadores GT y generación determinista de IDs.
 * Sin crypto para que el resultado sea idéntico en Workers, Node y tests.
 */

/** NIT: mayúsculas, sin guiones ni espacios; conserva la K verificadora. */
export function normalizeNit(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "");
}

/** CUI/DPI: solo dígitos, con relleno a 13 posiciones. */
export function normalizeCui(value: string): string {
  const digits = value.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 13 ? digits : digits.padStart(13, "0");
}

export function isNit(value: string): boolean {
  const nit = normalizeNit(value);
  return /^\d{4,12}[0-9K]$/.test(nit);
}

export function isCui(value: string): boolean {
  return /^\d{13}$/.test(normalizeCui(value));
}

export function entityId(scheme: string, value: string): string {
  const normalizedScheme = scheme.trim().toLowerCase();
  let normalizedValue: string;

  switch (normalizedScheme) {
    case "gt-nit":
      normalizedValue = normalizeNit(value);
      break;
    case "gt-cui":
      normalizedValue = normalizeCui(value);
      break;
    default:
      normalizedValue = value.trim();
      break;
  }

  return `${normalizedScheme}:${normalizedValue}`;
}

function fnv1a64(input: string, seed: bigint): bigint {
  const prime = 1099511628211n;
  const mask = 0xffffffffffffffffn;
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash;
}

function hex64(value: bigint): string {
  return value.toString(16).padStart(16, "0");
}

/**
 * ID determinista y estable a partir de una lista de partes.
 * Se usan dos semillas FNV-1a de 64 bits para reducir colisiones.
 */
export function stableId(...parts: Array<string | number | boolean | null | undefined>): string {
  const input = parts
    .map((part) => (part === null || part === undefined ? "" : String(part)))
    .join("|");

  const forward = fnv1a64(input, 14695981039346656037n);
  const backward = fnv1a64([...input].reverse().join(""), 14695981039346656037n);
  return hex64(forward) + hex64(backward);
}

/** Normaliza un ID de entidad recibido por query string. */
export function canonicalEntityId(value: string): string {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(":");
  if (separator < 0) return trimmed;

  const scheme = trimmed.slice(0, separator).toLowerCase();
  const rest = trimmed.slice(separator + 1);
  if (scheme === "gt-nit") return entityId("gt-nit", rest);
  if (scheme === "gt-cui") return entityId("gt-cui", rest);
  return trimmed;
}
