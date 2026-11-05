/**
 * Pixel-art photos for identity dossiers.
 *
 * Generation never blocks identity or connections. People get a `persona`
 * placeholder until a matching occupation is already in D1 or a single
 * background attempt succeeds. Companies and institutions always use the
 * `empresa` building placeholder and never call the image model.
 */

import type { IdentityCandidate, IdentityEntity, IdentityProfileType } from "@consta/contracts";
import type { GeneralEnv } from "./generalFuncs";
import {
  deleteOccupationTask,
  occupationCandidates,
  readOccupationImage,
  readOccupationTask,
  saveOccupationImage,
  saveOccupationTask,
  savedKey,
  type OccupationImage,
} from "./db";

export const PLACEHOLDER_PERSONA = "persona";
export const PLACEHOLDER_EMPRESA = "empresa";

export type OccupationPhotoKind = IdentityProfileType | "company" | "agency";
export type PlaceholderKey = typeof PLACEHOLDER_PERSONA | typeof PLACEHOLDER_EMPRESA;
export type WaitUntil = (task: Promise<unknown>) => void;

export interface ImageProviderConfig {
  provider: string;
  model: string;
}

export interface OccupationImageMeta {
  occupation: string;
  cached: boolean;
  pending: boolean;
  placeholder: PlaceholderKey | null;
}

export interface ResolvedOccupationImage extends OccupationImageMeta {
  image: OccupationImage;
}

export interface ResolveOccupationImageOptions {
  kind?: OccupationPhotoKind | string | null;
  waitUntil?: WaitUntil;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const REAPI_BASE_URL = "https://reapi.ai/api/v1";
const IMAGE_TIMEOUT_MS = 12_000;
const IMAGE_SIZE = 256;
const PLACEHOLDER_PROVIDER = "placeholder";
/** muse-image tarda de segundos a minutos; se sondea por ventanas cortas. */
const REAPI_POLL_INTERVAL_MS = 1_500;
const REAPI_POLL_WINDOW_MS = 20_000;
const REAPI_MAX_SUBMISSIONS = 2;
const REAPI_TASK_MAX_AGE_MS = 10 * 60 * 1000;

const generating = new Map<string, Promise<OccupationImage | null>>();

export function imageProvider(env: {
  IMAGE_PROVIDER?: string;
  IMAGE_MODEL?: string;
  REAPI_KEY?: string;
}): ImageProviderConfig {
  return {
    provider:
      env.IMAGE_PROVIDER?.trim() || (env.REAPI_KEY?.trim() ? "reapi" : "mock"),
    model: env.IMAGE_MODEL?.trim() || "muse-image",
  };
}

export function photoKindOf(
  kind?: OccupationPhotoKind | string | null,
  occupation?: string | null,
): IdentityProfileType {
  const value = (kind ?? "").trim().toLowerCase();
  if (value === "enterprise" || value === "company" || value === "agency") {
    return "enterprise";
  }
  if (value === "person") return "person";
  const key = savedKey(occupation ?? "");
  if (key === PLACEHOLDER_EMPRESA) return "enterprise";
  if (key === PLACEHOLDER_PERSONA) return "person";
  return "unknown";
}

export function placeholderKeyFor(kind?: OccupationPhotoKind | string | null): PlaceholderKey {
  return photoKindOf(kind) === "enterprise" ? PLACEHOLDER_EMPRESA : PLACEHOLDER_PERSONA;
}

export function shouldGenerateOccupationImage(
  kind?: OccupationPhotoKind | string | null,
): boolean {
  return photoKindOf(kind) === "person";
}

function isCompanyKind(kind?: OccupationPhotoKind | string | null): boolean {
  return photoKindOf(kind) === "enterprise";
}

export function primaryOccupation(occupation: string): string | null {
  const candidates = occupationCandidates(occupation);
  if (candidates.length === 0) return null;
  const fullKey = savedKey(occupation);
  return candidates.find((candidate) => savedKey(candidate) !== fullKey) ?? candidates[0] ?? null;
}

export function personOccupationsFromCandidates(
  candidates: readonly IdentityCandidate[],
): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    const type = candidate.fields.find((field) => field.key === "type")?.value;
    if (type !== "person") continue;
    const occupation = candidate.fields.find((field) => field.key === "occupation")?.value;
    if (occupation) out.push(occupation);
  }
  return uniqueOccupations(out);
}

