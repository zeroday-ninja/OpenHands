/**
 * The `@openhands/agent-canvas/i18n` subpath.
 *
 * Everything the runtime entry (`./index`) exports, plus the embedded
 * `translationResources` a host app registers with its own i18next instance.
 * The resources stay out of `./index` on purpose: that module is in the eager
 * graph of every page, and the Vite dev server does not tree-shake, so a
 * re-export there costs every dev page load the whole catalog.
 */
export * from "./index";
export { default } from "./index";
export { translationResources, type TranslationResources } from "./resources";
