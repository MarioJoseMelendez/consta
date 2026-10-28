// El frontend usa un timeout de 1.6s para su fallback local. El analyzer debe
// fallar rápido al Channel para que la respuesta llegue antes de ese límite.
const GT_TIMEOUT_MS = 800;
const GT_COOLDOWN_MS = 15_000;

let gtUnavailableUntil = 0;

export interface GtEnv {
  GT_DATA_URL?: string;
}

export function gtBaseUrl(env: GtEnv): string | null {
  const value = env.GT_DATA_URL?.trim();
  if (!value) return null;

  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * El analyzer consume el Channel GT server-side. Un fallo del canal no debe
 * tumbar el workspace: el llamador decide si usa el bundle demo local.
 */
export async function gtGet<T>(baseUrl: string, path: string): Promise<T | null> {
  if (Date.now() < gtUnavailableUntil) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Un 404 es una respuesta válida del canal; un 5xx indica caída.
      if (response.status >= 500) {
        gtUnavailableUntil = Date.now() + GT_COOLDOWN_MS;
      }
      return null;
    }

    gtUnavailableUntil = 0;
    return (await response.json()) as T;
  } catch {
    gtUnavailableUntil = Date.now() + GT_COOLDOWN_MS;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
