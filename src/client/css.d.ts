/** The build inlines stylesheets as text; the panel injects the string itself. */
declare module '*.css' {
  const css: string
  export default css
}