export function personOccupationsFromEntities(
  entities: readonly IdentityEntity[],
): string[] {
  const out: string[] = [];
  for (const entity of entities) {
    if (entity.type !== "person") continue;
    if (entity.occupation) out.push(entity.occupation);
  }
  return uniqueOccupations(out);
}

function uniqueOccupations(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const primary = primaryOccupation(value);
    if (!primary) continue;
    const key = savedKey(primary);
    if (!key || key === PLACEHOLDER_PERSONA || key === PLACEHOLDER_EMPRESA) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(primary);
  }
  return out;
}

function isPlaceholderRecord(image: OccupationImage | null): boolean {
  return image?.provider === PLACEHOLDER_PROVIDER;
}

export function placeholderArt(kind: PlaceholderKey): OccupationImage {
  const pixels = new Map<string, string>();
  const plot = (x: number, y: number, color: string) => {
    if (x < 0 || y < 0 || x > 23 || y > 23) return;
    pixels.set(`${x},${y}`, color);
  };
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) plot(col, row, color);
    }
  };

  const ink = "#1C1C1E";
  const mint = "#EEF3EA";
  const green = "#248A3D";
  const paper = "#F7FAF5";
  const shadeMint = "#C5D4C0";

  if (kind === PLACEHOLDER_EMPRESA) {
    rect(0, 18, 24, 6, "#141416");
    rect(3, 8, 18, 14, mint);
    rect(4, 4, 16, 5, mint);
    rect(8, 1, 8, 4, shadeMint);
    rect(10, 0, 4, 2, green);
    for (const x of [5, 8, 11, 14, 17]) {
      for (const y of [6, 10, 14]) rect(x, y, 2, 2, ink);
    }
    rect(11, 16, 3, 6, green);
    rect(12, 18, 1, 1, mint);
    return {
      ...pixelSvg(pixels, ink, "Empresa"),
      provider: PLACEHOLDER_PROVIDER,
      model: PLACEHOLDER_PROVIDER,
    };
  }

  rect(0, 18, 24, 6, "#141416");
  rect(5, 14, 14, 8, green);
  rect(7, 13, 10, 2, green);
  rect(9, 5, 6, 7, paper);
  rect(8, 4, 8, 3, shadeMint);
  plot(10, 7, ink);
  plot(13, 7, ink);
  plot(11, 10, "#C5B8A8");
  rect(10, 12, 4, 2, paper);
  return {
    ...pixelSvg(pixels, ink, "Persona"),
    provider: PLACEHOLDER_PROVIDER,
    model: PLACEHOLDER_PROVIDER,
  };
}

export async function ensurePlaceholderImages(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  for (const key of [PLACEHOLDER_PERSONA, PLACEHOLDER_EMPRESA] as const) {
    const existing = await readOccupationImage(db, key);
    // Migration 0002 inserts a tiny stub; replace it with the pixel-art photo.
    if (existing && existing.bytes.byteLength >= 400) continue;
    try {
      await saveOccupationImage(
        db,
        key,
        placeholderArt(key),
        PLACEHOLDER_PROVIDER,
        PLACEHOLDER_PROVIDER,
      );
    } catch {
      // The in-memory SVG is still served if D1 is unavailable.
    }
  }
}

export async function readPlaceholderImage(
  db: D1Database | undefined,
  kind: PlaceholderKey,
): Promise<OccupationImage> {
  const cached = await readOccupationImage(db, kind);
  if (cached) return cached;
  return placeholderArt(kind);
}

/**
 * Look up a stored occupation row. Does not generate. A placeholder provider
 * means a previous attempt failed and the model must not be called again.
 */
