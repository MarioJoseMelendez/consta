#!/usr/bin/env node
/**
 * Smoke test sin dependencias para @consta/gt-data.
 * Uso: node scripts/smoke.mjs
 *      BASE_URL=http://localhost:8788 node scripts/smoke.mjs
 */

const baseUrl = (process.env.BASE_URL || "http://localhost:8788").replace(/\/+$/, "");
let failures = 0;
let checks = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

function hasErrorShape(body) {
  return (
    body &&
    typeof body === "object" &&
    body.error &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  );
}

async function main() {
  console.log(`Smoke @consta/gt-data → ${baseUrl}\n`);

  const root = await call("/");
  check("GET /", root.response.status === 200, `status ${root.response.status}`);
  check("GET / service", root.body?.service === "consta-gt-data");
  check("GET / country", root.body?.country === "GT");

  const manifest = await call("/manifest");
  check("GET /manifest", manifest.response.status === 200, `status ${manifest.response.status}`);
  check("manifest contract", manifest.body?.contract === "channel/v1");
  check("manifest country", manifest.body?.country === "GT");
  check("manifest licensable", Boolean(manifest.body?.license?.id));
  const requiredCapabilities = ["search", "entity", "relationships", "evidence", "document"];
  check(
    "manifest capabilities",
    requiredCapabilities.every((capability) =>
      (manifest.body?.capabilities ?? []).includes(capability),
    ),
  );

  const health = await call("/health");
  check("GET /health", health.response.status === 200, `status ${health.response.status}`);
  check("health service", health.body?.service === "consta-gt-data");
  check("health mode", health.body?.mode === "demo" || health.body?.mode === "d1");
  check("health sources", Array.isArray(health.body?.sources));
  const mode = health.body?.mode === "d1" ? "d1" : "demo";
  console.log(`      modo detectado: ${mode}`);

  check("header X-Consta-Mode", health.response.headers.get("x-consta-mode") === mode);
  if (mode === "demo") {
    check("demo header", health.response.headers.get("x-consta-demo") === "true");
    check("health demo flag", health.body?.demo === true);
  }

  const preflight = await call("/manifest", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  check(
    "CORS preflight localhost:3000",
    preflight.response.status === 204 || preflight.response.status === 200,
    `status ${preflight.response.status}`,
  );
  check(
    "CORS allow origin",
    preflight.response.headers.get("access-control-allow-origin") === "http://localhost:3000",
  );

  const search = await call("/tools/search_entities?q=nexo&limit=5");
  check("GET search", search.response.status === 200, `status ${search.response.status}`);
  check("search items", Array.isArray(search.body?.items));
  check(
    "search item shape",
    (search.body?.items ?? []).every(
      (item) => typeof item.title === "string" && item.title.length > 0 && typeof item.url === "string" && item.url.length > 0,
    ),
  );

  let entityId = search.body?.items?.[0]?.id;
  if (!entityId && mode === "demo") entityId = "gt-nit:90000017";

  if (entityId) {
    const encoded = encodeURIComponent(entityId);
    const entity = await call(`/tools/get_entity?id=${encoded}`);
    const entityOk = entity.response.status === 200 || (mode === "d1" && entity.response.status === 404);
    check("GET entity", entityOk, `status ${entity.response.status}`);
    if (entity.response.status === 200) {
      check("entity bundle", Boolean(entity.body?.entity?.id));
      check("entity relationships", Array.isArray(entity.body?.relationships));
      check("entity evidence", Array.isArray(entity.body?.evidence));
    }

    const relationships = await call(`/tools/get_relationships?id=${encoded}`);
    const relationshipsOk =
      relationships.response.status === 200 ||
      (mode === "d1" && relationships.response.status === 404);
    check("GET relationships", relationshipsOk, `status ${relationships.response.status}`);
    if (relationships.response.status === 200) {
      check("relationships array", Array.isArray(relationships.body?.relationships));
    }
  } else {
    console.log("SKIP  entity routes — sin entidades en el snapshot");
  }

  const evidence = await call("/tools/get_evidence");
  check("GET evidence", evidence.response.status === 200, `status ${evidence.response.status}`);
  check("evidence items", Array.isArray(evidence.body?.items));
  const evidenceId = evidence.body?.items?.[0]?.id;

  if (evidenceId) {
    const filtered = await call(`/tools/get_evidence?ids=${encodeURIComponent(evidenceId)}`);
    check("GET evidence filter", filtered.response.status === 200);
    check(
      "evidence filter id",
      (filtered.body?.items ?? []).some((item) => item.id === evidenceId),
    );

    const source = evidence.body.items[0];
    check(
      "evidence license + retrievedAt",
      typeof source.license === "string" && source.license.length > 0 && typeof source.retrievedAt === "string",
    );
  }

  const documentId = mode === "demo" ? "doc-demo-rgae-prov" : "doc-inexistente-smoke";
  const document = await call(`/tools/get_document?id=${encodeURIComponent(documentId)}`);
  const documentOk =
    document.response.status === 200 || (mode === "d1" && document.response.status === 404);
  check("GET document", documentOk, `status ${document.response.status}`);
  if (document.response.status === 200) {
    check(
      "document metadata",
      Boolean(document.body?.id && document.body?.title && document.body?.url && document.body?.license && document.body?.content_type && document.body?.retrievedAt),
    );
  }

  const missingId = await call("/tools/get_entity");
  check("entity missing id", missingId.response.status === 400, `status ${missingId.response.status}`);
  check("entity missing id shape", hasErrorShape(missingId.body));

  const badLimit = await call("/tools/search_entities?limit=0");
  check("search bad limit", badLimit.response.status === 400, `status ${badLimit.response.status}`);
  check("search bad limit shape", hasErrorShape(badLimit.body));

  const ssrf = await call("/tools/get_document?url=https%3A%2F%2Fexample.com%2Ffile.pdf");
  check("document rejects url", ssrf.response.status === 400, `status ${ssrf.response.status}`);
  check("document rejects url shape", hasErrorShape(ssrf.body));

  const notFound = await call("/ruta-inexistente");
  check("404 route", notFound.response.status === 404, `status ${notFound.response.status}`);
  check("404 error shape", hasErrorShape(notFound.body));

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) {
    console.log(`${failures} fallo(s)`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Smoke abortado:", error);
  process.exitCode = 1;
});
