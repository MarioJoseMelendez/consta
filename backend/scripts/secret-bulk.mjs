/**
 * Sube a Cloudflare solo las keys de .dev.vars que no están ya en `vars`
 * de wrangler.jsonc. `wrangler secret bulk .dev.vars` falla con CORS_ORIGINS
 * y el resto de variables públicas (code 10053).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reserved = new Set([
  "ENVIRONMENT",
  "IMAGE_PROVIDER",
  "IMAGE_MODEL",
  "CORS_ORIGINS",
  "GT_DATA_URL",
]);

const out = [];
const names = [];
for (const line of readFileSync(join(root, ".dev.vars"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!value || reserved.has(key)) continue;
  out.push(`${key}=${value}`);
  names.push(key);
}

if (names.length === 0) {
  console.error("No hay secrets en .dev.vars aparte de las vars de wrangler.");
  process.exit(1);
}

const temp = join(root, ".secrets-bulk.env");
writeFileSync(temp, `${out.join("\n")}\n`);
console.log(`Uploading secrets: ${names.join(", ")}`);

try {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "secret", "bulk", temp],
    { cwd: root, stdio: "inherit", shell: true },
  );
  process.exit(result.status ?? 1);
} finally {
  try {
    unlinkSync(temp);
  } catch {
    // ignore
  }
}