export async function findStoredOccupationImage(
  db: D1Database | undefined,
  occupation: string,
): Promise<{ occupation: string; image: OccupationImage; failed: boolean } | null> {
  for (const candidate of occupationCandidates(occupation)) {
    const key = savedKey(candidate);
    if (key === PLACEHOLDER_PERSONA || key === PLACEHOLDER_EMPRESA) continue;
    const cached = await readOccupationImage(db, candidate);
    if (cached) {
      return {
        occupation: candidate,
        image: cached,
        failed: isPlaceholderRecord(cached),
      };
    }
  }
  return null;
}

/**
 * Resolve a photo without waiting on the model. Companies always get
 * `empresa`. People get a stored occupation match, or `persona` while a
 * single background generation may run.
 */
export async function resolveOccupationImage(
  db: D1Database | undefined,
  env: GeneralEnv,
  occupation: string,
  options: ResolveOccupationImageOptions = {},
): Promise<ResolvedOccupationImage | null> {
  await ensurePlaceholderImages(db);

  const kind = photoKindOf(options.kind, occupation);
  if (isCompanyKind(kind)) {
    const image = await readPlaceholderImage(db, PLACEHOLDER_EMPRESA);
    return {
      image,
      occupation: PLACEHOLDER_EMPRESA,
      cached: true,
      pending: false,
      placeholder: PLACEHOLDER_EMPRESA,
    };
  }

  const key = savedKey(occupation);
  if (key === PLACEHOLDER_PERSONA) {
    const image = await readPlaceholderImage(db, PLACEHOLDER_PERSONA);
    return {
      image,
      occupation: PLACEHOLDER_PERSONA,
      cached: true,
      pending: false,
      placeholder: PLACEHOLDER_PERSONA,
    };
  }

  const candidates = occupationCandidates(occupation);
  if (candidates.length === 0) return null;

  const stored = await findStoredOccupationImage(db, occupation);
  if (stored && !stored.failed) {
    return {
      image: stored.image,
      occupation: stored.occupation,
      cached: true,
      pending: false,
      placeholder: null,
    };
  }

  const persona = await readPlaceholderImage(db, PLACEHOLDER_PERSONA);
  if (stored?.failed) {
    return {
      image: persona,
      occupation: stored.occupation,
      cached: true,
      pending: false,
      placeholder: PLACEHOLDER_PERSONA,
    };
  }

  const primary = primaryOccupation(occupation);
  const pending = Boolean(
    shouldGenerateOccupationImage(kind) && primary && options.waitUntil && db,
  );

  if (pending && primary && options.waitUntil) {
    options.waitUntil(generateOccupationImageIfMissing(db, env, primary));
  }

  return {
    image: persona,
    occupation: primary ?? occupation,
    cached: false,
    pending,
    placeholder: PLACEHOLDER_PERSONA,
  };
}

export async function queueOccupationImages(
  db: D1Database | undefined,
  env: GeneralEnv,
  occupations: readonly string[],
): Promise<void> {
  if (!db) return;
  await ensurePlaceholderImages(db);
  const unique = uniqueOccupations(occupations);
  await Promise.allSettled(
    unique.map((occupation) => generateOccupationImageIfMissing(db, env, occupation)),
  );
}

/**
 * One generation path per occupation, and only on a D1 miss. ReAPI is
 * asynchronous: the task id is stored so a later request resumes the same
 * task instead of paying for a second image. There are at most two
 * submissions (the initial one and a single retry); after that the persona
 * placeholder is persisted under the occupation key and the model is never
 * called again for that cargo.
 */
