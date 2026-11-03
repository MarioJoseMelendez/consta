-- Reserved keys in occupation_images. The worker seeds the SVG bytes on
-- first use (ensurePlaceholderImages) so the art stays in one place.
--
-- persona  generic person evidence photo; used while a portrait is pending,
--          when generation fails, or when no occupation matches.
-- empresa  building / institution photo. Companies never get generated faces.

INSERT OR IGNORE INTO occupation_images (
  occupation_key, occupation, provider, model, mime, width, height, bytes, created_at
) VALUES (
  'persona',
  'persona',
  'placeholder',
  'placeholder',
  'image/svg+xml; charset=utf-8',
  24,
  24,
  CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" shape-rendering="crispEdges" role="img" aria-label="Persona"><rect width="24" height="24" fill="#1C1C1E"/></svg>' AS BLOB),
  '2026-11-03T00:00:00.000Z'
);

INSERT OR IGNORE INTO occupation_images (
  occupation_key, occupation, provider, model, mime, width, height, bytes, created_at
) VALUES (
  'empresa',
  'empresa',
  'placeholder',
  'placeholder',
  'image/svg+xml; charset=utf-8',
  24,
  24,
  CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" shape-rendering="crispEdges" role="img" aria-label="Empresa"><rect width="24" height="24" fill="#1C1C1E"/></svg>' AS BLOB),
  '2026-11-03T00:00:00.000Z'
);
