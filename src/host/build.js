/**
 * Build identity, visible from both the HTTP API and the agent tools.
 *
 * Added after several rounds of "did my change actually load?" — with the value
 * only inside a tool, the only way to check was to ask the agent and parse its
 * prose. Exposing the same string on an endpoint makes it one curl away.
 *
 * Bump this whenever a change needs to be observable at runtime.
 */
export const BUILD = 'build@2026-11-06T20:50'