export async function generateOccupationImageIfMissing(
  db: D1Database | undefined,
  env: GeneralEnv,
  occupation: string,
): Promise<OccupationImage | null> {
  const primary = primaryOccupation(occupation);
  if (!primary || !db) return null;
  const key = savedKey(primary);
  if (!key || key === PLACEHOLDER_PERSONA || key === PLACEHOLDER_EMPRESA) return null;

  const existing = generating.get(key);
  if (existing) return existing;

  const task = (async () => {
    const stored = await findStoredOccupationImage(db, primary);
    if (stored?.failed) return null;
    if (stored) return stored.image;

    const config = imageProvider(env);
    if (config.provider.trim().toLowerCase() === "reapi") {
      return generateWithReapiTask(db, env, config, primary);
    }

    const generated = await generateOccupationImage(env, primary);
    try {
      if (generated) {
        await saveOccupationImage(db, primary, generated, config.provider, config.model);
        return generated;
      }
      await saveOccupationImage(
        db,
        primary,
        placeholderArt(PLACEHOLDER_PERSONA),
        PLACEHOLDER_PROVIDER,
        PLACEHOLDER_PROVIDER,
      );
    } catch {
      // Serve the in-memory placeholder; the next miss may try D1 again.
    }
    return generated;
  })().finally(() => {
    generating.delete(key);
  });

  generating.set(key, task);
  return task;
}

async function generateWithReapiTask(
  db: D1Database,
  env: GeneralEnv,
  config: ImageProviderConfig,
  occupation: string,
): Promise<OccupationImage | null> {
  const prompt = occupationImagePrompt(occupation);
  let current = await readOccupationTask(db, occupation);
  if (current && Date.now() - current.submittedAt > REAPI_TASK_MAX_AGE_MS) {
    // Una tarea abandonada ya no se puede cobrar dos veces: se descarta.
    await deleteOccupationTask(db, occupation);
    current = null;
  }
  let attempts = current?.attempts ?? 0;

  while (attempts < REAPI_MAX_SUBMISSIONS) {
    if (!current) {
      const taskId = await submitReapiTask(env, config, prompt);
      attempts += 1;
      if (!taskId) continue; // un solo reintento
      await saveOccupationTask(db, occupation, taskId, attempts);
      current = {
        occupation,
        taskId,
        attempts,
        submittedAt: Date.now(),
      };
    }

    const outcome = await pollReapiTask(env, current.taskId, REAPI_POLL_WINDOW_MS);
    if (outcome.status === "completed") {
      const image = await downloadReapiImage(outcome.imageUrl);
      if (!image) {
        // La tarea terminó pero la descarga falló: se conserva el id para
        // reintentar la descarga sin pagar otra imagen.
        return null;
      }
      await deleteOccupationTask(db, occupation);
      try {
        await saveOccupationImage(db, occupation, image, config.provider, config.model);
      } catch {
        // La imagen se devuelve igual; el siguiente acceso la vuelve a guardar.
      }
      return image;
    }
    if (outcome.status === "failed") {
      await deleteOccupationTask(db, occupation);
      current = null;
      continue; // un solo reintento
    }
    // Sigue procesando: se conserva la tarea y otra visita la reanuda.
    return null;
  }

  try {
    await saveOccupationImage(
      db,
      occupation,
      placeholderArt(PLACEHOLDER_PERSONA),
      PLACEHOLDER_PROVIDER,
      PLACEHOLDER_PROVIDER,
    );
  } catch {
    // El placeholder en memoria sigue sirviendo.
  }
  return null;
}

