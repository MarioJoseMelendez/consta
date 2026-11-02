/**
 * Loader de pruebas: resuelve imports relativos sin extensión a `.ts`.
 * Node 22 ejecuta TypeScript con --experimental-strip-types, pero no adivina
 * la extensión, así que el test importa `../src/sourceScore.ts` o sin sufijo.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {}
  }
  return next(specifier, context);
}
