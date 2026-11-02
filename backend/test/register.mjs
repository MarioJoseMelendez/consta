/**
 * Se carga con `--import=./test/register.mjs` y registra el loader de
 * `loader.mjs`, que añade `.ts` a los imports relativos sin extensión.
 */
import { register } from "node:module";

register(new URL("./loader.mjs", import.meta.url));
