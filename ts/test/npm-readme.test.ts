/**
 * The README the npm tarball carries: every link and picture absolute, and
 * every one of them naming something this repository holds.
 */
import { assert, describe, it } from '@effect/vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { absolute, for_npm, GITHUB } from '../scripts/npm-readme.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')
const is_directory = (path: string): boolean =>
  existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isDirectory()
const npm = for_npm(README, is_directory)

/** Every target the page points at: Markdown links and pictures, and HTML href, src and srcset. */
const targets = (markdown: string): ReadonlyArray<string> => {
  let fenced = false
  return markdown.split('\n').flatMap((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      return []
    }
    if (fenced) return []
    const links = [...line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? '')
    const attributes = [...line.matchAll(/\b(?:href|src|srcset)="([^"]*)"/g)].flatMap((m) =>
      (m[1] ?? '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? ''),
    )
    return [...links, ...attributes]
  })
}

describe('the README npm shows', () => {
  it('points at GitHub for every page and picture, never at a path npm cannot resolve', () => {
    const all = targets(npm)
    assert.isAbove(all.length, 20, 'the README links what it cites')
    for (const target of all) assert.match(target, /^https:\/\//, `${target} is still relative`)
  })

  it('names only files and directories this repository has', () => {
    let checked = 0
    for (const target of targets(npm)) {
      const [base = ''] = target.split('#')
      const prefix = [GITHUB.blob, GITHUB.tree, GITHUB.raw].find((p) => base.startsWith(p))
      if (prefix === undefined) continue
      const path = base.slice(prefix.length)
      assert.isTrue(existsSync(join(ROOT, path)), `${target}: no ${path} in the repository`)
      if (prefix === GITHUB.tree) assert.isTrue(is_directory(path), `${target} is not a directory`)
      if (prefix === GITHUB.blob) assert.isFalse(is_directory(path), `${target} is a directory`)
      checked += 1
    }
    assert.isAbove(checked, 15, 'the README links into the repository')
  })

  it('loads every picture from the raw file, in both colour schemes', () => {
    const pictures = [...npm.matchAll(/\b(?:src|srcset)="([^"]*)"/g)].map((m) => m[1] ?? '')
    for (const svg of ['logo-light', 'logo-dark', 'how-it-works-light', 'how-it-works-dark'])
      assert.include(pictures, `${GITHUB.raw}docs/assets/${svg}.svg`)
  })

  it('changes nothing but the targets', () => {
    const strip = (markdown: string) =>
      markdown.replace(/\]\([^)\s]+\)/g, '](…)').replace(/\b(href|src|srcset)="[^"]*"/g, '$1="…"')
    assert.strictEqual(strip(npm), strip(README))
  })
})

describe('absolute', () => {
  const never = () => false
  it('sends a page to GitHub with its anchor, a directory to its listing, a picture to its bytes', () => {
    assert.strictEqual(
      absolute('docs/api.md#rust', 'link', never),
      `${GITHUB.blob}docs/api.md#rust`,
    )
    assert.strictEqual(absolute('corpus/', 'link', never), `${GITHUB.tree}corpus/`)
    assert.strictEqual(
      absolute('corpus/decode', 'link', (p) => p === 'corpus/decode'),
      `${GITHUB.tree}corpus/decode`,
    )
    assert.strictEqual(absolute('./LICENSE', 'link', never), `${GITHUB.blob}LICENSE`)
    assert.strictEqual(
      absolute('docs/assets/a.svg', 'picture', never),
      `${GITHUB.raw}docs/assets/a.svg`,
    )
    assert.strictEqual(absolute('#licence', 'link', never), `${GITHUB.home}#licence`)
  })

  it('leaves an absolute target alone', () => {
    for (const target of ['https://img.shields.io/badge/x', 'mailto:a@b.c', '//cdn.example/x.svg'])
      assert.strictEqual(absolute(target, 'picture', never), target)
  })

  it('does not touch a fence', () => {
    const fenced = '```md\n[a](docs/a.md)\n```\n[a](docs/a.md)'
    assert.strictEqual(
      for_npm(fenced, never),
      `\`\`\`md\n[a](docs/a.md)\n\`\`\`\n[a](${GITHUB.blob}docs/a.md)`,
    )
  })

  it('rewrites each candidate of a srcset', () => {
    assert.strictEqual(
      for_npm('<source srcset="a.svg 1x, b.svg 2x">', never),
      `<source srcset="${GITHUB.raw}a.svg 1x, ${GITHUB.raw}b.svg 2x">`,
    )
  })
})
