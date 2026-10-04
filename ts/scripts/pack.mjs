// The published manifest, in place for exactly the length of a pack.
//
//   node scripts/pack.mjs clean    empty dist/, so a removed module leaves no stale build
//   node scripts/pack.mjs pack     prepack: the tarball's package.json, LICENSE, NOTICE, README
//   node scripts/pack.mjs unpack   postpack: put the repository's package.json back
//
// `exports` in package.json points at `src/*.ts`: this repository — and any
// workspace that links the directory — runs the sources with no build step. A
// tarball must point at `dist/` instead, because Node refuses to strip types
// under node_modules. pnpm swaps in `publishConfig.exports` on its own; npm has
// no such field, so `pack` writes it over `exports` for the length of the pack
// and `unpack` restores the file. Both `npm pack` and `pnpm pack` therefore
// produce the same manifest, and `publishConfig.exports` is its one spelling.
//
// `pack` refuses a tarball that would not import: every target of the
// published map must exist for every source module the source map exposes,
// with its declarations. It also copies the repository's LICENSE and NOTICE
// (Apache-2.0 §4(a) and §4(d): a redistribution carries both) and README —
// the README through `for_npm` (scripts/npm-readme.ts), because npmjs.com
// resolves a relative link against `ts/`, where none of the README's pages
// and pictures are: in the tarball, each points at GitHub instead.
//
// A pack that dies between the two leaves the published manifest on disk; the
// next `pack` or `unpack` restores the saved one first.
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'

import { for_npm } from './npm-readme.ts'

const here = join(import.meta.dirname, '..')
const root = join(here, '..')
const manifest = join(here, 'package.json')
const saved = join(here, '.package.json.source')
const COPIED = ['LICENSE', 'NOTICE', 'README.md']

const fail = (message) => {
  process.stderr.write(`pack: ${message}\n`)
  process.exit(1)
}

const restore = () => {
  if (!existsSync(saved)) return false
  renameSync(saved, manifest)
  return true
}

/** Every file under `dir`, as paths relative to it. */
const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)).split('\\').join('/'))
    : []

/** The leaf targets of one `exports` entry: a string, or the strings of a condition object. */
const targets_of = (entry) =>
  typeof entry === 'string' ? [entry] : Object.values(entry).flatMap(targets_of)

/** What `*` stands for in each file a pattern such as `./src/packs/*.ts` matches; `[null]` without a `*`. */
const stems_of = (pattern) => {
  const star = pattern.indexOf('*')
  if (star < 0) return existsSync(join(here, pattern)) ? [null] : []
  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  const dir = prefix.slice(0, prefix.lastIndexOf('/') + 1)
  const head = prefix.slice(dir.length)
  return walk(join(here, dir))
    .filter((f) => f.startsWith(head) && f.endsWith(suffix))
    .map((f) => f.slice(head.length, f.length - suffix.length))
}

/**
 * Where a published `exports` map points at nothing. A wildcard target is
 * expanded over the modules the SOURCE map exposes under the same key, so
 * `./packs/*` → `./dist/pack/*.js` (a typo) fails for every pack.
 */
const missing = (source, published) =>
  Object.entries(published).flatMap(([key, entry]) => {
    const from = source[key]
    if (typeof from !== 'string') return [`${key}: the source map has no string target to expand`]
    const stems = stems_of(from)
    if (stems.length === 0) return [`${key}: ${from} matches no file`]
    return targets_of(entry).flatMap((target) =>
      stems
        .map((stem) => (stem === null ? target : target.split('*').join(stem)))
        .filter((file) => !existsSync(join(here, file)))
        .map((file) => `${key}: ${file} does not exist`),
    )
  })

const command = process.argv[2]

if (command === 'clean') {
  rmSync(join(here, 'dist'), { recursive: true, force: true })
} else if (command === 'pack') {
  if (restore()) process.stdout.write('pack: restored package.json left by an interrupted pack\n')
  const text = readFileSync(manifest, 'utf8')
  const pkg = JSON.parse(text)
  const published = pkg.publishConfig?.exports
  if (published === undefined) fail('package.json has no publishConfig.exports')
  const holes = missing(pkg.exports, published)
  if (holes.length > 0)
    fail(`the published exports point at missing files:\n  ${holes.join('\n  ')}`)
  for (const file of COPIED) {
    const from = join(root, file)
    if (!existsSync(from)) fail(`../${file} does not exist`)
    copyFileSync(from, join(here, file))
  }
  const is_directory = (path) =>
    existsSync(join(root, path)) && statSync(join(root, path)).isDirectory()
  writeFileSync(
    join(here, 'README.md'),
    for_npm(readFileSync(join(root, 'README.md'), 'utf8'), is_directory),
  )
  const { exports: _source, ...publishConfig } = pkg.publishConfig
  const out = { ...pkg, exports: published, publishConfig }
  if (Object.keys(publishConfig).length === 0) delete out.publishConfig
  writeFileSync(saved, text)
  writeFileSync(manifest, `${JSON.stringify(out, null, 2)}\n`)
} else if (command === 'unpack') {
  restore()
  for (const file of COPIED) rmSync(join(here, file), { force: true })
} else {
  fail(`unknown command ${command ?? '(none)'} — clean, pack or unpack`)
}