/** Detailed pixel-art brief used for the single image-model call. */
export function occupationImagePrompt(occupation: string): string {
  const kind = occupationKind(occupation);
  const cues: Record<OccupationKind, string> = {
    health:
      "medical coat or scrub, small cross emblem on the chest, calm clinical prop such as a stethoscope. No blood, no needles in skin, no text on the coat.",
    law: "dark robe or tailored charcoal suit, white collar band or necktie, sober courthouse-file mood. No gavel text, no scales with writing.",
    security:
      "uniform shirt, modest badge block, optional cap. No firearms pointed at the viewer, no tactical gore, no readable insignia letters.",
    education:
      "knit or wool vest over a shirt, optional chalk-dusted sleeve, a closed book as a prop. No writing on the book cover.",
    tech: "plain shirt and a small geometric device or terminal block, cool muted palette. No logos, no brand shapes, no screens with text.",
    business:
      "dark jacket, pale shirt, thin necktie. Desk-dossier mood. No luxury logos, no readable documents.",
    politics:
      "formal jacket with a single sash or lapel block in accent green. Neutral civic portrait, not a real politician.",
    art: "textured shirt, one small color-block prop (brush or camera body) with no lettering.",
    sport: "simple jersey with a solid stripe, no numbers, no team names.",
    work: "plain work shirt or overalls and one generic tool silhouette. No brand marks.",
  };

  return [
    "Create one square 1:1 identification portrait for a journalist's public-records dossier.",
    "Style: detailed 32-bit era pixel art illustration made of hand-placed square pixels, chunky but rich in detail, crisp hard edges, no anti-aliasing, no blur, no soft gradients (ordered dithering only), no photorealism, no 3D render, no airbrush, no smooth vector look, no painterly AI texture.",
    "Pixel craft: readable silhouette, deliberate pixel clusters, three to four tones per material, dithered shadow transitions, every pixel intentional, nearest-neighbor sprite look, no sub-pixel detail that disappears when scaled.",
    "Framing: centered front-facing head-and-shoulders bust, eye level, subject looking at camera, generous margin, no crop through the skull or chin.",
    "Palette: limited to at most twelve flat colors. Background fill #1C1C1E (ink). Accents #EEF3EA (mint paper) and #248A3D (archive green). Skin, hair, and clothing use muted companions of those inks. No neon glow.",
    `Subject: a generic adult whose clothing and one small prop communicate the occupation "${occupation}" (${kind}: ${cues[kind]}).`,
    "The person is fictional and anonymous. Do not depict a celebrity, a real public official, a watermark, a signature, or a recognizable trademark.",
    "Composition: single subject, no crowd, no extra figures, no animals, no vehicles filling the frame, no scenery beyond a flat wall or desk band at the bottom.",
    "Constraints: no letters, numbers, words, captions, UI, polaroid frame, drop shadow, sticker, or watermark inside the pixels. No photoreal skin pores. No violence. No nudity.",
    "Mood: archival evidence photo, calm, high contrast, still readable as a person in a pixel-art ID portrait when scaled down.",
  ].join(" ");
}

export async function generateOccupationImage(
  env: GeneralEnv,
  occupation: string,
): Promise<OccupationImage | null> {
  const config = imageProvider(env);
  if (config.provider === "mock") return pixelArtFor(occupation);
  if (config.provider.trim().toLowerCase() === "reapi") {
    return generateReapiImage(env, config, occupation);
  }
  return requestOccupationImage(env, config, occupation);
}

/** Sin D1 no hay tarea que reanudar: un envío y, si falla, un reintento. */
async function generateReapiImage(
  env: GeneralEnv,
  config: ImageProviderConfig,
  occupation: string,
): Promise<OccupationImage | null> {
  const prompt = occupationImagePrompt(occupation);
  for (let attempt = 1; attempt <= REAPI_MAX_SUBMISSIONS; attempt += 1) {
    const taskId = await submitReapiTask(env, config, prompt);
    if (!taskId) continue;
    const outcome = await pollReapiTask(env, taskId, REAPI_POLL_WINDOW_MS);
    if (outcome.status === "completed") {
      return downloadReapiImage(outcome.imageUrl);
    }
    if (outcome.status === "pending") return null;
  }
  return null;
}

/**
 * Mock determinista de 24×24. Genera un avatar pixel art cuyo atuendo y
 * accesorio cambian con la ocupación. La misma ocupación produce siempre la
 * misma imagen, así que se puede cachear por clave.
 */
