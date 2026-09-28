// The published package, installed and used the way an outside program uses it.
//
//   node .github/smoke.mjs [repo-root] [--pack npm|pnpm] [--effect <version>]
//
// Packs `ts/` with npm (or pnpm) — its `prepack` builds `dist/` and refuses a
// published exports map that points at a missing file — and installs the
// tarball, with the peer `effect`, into a scratch project outside the
// repository. From there, by package name and through the exports map only:
//
//   1. runtime: import `sport-lang`, `sport-lang/fold` and
//      `sport-lang/packs/athletics`, and take the first conformance case
//      through the four calls of SPEC.md §4 — decode, plan, fold, compare
//      every entrant with the case's `expect`;
//   2. types: typecheck a consumer under `moduleResolution: nodenext` with
//      `skipLibCheck` off, using `ts/`'s own compiler, so a declaration that
//      does not resolve fails instead of degrading to `any`.
//
// It also asserts the install holds one copy of `effect`: a second copy makes
// schemas from one fail against values from the other.
//
// `--effect` installs another `effect` than the one the tests pin, to measure
// the peer range. Needs `npm install` in `ts/` first (for its compiler).
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { pack: { type: 'string', default: 'npm' }, effect: { type: 'string' } },
})
const root = resolve(positionals[0] ?? join(import.meta.dirname, '..'))
const ts = join(root, 'ts')
const packer = values.pack
assert.ok(packer === 'npm' || packer === 'pnpm', `--pack is npm or pnpm, not ${packer}`)

const pkg = JSON.parse(readFileSync(join(ts, 'package.json'), 'utf8'))
const effect = values.effect ?? pkg.devDependencies.effect
const tsc = join(ts, 'node_modules', '.bin', 'tsc')
assert.ok(existsSync(tsc), 'ts/node_modules/.bin/tsc is missing — run `npm install` in ts/ first')

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const scratch = mkdtempSync(join(tmpdir(), 'sport-lang-smoke-'))
const say = (line) => process.stdout.write(`smoke: ${line}\n`)

// ── pack ─────────────────────────────────────────────────────────────────────
run(
  packer,
  ['pack', ...(packer === 'npm' ? ['--loglevel=error'] : []), '--pack-destination', scratch],
  ts,
)
const tarball = readdirSync(scratch).find((f) => f.endsWith('.tgz'))
assert.ok(tarball, `${packer} pack wrote no tarball`)
assert.equal(
  JSON.parse(readFileSync(join(ts, 'package.json'), 'utf8')).exports['.'],
  pkg.exports['.'],
  'the pack left the published manifest in ts/package.json',
)
say(`${packer} pack → ${tarball}`)

// ── install, as a stranger would ─────────────────────────────────────────────
const consumer = join(scratch, 'consumer')
mkdirSync(consumer)
writeFileSync(
  join(consumer, 'package.json'),
  `${JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2)}\n`,
)
run(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    join(scratch, tarball),
    `effect@${effect}`,
  ],
  consumer,
)
const installed = JSON.parse(
  readFileSync(join(consumer, 'node_modules', 'effect', 'package.json'), 'utf8'),
).version
assert.ok(
  !existsSync(join(consumer, 'node_modules', 'sport-lang', 'node_modules')),
  'sport-lang brought its own node_modules — a second copy of effect',
)
for (const file of ['LICENSE', 'NOTICE', 'README.md']) {
  assert.ok(
    existsSync(join(consumer, 'node_modules', 'sport-lang', file)),
    `the tarball has no ${file}`,
  )
}
say(`installed into a scratch project with effect ${installed}`)

// ── 1. runtime ───────────────────────────────────────────────────────────────
const corpus = join(root, 'corpus', 'conformance')
const file = readdirSync(corpus)
  .filter((f) => f.endsWith('.json'))
  .sort()[0]
assert.ok(file, 'the conformance corpus is empty')

writeFileSync(
  join(consumer, 'main.mjs'),
  `import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import * as Schema from 'effect/Schema'
import * as lang from 'sport-lang'
import { fold } from 'sport-lang/fold'
import { athletics } from 'sport-lang/packs/athletics'

assert.equal(fold, lang.fold, 'sport-lang/fold is not the module sport-lang re-exports')
assert.ok(lang.PACKS.includes(athletics), 'sport-lang/packs/athletics is not the shipped pack')

const [path, name] = process.argv.slice(2)
const scenario = JSON.parse(readFileSync(path, 'utf8'))
const decoded = lang.decode_document(scenario.document)
assert.equal(decoded._tag, 'Success', name + ': the document did not decode')
const planned = lang.plan(decoded.success, lang.PACKS)
assert.equal(planned._tag, 'Success', name + ': the document did not plan')
const log = Schema.decodeUnknownSync(Schema.Array(lang.Observation))(scenario.log)
const states = fold(planned.success, log)
assert.deepEqual(
  states.map((s) => s.entrant).sort(),
  scenario.expect.map((e) => e.entrant).sort(),
  name + ": the fold's entrants are not the case's",
)
for (const expected of scenario.expect) {
  const got = states.find((s) => s.entrant === expected.entrant)
  assert.equal(got.standing, expected.standing, name + ': ' + expected.entrant + ' standing')
  assert.equal(lang.total_ms(got), expected.total_ms, name + ': ' + expected.entrant + ' total_ms')
}
process.stdout.write(String(states.length))
`,
)
const entrants = run('node', ['main.mjs', join(corpus, file), file], consumer)
say(`import 'sport-lang' decoded, planned and folded ${file} — ${entrants} entrants match`)

// ── 2. types ─────────────────────────────────────────────────────────────────
writeFileSync(
  join(consumer, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'es2023',
        // effect's own declarations name `Disposable` and `ReadableStream`;
        // `dom` stands in for the @types/node a Node program would have.
        lib: ['esnext', 'dom'],
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      },
      files: ['check.ts'],
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  join(consumer, 'check.ts'),
  `import * as Schema from 'effect/Schema'
import { decode_document, plan, PACKS, Observation, total_ms, type TPack } from 'sport-lang'
import { fold } from 'sport-lang/fold'
import { athletics } from 'sport-lang/packs/athletics'

export const run = (document: unknown, log: unknown): ReadonlyArray<number | null> => {
  const decoded = decode_document(document)
  if (decoded._tag === 'Failure') return []
  const planned = plan(decoded.success, PACKS)
  if (planned._tag === 'Failure') return []
  const states = fold(planned.success, Schema.decodeUnknownSync(Schema.Array(Observation))(log))
  // @ts-expect-error — total_ms is number | null; unresolved declarations would make it any
  const wrong: string = total_ms(states[0]!)
  return [wrong.length, ...states.map(total_ms)]
}
export const pack: TPack = athletics
`,
)
run(tsc, ['-p', consumer], consumer)
say('a nodenext consumer typechecks against the declarations, skipLibCheck off')

rmSync(scratch, { recursive: true, force: true })
