/**
 * The README as npmjs.com shows it.
 *
 * The repository's README links its pages and pictures relatively
 * (`docs/one-event.md`, `docs/assets/logo-light.svg`), which GitHub resolves
 * against the repository root. npmjs.com resolves them against
 * `repository.directory` — `ts/` — where none of them exist, so every link
 * would 404 and every picture would break. `scripts/pack.mjs` therefore writes
 * the tarball's README through {@link for_npm}: each relative link becomes its
 * page on GitHub, and each relative picture its raw file. Nothing else in the
 * text changes, and nothing inside a fence is touched.
 *
 * `test/npm-readme.test.ts` runs it over the real README and fails if a
 * relative target survives, or if an absolute one names a file this
 * repository does not have.
 */

export const REPOSITORY = 'turbotobias/pace-geojson'
export const BRANCH = 'main'

/** Where a repository path is shown: a page (`blob`), a directory (`tree`), or its bytes (`raw`). */
export const GITHUB = {
  blob: `https://github.com/${REPOSITORY}/blob/${BRANCH}/`,
  tree: `https://github.com/${REPOSITORY}/tree/${BRANCH}/`,
  raw: `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/`,
  home: `https://github.com/${REPOSITORY}`,
} as const

/** `https:`, `mailto:`, `//host`: already absolute, so left alone. */
const is_absolute = (target: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')

/**
 * One relative target made absolute. A link goes to GitHub's page for the
 * path (a directory's listing when `is_directory` says so, or when it ends in
 * `/`); a picture goes to the raw file, which is what an `<img>` can load. A
 * bare `#anchor` is a heading of the README, so it goes to the repository's
 * front page.
 */
export const absolute = (
  target: string,
  as: 'link' | 'picture',
  is_directory: (path: string) => boolean,
): string => {
  if (is_absolute(target)) return target
  if (target.startsWith('#')) return `${GITHUB.home}${target}`
  const hash = target.indexOf('#')
  const path = (hash < 0 ? target : target.slice(0, hash)).replace(/^\.\//, '')
  const anchor = hash < 0 ? '' : target.slice(hash)
  if (as === 'picture') return `${GITHUB.raw}${path}`
  const directory = path === '' || path.endsWith('/') || is_directory(path.replace(/\/$/, ''))
  return `${directory ? GITHUB.tree : GITHUB.blob}${path}${anchor}`
}

/** `a.svg 1x, b.svg 2x`: each candidate's URL made absolute, its descriptor kept. */
const srcset = (value: string, is_directory: (path: string) => boolean): string =>
  value
    .split(',')
    .map((candidate) => {
      const [url = '', ...descriptor] = candidate.trim().split(/\s+/)
      return [absolute(url, 'picture', is_directory), ...descriptor].join(' ')
    })
    .join(', ')

/** One line of prose: Markdown links and pictures, and HTML `href`, `src` and `srcset`. */
const line_for_npm = (line: string, is_directory: (path: string) => boolean): string =>
  line
    .replace(
      /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_, bang: string, text: string, target: string) =>
        `${bang}[${text}](${absolute(target, bang === '!' ? 'picture' : 'link', is_directory)})`,
    )
    .replace(
      /\b(href|src|srcset)="([^"]*)"/g,
      (_, attribute: string, value: string) =>
        `${attribute}="${
          attribute === 'srcset'
            ? srcset(value, is_directory)
            : absolute(value, attribute === 'src' ? 'picture' : 'link', is_directory)
        }"`,
    )

/** The README with every relative link and picture made absolute; fences left exactly as they are. */
export const for_npm = (markdown: string, is_directory: (path: string) => boolean): string => {
  let fenced = false
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return line
      }
      return fenced ? line : line_for_npm(line, is_directory)
    })
    .join('\n')
}