export function pixelArtFor(occupation: string): OccupationImage {
  const hash = hashOf(savedKey(occupation) || occupation);
  const palette = paletteFor(hash);
  const kind = occupationKind(occupation);
  const pixels = new Map<string, string>();

  const plot = (x: number, y: number, color: string) => {
    if (x < 0 || y < 0 || x > 23 || y > 23) return;
    pixels.set(`${x},${y}`, color);
  };
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) plot(col, row, color);
    }
  };

  rect(0, 18, 24, 6, shade(palette.background, 8));
  rect(5, 14, 14, 8, palette.shirt);
  rect(7, 13, 10, 2, palette.shirt);
  rect(11, 15, 2, 6, shade(palette.shirt, -26));
  rect(9, 5, 6, 7, palette.skin);
  rect(8, 3, 8, 3, palette.hair);
  plot(8, 5, palette.hair);
  plot(15, 5, palette.hair);
  plot(9, 12, palette.skin);
  plot(14, 12, palette.skin);
  plot(10, 7, "#1b1b1b");
  plot(13, 7, "#1b1b1b");
  plot(11, 10, shade(palette.skin, -30));

  switch (kind) {
    case "health":
      rect(6, 14, 12, 8, "#f3efe4");
      rect(11, 16, 2, 5, "#c94b4b");
      rect(9, 18, 6, 2, "#c94b4b");
      break;
    case "law":
      rect(5, 14, 14, 8, "#1c1c1f");
      rect(10, 14, 4, 2, "#f3efe4");
      rect(11, 16, 2, 5, "#f3efe4");
      break;
    case "security":
      rect(5, 14, 14, 8, "#2b4a6f");
      rect(7, 16, 2, 2, palette.accent);
      rect(16, 14, 1, 5, palette.accent);
      break;
    case "education":
      rect(5, 14, 14, 8, palette.shirt);
      rect(14, 17, 4, 3, "#f3efe4");
      rect(15, 18, 2, 1, palette.accent);
      break;
    case "tech":
      rect(5, 14, 14, 8, shade(palette.shirt, -18));
      rect(6, 18, 12, 3, "#0b0f0e");
      rect(7, 19, 10, 1, palette.accent);
      break;
    case "business":
      rect(5, 14, 14, 8, "#21252b");
      rect(10, 14, 4, 2, "#f3efe4");
      rect(11, 16, 2, 5, palette.accent);
      break;
    case "politics":
      rect(5, 14, 14, 8, "#2b2b33");
      rect(5, 16, 14, 2, palette.accent);
      rect(11, 14, 2, 8, "#f3efe4");
      break;
    case "art": {
      rect(5, 14, 14, 8, palette.shirt);
      rect(8, 2, 8, 2, shade(palette.hair, 18));
      rect(7, 4, 2, 1, shade(palette.hair, 18));
      const dots: Array<[number, number, string]> = [
        [15, 17, "#ff6b3d"],
        [17, 18, "#d8ff3e"],
        [16, 20, "#7ad0ff"],
      ];
      for (const [x, y, color] of dots) plot(x, y, color);
      break;
    }
    case "sport":
      rect(5, 14, 14, 8, palette.accent);
      rect(11, 15, 2, 6, shade(palette.accent, -60));
      rect(9, 14, 6, 1, "#f3efe4");
      break;
    default:
      rect(5, 14, 14, 8, palette.shirt);
      rect(11, 15, 2, 5, shade(palette.shirt, -30));
      break;
  }

  rect(5, 22, 14, 1, shade(palette.background, 20));
  return pixelSvg(pixels, palette.background, occupation || "Ocupación");
}

type OccupationKind =
  | "health"
  | "law"
  | "security"
  | "education"
  | "tech"
  | "business"
  | "politics"
  | "art"
  | "sport"
  | "work";

function occupationKind(occupation: string): OccupationKind {
  const key = savedKey(occupation);
  if (/medic|doctor|salud|enfermer|cirujan|odont|farmac|psicolog/.test(key)) {
    return "health";
  }
  if (/abogad|juez|fiscal|jurid|notari|legal/.test(key)) return "law";
  if (/polic|militar|soldad|guardia|seguridad|bomber|vigilante/.test(key)) {
    return "security";
  }
  if (/profesor|docente|maestr|educad|rector|pedagog/.test(key)) {
    return "education";
  }
  if (/ingenier|program|desarroll|software|tecnolog|sistem|datos|cientific/.test(key)) {
    return "tech";
  }
  if (/empresari|gerente|director|financ|contador|econom|banquer|comerciante/.test(key)) {
    return "business";
  }
  if (/politic|senador|diputad|alcalde|gobernador|president|ministr|congres/.test(key)) {
    return "politics";
  }
  if (/artist|musico|pintor|actor|actriz|escritor|periodist|comunicador|diseñador|disenador/.test(key)) {
    return "art";
  }
  if (/deport|futbol|jugador|entrenador|atleta/.test(key)) return "sport";
  return "work";
}

