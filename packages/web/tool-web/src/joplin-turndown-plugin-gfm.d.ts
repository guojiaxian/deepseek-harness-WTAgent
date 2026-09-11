// Ambient typing for @joplin/turndown-plugin-gfm, which ships no declarations.
// The package exports plugin factory functions consumed by TurndownService.use().
declare module '@joplin/turndown-plugin-gfm' {
  import TurndownService from 'turndown'

  /** GitHub-flavored tables/strikethrough plugin for TurndownService.use(). */
  export function gfm(service: TurndownService): void
}