interface PixelPalette {
  background: string;
  skin: string;
  hair: string;
  shirt: string;
  accent: string;
}

function paletteFor(hash: number): PixelPalette {
  const skins = ["#f2c9a0", "#dba173", "#b97a4f", "#8a5a35", "#5f3d25"];
  const hairs = ["#1d1712", "#2f2118", "#4a2e1c", "#11100f", "#6b5a44"];
  const shirts = ["#3b6ea5", "#4f7d54", "#8a4b4b", "#5b5b8a", "#2f6f6f"];
  const accents = ["#d8ff3e", "#ff6b3d", "#7ad0ff", "#ffd166", "#c084fc"];
  return {
    background: "#111715",
    skin: skins[hash % skins.length] ?? skins[0]!,
    hair: hairs[(hash >>> 3) % hairs.length] ?? hairs[0]!,
    shirt: shirts[(hash >>> 6) % shirts.length] ?? shirts[0]!,
    accent: accents[(hash >>> 9) % accents.length] ?? accents[0]!,
  };
}

function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Math.max(
      0,
      Math.min(255, Number.parseInt(value.slice(offset, offset + 2), 16) + amount),
    ),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pixelSvg(
  pixels: Map<string, string>,
  background: string,
  label: string,
): OccupationImage {
  const body = [...pixels.entries()]
    .sort(([a], [b]) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return (ay ?? 0) - (by ?? 0) || (ax ?? 0) - (bx ?? 0);
    })
    .map(([key, color]) => {
      const [x, y] = key.split(",");
      return `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(
    label,
  )}"><rect width="24" height="24" fill="${background}"/>${body}</svg>`;

  return {
    mime: "image/svg+xml; charset=utf-8",
    width: 24,
    height: 24,
    bytes: new TextEncoder().encode(svg).buffer as ArrayBuffer,
    provider: "mock",
    model: "pixel-art",
  };
}

function joinEndpoint(base: string, path: string): URL {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return new URL(path.replace(/^\//, ""), normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reapiConfig(env: GeneralEnv): { key: string; base: string } | null {
  const key = env.REAPI_KEY?.trim();
  if (!key) return null;
  return { key, base: env.REAPI_BASE_URL?.trim() || REAPI_BASE_URL };
}

async function submitReapiTask(
  env: GeneralEnv,
  config: ImageProviderConfig,
  prompt: string,
): Promise<string | null> {
  const auth = reapiConfig(env);
  if (!auth) return null;
  try {
    const response = await fetch(
      joinEndpoint(auth.base, "/images/generations").toString(),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.key}`,
        },
        body: JSON.stringify({
          model: config.model,
          prompt,
          aspect_ratio: "1:1",
          n: 1,
        }),
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!isRecord(payload)) return null;
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

type ReapiOutcome =
  | { status: "completed"; imageUrl: string }
  | { status: "failed" }
  | { status: "pending" };

async function pollReapiTask(
  env: GeneralEnv,
  taskId: string,
  windowMs: number,
): Promise<ReapiOutcome> {
  const auth = reapiConfig(env);
  if (!auth) return { status: "failed" };
  const deadline = Date.now() + windowMs;

  for (;;) {
    try {
      const response = await fetch(
        joinEndpoint(
          auth.base,
          `/tasks/${encodeURIComponent(taskId)}`,
        ).toString(),
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${auth.key}`,
          },
          signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        const payload: unknown = await response.json();
        if (isRecord(payload)) {
          const status =
            typeof payload.status === "string" ? payload.status.trim() : "";
          if (status === "completed") {
            const imageUrl = reapiImageUrl(payload);
            return imageUrl
              ? { status: "completed", imageUrl }
              : { status: "failed" };
          }
          if (status === "failed") return { status: "failed" };
        }
      }
    } catch {
      // Un fallo de sondeo no cancela la tarea; se reintenta en la ventana.
    }

    if (Date.now() >= deadline) return { status: "pending" };
    await sleep(REAPI_POLL_INTERVAL_MS);
  }
}

function reapiImageUrl(payload: Record<string, unknown>): string | null {
  const output = isRecord(payload.output) ? payload.output : null;
  if (output && Array.isArray(output.image_urls)) {
    const first = output.image_urls.find(
      (item): item is string => typeof item === "string" && /^https?:\/\//i.test(item),
    );
    if (first) return first;
  }
  return null;
}

async function downloadReapiImage(imageUrl: string): Promise<OccupationImage | null> {
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS * 2),
    });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 128) return null;
    const contentType = response.headers.get("content-type") ?? "";
    const mime = contentType.split(";")[0]?.trim() || "image/webp";
    return { mime, width: IMAGE_SIZE, height: IMAGE_SIZE, bytes };
  } catch {
    return null;
  }
}

async function requestOccupationImage(
  env: GeneralEnv,
  config: ImageProviderConfig,
  occupation: string,
): Promise<OccupationImage | null> {
  const prompt = occupationImagePrompt(occupation);
  const provider = config.provider.trim().toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const request = provider === "nvidia"
      ? nvidiaImageRequest(env, config, prompt)
      : openRouterImageRequest(env, config, prompt);
    if (!request) return null;

    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return imageFromPayload(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function openRouterImageRequest(
  env: GeneralEnv,
  config: ImageProviderConfig,
  prompt: string,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (env.OPENROUTER_SITE_URL?.trim()) {
    headers["HTTP-Referer"] = env.OPENROUTER_SITE_URL.trim();
  }
  if (env.OPENROUTER_APP_NAME?.trim()) {
    headers["X-Title"] = env.OPENROUTER_APP_NAME.trim();
  }
  return {
    url: joinEndpoint(env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL, "/images/generations").toString(),
    headers,
    body: {
      model: config.model,
      prompt,
      n: 1,
      size: `${IMAGE_SIZE}x${IMAGE_SIZE}`,
      response_format: "b64_json",
    },
  };
}

function nvidiaImageRequest(
  env: GeneralEnv,
  config: ImageProviderConfig,
  prompt: string,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null {
  const key = env.NVIDIA_API_KEY?.trim();
  if (!key) return null;
  return {
    url: joinEndpoint(env.NVIDIA_BASE_URL?.trim() || NVIDIA_BASE_URL, "/images/generations").toString(),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: {
      model: config.model,
      prompt,
      n: 1,
      size: `${IMAGE_SIZE}x${IMAGE_SIZE}`,
      response_format: "b64_json",
    },
  };
}

function imageFromPayload(payload: unknown): OccupationImage | null {
  const encoded = findEncodedImage(payload);
  if (!encoded) return null;
  const bytes = bytesFromBase64(encoded.data);
  if (!bytes || bytes.byteLength < 32) return null;
  return {
    mime: encoded.mime,
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    bytes,
  };
}

function findEncodedImage(value: unknown): { mime: string; data: string } | null {
  if (typeof value === "string") return parseDataUrl(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEncodedImage(item);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  const direct =
    parseDataUrl(value.b64_json) ??
    parseDataUrl(value.b64) ??
    parseDataUrl(value.base64) ??
    parseDataUrl(value.url) ??
    parseDataUrl(value.image);
  if (direct) return direct;

  if (isRecord(value.image_url)) {
    const nested = parseDataUrl(value.image_url.url);
    if (nested) return nested;
  }

  for (const key of ["data", "images", "choices", "message", "content"]) {
    if (value[key] !== undefined) {
      const found = findEncodedImage(value[key]);
      if (found) return found;
    }
  }
  return null;
}

function parseDataUrl(value: unknown): { mime: string; data: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(trimmed);
  if (match?.[1] && match[2]) {
    return { mime: match[1], data: match[2].replace(/\s+/g, "") };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, "").length > 64) {
    return { mime: "image/png", data: trimmed.replace(/\s+/g, "") };
  }
  return null;
}

function bytesFromBase64(encoded: string): ArrayBuffer | null {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** Test helper: drop in-flight generation locks between cases. */
export function resetOccupationImageWork(): void {
  generating.clear();
}
