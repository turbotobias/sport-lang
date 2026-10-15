/**
 * The README and docs/, run.
 *
 * A page that shows engine output is a second copy of the engine's answers,
 * and a second copy drifts the day somebody changes the first. So nothing the
 * README or a page of docs/ shows is typed by hand and left there:
 *
 * - every `examples/<name>/` is decoded, planned and folded, and must end in
 *   its `standings.json` — which `rust/tests/examples.rs` folds too — and
 *   docs/one-event.md prints every standing and every read, the README's
 *   taste the one row it shows, and the README's picture every standing, time
 *   and sentence;
 * - every other number quoted about the 10 km (the late read, live standings,
 *   positions, the what-if, the pace, the refusals in docs/one-event.md; the
 *   rehearsal there and in docs/rehearsal.md) is computed here and looked for,
 *   verbatim, in the page that holds it;
 * - every count of the corpus a page gives (conformance cases and entrant
 *   states, decode cases by verdict, synthetic courses, the badge's total) is
 *   the corpus's own;
 * - every `json`/`jsonc` fence, in the README and in docs/, names the file it
 *   comes from on its first line — `// examples/…` (equal to that file, or to
 *   the value at `#/pointer`) or `// excerpt of examples/…` (members and
 *   elements left out, none changed; an array shown empty, with a comment,
 *   stands for its elements) — and a quoted sentence in a fence is the one
 *   `plan` generates;
 * - every `rust`, `ts` and `js` fence is one of the three quick-start files
 *   whole (all three in docs/api.md), the output a quick start ends with is
 *   what it prints, and what the TypeScript one prints for a broken document
 *   is what docs/api.md says;
 * - every call docs/api.md lists is one the package exports, and the tarball
 *   it installs is the one `npm pack` writes;
 * - every relative link, and every picture's `src` and `srcset`, resolves to a
 *   file in this repository, and every `#anchor` to a heading of the page it
 *   names;
 * - every collapsible `<details>` has the blank lines GitHub needs to render
 *   the Markdown inside it.
 */
import { assert, describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'

import * as PaceGeoJSON from '../src/index.ts'
import {
  decode_document,
  describe_issue,
  fold,
  fold_until,
  Observation,
  order_at,
  PACKS,
  plan,
  plan_at_pace,
  positions_at,
  selectivity,
  simulate,
  slowest_clear_pace,
  total_ms,
  type TEntrantState,
  type TFieldConfig,
  type TObservation,
} from '../src/index.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const text = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const README = text('README.md')
const ONE_EVENT = text('docs/one-event.md')
const REHEARSAL = text('docs/rehearsal.md')
const API = text('docs/api.md')

/** The README, CONTRIBUTING.md and every page of docs/: the text a reader of the repository is shown. */
const PAGES = [
  'README.md',
  'CONTRIBUTING.md',
  ...readdirSync(join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
]
const json = (path: string): unknown => JSON.parse(text(path))
const decode_log = Schema.decodeUnknownSync(Schema.Array(Observation))
const decode_one = Schema.decodeUnknownSync(Observation)

const Standing = Schema.Struct({
  entrant: Schema.String,
  standing: Schema.String,
  total_ms: Schema.NullOr(Schema.Finite),
  adjustment_ms: Schema.Finite,
  awards: Schema.Array(Schema.String),
  laps: Schema.Finite,
  sentences: Schema.Array(Schema.String),
})
const decode_standings = Schema.decodeUnknownSync(Schema.Array(Standing))

/** A document that decodes and plans, or the test says which of the two it failed. */
const planned = (raw: unknown) => {
  const decoded = decode_document(raw)
  if (Result.isFailure(decoded))
    return assert.fail(`did not decode: ${describe_issue(decoded.failure)}`)
  const rules = plan(decoded.success, PACKS)
  if (Result.isFailure(rules)) return assert.fail(`did not plan: ${JSON.stringify(rules.failure)}`)
  return { document: decoded.success, rules: rules.success }
}

/** Why a document that decodes will not run. */
const refusal = (raw: unknown) => {
  const decoded = decode_document(raw)
  if (Result.isFailure(decoded))
    return assert.fail(`did not decode: ${describe_issue(decoded.failure)}`)
  const rules = plan(decoded.success, PACKS)
  return Result.isFailure(rules) ? rules.failure : assert.fail('planned, and should have refused')
}

const standing_of = (s: TEntrantState) => ({
  entrant: s.entrant,
  standing: s.standing,
  total_ms: total_ms(s),
  adjustment_ms: s.adjustment_ms,
  awards: s.awards,
  laps: s.laps,
  sentences: s.applied.map((a) => a.sentence),
})

/* ── how the README spells a number ──────────────────────────────────────── */

/** `2790000` → `2 790 000`. */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** `2790000` → `46:30`; an hour or more → `1:25:00`. */
const clock = (ms: number): string => {
  const s = Math.round(ms / 1000)
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

/** `2027-05-02T07:46:30.000Z` → `07:46:30`. */
const hms = (t: DateTime.Utc): string => DateTime.formatIso(t).slice(11, 19)

/* ── the examples ────────────────────────────────────────────────────────── */

const EXAMPLES = readdirSync(join(ROOT, 'examples'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'examples', d.name, 'document.json')))
  .map((d) => `examples/${d.name}`)

describe('the examples', () => {
  it('exist', () => {
    assert.include(EXAMPLES, 'examples/10k')
  })

  for (const dir of EXAMPLES) {
    it(`${dir} folds to its standings, and the pages print them`, () => {
      const { rules } = planned(json(`${dir}/document.json`))
      const log = decode_log(json(`${dir}/log.json`))
      const want = decode_standings(json(`${dir}/standings.json`))
      assert.deepStrictEqual(fold(rules, log).map(standing_of), want)

      for (const s of want) {
        const total = s.total_ms === null ? '—' : `${grouped(s.total_ms)} (${clock(s.total_ms)})`
        const row = [
          `\`${s.entrant}\``,
          s.standing,
          total,
          grouped(s.adjustment_ms),
          s.awards.length > 0 ? s.awards.join(', ') : '—',
          s.sentences.length > 0 ? s.sentences.join(' ') : '—',
        ]
        assert.include(
          ONE_EVENT,
          `| ${row.join(' | ')} |`,
          `${dir}: docs/one-event.md's row for ${s.entrant}`,
        )
      }

      // The log table: one row per entrant, carrying every time that entrant was seen.
      const entrants = log.map((o) => o.entrant).filter((e, i, all) => all.indexOf(e) === i)
      for (const entrant of entrants) {
        const times = log.filter((o) => o.entrant === entrant).map((o) => hms(o.t))
        const rows = ONE_EVENT.split('\n').filter((l) => l.startsWith(`| \`${entrant}\` |`))
        assert.isTrue(
          rows.some((row) => times.every((t) => row.includes(t))),
          `${dir}: no row of docs/one-event.md for ${entrant} shows ${times.join(', ')}`,
        )
      }
    })
  }
})

describe('the README, on the 10 km', () => {
  const want = decode_standings(json('examples/10k/standings.json'))

  it('shows the row fold writes, for every entrant its taste shows', () => {
    const shown = README.split('\n').filter((l) => /^\| `ent_[a-z]+` \|/.test(l))
    assert.isAbove(shown.length, 0, 'the taste shows a row')
    for (const line of shown) {
      const entrant = /^\| `(ent_[a-z]+)`/.exec(line)?.[1]
      const s =
        want.find((w) => w.entrant === entrant) ?? assert.fail(`${entrant} is not in the field`)
      const total = s.total_ms === null ? '—' : clock(s.total_ms)
      const why = s.sentences.length > 0 ? s.sentences.join(' ') : '—'
      assert.strictEqual(line, `| \`${s.entrant}\` | **${s.standing}** | ${total} | ${why} |`)
    }
  })

  // The picture is drawn by hand, so it is held to the engine like any page.
  for (const scheme of ['light', 'dark']) {
    it(`draws every standing, time and sentence in its ${scheme} picture`, () => {
      const svg = text(`docs/assets/how-it-works-${scheme}.svg`)
      const labels = [...svg.matchAll(/>([^<>]+)</g)]
        .map((m) => (m[1] ?? '').trim())
        .filter((label) => label !== '')
      for (const s of want) {
        const name = s.entrant.replace('ent_', '')
        const at = labels.indexOf(name)
        assert.isAtLeast(at, 0, `${scheme}: ${name} is drawn`)
        // Each entrant's row is its name, its standing, its time, then any tag, then its sentence.
        const row = labels.slice(at, at + 5)
        assert.strictEqual(row[1], s.standing, `${scheme}: ${name}'s standing`)
        assert.strictEqual(
          row[2],
          s.total_ms === null ? '—' : clock(s.total_ms),
          `${scheme}: ${name}'s time`,
        )
        for (const sentence of s.sentences)
          assert.include(row, sentence, `${scheme}: ${name}'s sentence`)
        for (const award of s.awards) assert.include(row, award, `${scheme}: ${name}'s award`)
        if (s.adjustment_ms > 0)
          assert.include(row, `+${clock(s.adjustment_ms)}`, `${scheme}: ${name}'s penalty`)
      }
      // Every read it draws is one the log holds, at that time, at that place.
      const log = decode_log(json('examples/10k/log.json'))
      const reads = [...svg.matchAll(/>(\d\d:\d\d:\d\d)<\/tspan>\s+(\w+)\s+(\w+)\s+([\w-]+)</g)]
      assert.isAbove(reads.length, 3, `${scheme}: the picture draws reads`)
      for (const [, t, name, kind, point] of reads)
        assert.isTrue(
          log.some(
            (o) =>
              hms(o.t) === t &&
              o.entrant === `ent_${name}` &&
              o.kind === kind &&
              o.at.point === point,
          ),
          `${scheme}: the log has no ${name} ${kind} at ${point} at ${t}`,
        )
      assert.include(svg, `… ${log.length} rows`, `${scheme}: the picture counts the log`)
    })
  }
})

/* ── everything else the pages say about the 10 km ───────────────────────── */

describe('the 10 km, beyond its standings', () => {
  const raw = json('examples/10k/document.json')
  const { document, rules } = planned(raw)
  const log = decode_log(json('examples/10k/log.json'))
  const at = (t: string) => DateTime.makeUnsafe(`2027-05-02T${t}Z`)
  const who = (states: ReadonlyArray<TEntrantState>, entrant: string) => {
    const state = states.find((s) => s.entrant === entrant)
    return state === undefined ? assert.fail(`${entrant} is not in the field`) : state
  }

  it('is a conformance case: the corpus carries these very files and these standings', () => {
    // The README's race is held to both engines by the corpus runners, not
    // only by this file. The case is a copy, so this is what keeps it one.
    const kase = json('corpus/conformance/example-10k-the-readme-race.json')
    const standings = decode_standings(json('examples/10k/standings.json'))
    assert.deepStrictEqual(kase, {
      name: 'example-10k-the-readme-race',
      why: Schema.decodeUnknownSync(Schema.Struct({ why: Schema.String }))(kase).why,
      document: raw,
      log: json('examples/10k/log.json'),
      expect: standings.map((standing) => Struct.omit(standing, ['sentences'])),
    })
  })

  it('a late read is one more row, and the answer changes', () => {
    const late = decode_one(json('examples/10k/late-read.json'))
    const before = who(fold(rules, log), 'ent_cy')
    const cy = who(fold(rules, [...log, late]), 'ent_cy')
    assert.strictEqual(cy.standing, 'clean')
    const total = total_ms(cy) ?? assert.fail('ent_cy has no total')
    assert.strictEqual(total, 3_120_000)
    assert.include(ONE_EVENT, `\`ent_cy\` is **clean at ${grouped(total)} (${clock(total)})**`)
    assert.include(README, `${before.standing} becomes ${cy.standing}`)
  })

  it('live: the flag lands at once, the station and the award wait', () => {
    const early = fold_until(rules, log, at('07:30:00.000'))
    assert.deepStrictEqual(
      early.map((s) => [s.entrant, s.standing, s.awards.length]),
      [
        ['ent_ana', 'clean', 0],
        ['ent_ben', 'clean', 0],
        ['ent_cy', 'clean', 0],
        ['ent_dee', 'clean', 0],
        ['ent_eve', 'disqualified', 0],
      ],
    )
    const later = fold_until(rules, log, at('07:50:00.000'))
    assert.deepStrictEqual(
      later.map((s) => [s.entrant, s.standing, s.awards.join()]),
      [
        ['ent_ana', 'clean', 'sub-50'],
        ['ent_ben', 'gated', ''],
        ['ent_cy', 'clean', ''],
        ['ent_dee', 'clean', 'sub-50'],
        ['ent_eve', 'disqualified', ''],
      ],
    )
  })

  it('positions at 07:30, all of them between two reads', () => {
    const order = order_at(positions_at(log, at('07:30:00.000')))
    assert.isTrue(order.every((p) => p.between))
    const said = order
      .map((p) => `${p.entrant.replace('ent_', '')} ${grouped(Math.round(p.along_m))} m`)
      .join(', ')
    assert.strictEqual(said, 'ana 6 633 m, dee 6 250 m, cy 5 769 m, eve 5 690 m, ben 3 659 m')
    assert.include(ONE_EVENT, said)
  })

  it('the what-if: a virtual punch either side of the gate, a millisecond apart', () => {
    const asked = log.filter(
      (o) => DateTime.toEpochMillis(o.t) <= DateTime.toEpochMillis(at('07:30:00.000')),
    )
    const punch = (t: string): TObservation =>
      decode_one({
        id: 'obs_what_if',
        entrant: 'ent_ben',
        at: { point: 'km-5', along_m: 5000 },
        kind: 'punched',
        t: `2027-05-02T${t}Z`,
        quantity_name: null,
        quantity_value: null,
        flags: [],
        source: 'virtual',
        device: null,
        confidence: 1,
        supersedes: null,
      })
    const ben = (t: string) => who(fold(rules, [...asked, punch(t)]), 'ent_ben').standing
    assert.strictEqual(ben('07:40:00.000'), 'clean')
    assert.strictEqual(ben('07:40:00.001'), 'gated')
    assert.include(ONE_EVENT, 'At 07:40:00.000, clean. At 07:40:00.001, gated.')
    assert.include(README, "At 07:40:00.000 he'd have been clean; at 07:40:00.001, gated.")
  })

  it('the slowest pace that clears every cut-off, and either side of it', () => {
    const gun = at('07:00:00.000')
    const pace = slowest_clear_pace(document, rules, gun) ?? assert.fail('no pace clears')
    const said = (Math.floor(pace * 100) / 100).toFixed(2)
    assert.strictEqual(said, '479.99')
    assert.include(ONE_EVENT, `${said} s/km, an 8:00/km day`)

    const on = plan_at_pace(document, rules, { start_at: gun, pace_s_per_km: 480 })
    const km5 = on?.stops.find((s) => s.id === 'km-5') ?? assert.fail('no stop at km-5')
    assert.strictEqual(on?.standing, 'clean')
    assert.strictEqual(DateTime.formatIso(km5.at), '2027-05-02T07:40:00.000Z')
    const over = plan_at_pace(document, rules, { start_at: gun, pace_s_per_km: 481 })
    assert.strictEqual(over?.standing, 'gated')
    assert.strictEqual(over?.judged_at?.id, 'km-5')
  })

  it('refusals: a station at a mat, and a dialect this build does not ship', () => {
    const compact = JSON.stringify(raw)
    assert.include(compact, '"kind":"control"')
    const mat = refusal(JSON.parse(compact.replace('"kind":"control"', '"kind":"mat"')))
    assert.deepStrictEqual(mat.missing_dialects, [])
    assert.deepStrictEqual(mat.refused, [])
    assert.deepStrictEqual(mat.broken, [
      {
        law: 'a rule requires an observation the place never produces',
        what: 'rul_station wants punched at km-5, a mat which produces passed',
      },
    ])
    for (const b of mat.broken) assert.include(ONE_EVENT, `\`${b.law}\`, \`${b.what}\``)

    const ski = refusal(
      JSON.parse(
        compact.replace(
          '"pace:dialects":["athletics@1"]',
          '"pace:dialects":["athletics@1","ski@1"]',
        ),
      ),
    )
    assert.deepStrictEqual(ski, {
      unknown_version: null,
      missing_dialects: ['ski@1'],
      refused: [],
      broken: [],
    })
    assert.include(ONE_EVENT, '`missing_dialects: ["ski@1"]`')
  })

  it('the rehearsal: a thousand ghosts, and which rule fired for how many', () => {
    const field = (pace_s_per_km: number, pace_spread: number, dnf: number): TFieldConfig => ({
      seed: 7,
      entrants: 1000,
      start_at: at('07:00:00.000'),
      pace_s_per_km,
      pace_spread,
      wave_gap_s: 0,
      wave_size: 1,
      mat_miss: 0.01,
      read_jitter_s: 2,
      dnf,
      flags: [{ name: 'outside_help', chance: 0.001 }],
      quantities: [],
      corral_s: 0,
    })
    const rehearse = (config: TFieldConfig) => {
      const states = fold(rules, simulate(document, config))
      const count = (standing: string) => states.filter((s) => s.standing === standing).length
      const fired = (id: string) =>
        selectivity(rules, states).find((r) => r.id_rule === id)?.fires_for ?? 0
      return { states, count, fired }
    }

    const rows = [
      { label: 'median 6:00/km, spread 25 %', config: field(360, 0.25, 0), gated_pct: 8 },
      { label: 'median 6:30/km, spread 30 %', config: field(390, 0.3, 0), gated_pct: 19 },
    ]
    for (const { label, config, gated_pct } of rows) {
      const { states, count, fired } = rehearse(config)
      // Nobody stops, and every ghost passes 5 km: a station penalty can only be a dropped read.
      assert.isFalse(states.some((s) => s.withdrew))
      const row = [
        label,
        count('clean'),
        count('penalised'),
        count('gated'),
        count('disqualified'),
        states.filter((s) => s.awards.includes('sub-50')).length,
        fired('rul_station'),
      ]
      assert.include(REHEARSAL, `| ${row.join(' | ')} |`, label)
      assert.strictEqual(Math.round((count('gated') / states.length) * 100), gated_pct)
      for (const page of [ONE_EVENT, README])
        assert.include(page, `the station rule fired ${fired('rul_station')} times`, label)
    }
    for (const page of [ONE_EVENT, REHEARSAL]) assert.include(page, 'turns 8 % gated into 19 %')

    const stopping = rehearse(field(390, 0.3, 0.03))
    const penalised = stopping.states.filter((s) => s.standing === 'penalised')
    const stopped_short = penalised.filter((s) =>
      s.seen.some((o) => o.kind === 'withdrew' && o.at.along_m < 5000),
    )
    assert.include(
      REHEARSAL,
      `penalties rise to ${penalised.length}, and ${stopped_short.length} of those are runners who stopped before 5 km`,
    )
    // The known gap it demonstrates quotes the same count, wherever the line breaks.
    assert.include(
      text('docs/known-gaps.md').replace(/\s+/g, ' '),
      `it in ${stopped_short.length} of ${penalised.length} penalties`,
    )
  })
})

/* ── the README's own text ───────────────────────────────────────────────── */

type TFence = { readonly lang: string; readonly line: number; readonly body: string }

const fences = (markdown: string): ReadonlyArray<TFence> => {
  const out: Array<TFence> = []
  const lines = markdown.split('\n')
  let open: { lang: string; line: number; body: Array<string> } | null = null
  lines.forEach((line, i) => {
    const fence = /^```(\S*)\s*$/.exec(line)
    if (open === null && fence !== null) open = { lang: fence[1] ?? '', line: i + 1, body: [] }
    else if (open !== null && line === '```') {
      out.push({ lang: open.lang, line: open.line, body: open.body.join('\n') })
      open = null
    } else if (open !== null) open.body.push(line)
  })
  return out
}

/** RFC 6901, over parsed JSON. */
const pointer = (value: unknown, path: string): unknown =>
  path
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((at, key) => {
      if (Array.isArray(at)) return at[Number(key)]
      if (at !== null && typeof at === 'object') return Object.fromEntries(Object.entries(at))[key]
      return undefined
    }, value)

/**
 * `part` is `whole` with members and elements left out, and nothing changed:
 * an object's members are a subset, an array's elements a subsequence, and
 * everything else equal.
 */
const within = (part: unknown, whole: unknown): boolean => {
  if (Array.isArray(part)) {
    if (!Array.isArray(whole)) return false
    let i = 0
    for (const element of part) {
      while (i < whole.length && !within(element, whole[i])) i += 1
      if (i === whole.length) return false
      i += 1
    }
    return true
  }
  if (part !== null && typeof part === 'object') {
    if (whole === null || typeof whole !== 'object' || Array.isArray(whole)) return false
    const members = Object.fromEntries(Object.entries(whole))
    return Object.entries(part).every(
      ([k, v]) => Object.hasOwn(members, k) && within(v, members[k]),
    )
  }
  return part === whole
}

const MARKER = /^\/\/ (excerpt of )?((?:examples|corpus)\/\S+?\.json)(#\S+)?\s*$/

describe('the README and docs/', () => {
  const blocks_of = PAGES.map((page) => ({ page, blocks: fences(text(page)) }))
  const blocks_in = (page: string) => blocks_of.find((b) => b.page === page)?.blocks ?? []

  it('show only JSON that is a file, or an excerpt of one', () => {
    assert.isAbove(
      blocks_in('README.md').filter((b) => b.lang === 'json' || b.lang === 'jsonc').length,
      2,
    )
    for (const { page, blocks } of blocks_of) {
      for (const block of blocks.filter((b) => b.lang === 'json' || b.lang === 'jsonc')) {
        const lines = block.body.split('\n')
        assert.match(
          lines[0] ?? '',
          MARKER,
          `${page}:${block.line}: a JSON block names its source first`,
        )

        // One segment per marker: the marker, then the value it names.
        const segments: Array<{ marker: RegExpExecArray; lines: Array<string> }> = []
        for (const line of lines) {
          const marker = MARKER.exec(line.trim())
          if (marker !== null) segments.push({ marker, lines: [] })
          else segments[segments.length - 1]?.lines.push(line)
        }

        for (const { marker, lines: body } of segments) {
          const [, excerpt, path = '', at = '#'] = marker
          const where = `${page}:${block.line} (${path}${at})`
          const shown: unknown = JSON.parse(
            body
              .filter((l) => !l.trim().startsWith('//'))
              .join('\n')
              .replace(/,(\s*[}\]])/g, '$1'),
          )
          const source = pointer(json(path), at.slice(1))
          if (excerpt === undefined) assert.deepStrictEqual(shown, source, where)
          else
            assert.isTrue(
              within(shown, source),
              `${where}: the excerpt changes what the file holds`,
            )

          // A quoted sentence is the one the engine writes for that rule.
          const said = body.flatMap((l) => /^\s*\/\/ "([^"]+)"/.exec(l)?.[1] ?? [])
          if (said.length === 0) continue
          const rules_at = at.slice(1).replace(/\/pace:rules\/\d+$/, '')
          const id = pointer(shown, '/id')
          const rule = planned(pointer(json(path), rules_at)).rules.find((r) => r.id === id)
          assert.deepStrictEqual(said, [rule?.sentence], where)
        }
      }
    }
  })

  it('show each quick start whole, once, and nothing else in rust, ts or js', () => {
    const files = [
      { lang: 'rust', path: 'rust/examples/quickstart.rs', page: 'docs/api.md' },
      { lang: 'ts', path: 'ts/examples/quickstart.ts', page: 'docs/api.md' },
      { lang: 'js', path: 'wasm/quickstart.mjs', page: 'docs/api.md' },
    ]
    for (const { lang, path, page } of files) {
      const everywhere = blocks_of.flatMap((b) => b.blocks.filter((block) => block.lang === lang))
      assert.lengthOf(everywhere, 1, `one ${lang} block across the pages`)
      const shown = blocks_in(page).filter((b) => b.lang === lang)
      assert.lengthOf(shown, 1, `the ${lang} block is in ${page}`)
      assert.strictEqual(shown[0]?.body, text(path).trimEnd(), `the ${lang} block is ${path}`)
    }
  })

  /** The lines a quick start ends with, after `// $ command`. */
  const printed = (path: string): string => {
    const lines = text(path).trimEnd().split('\n')
    const from = lines.findIndex((l) => l.startsWith('// $ '))
    assert.isAbove(from, 0, `${path} ends with the output it prints`)
    return lines
      .slice(from + 1)
      .map((l) => l.replace(/^\/\/ /, ''))
      .join('\n')
  }
  const run = (path: string, cwd = ROOT): string =>
    execFileSync(process.execPath, [join(ROOT, path)], { cwd, encoding: 'utf8' }).trimEnd()

  // A child Node takes 0.2 s alone; the long timeout is for a loaded machine,
  // where the default 5 s has been seen to run out.
  const CHILD_MS = 30_000

  it(
    'the TypeScript quick start prints what it says it prints',
    () => {
      assert.strictEqual(run('ts/examples/quickstart.ts'), printed('ts/examples/quickstart.ts'))
    },
    CHILD_MS,
  )

  it(
    'the TypeScript quick start says what is wrong with a broken document, and where',
    () => {
      // The first mistake a stranger makes is a member left out. The quick
      // start reads `examples/10k/` from where it runs, so it runs in a copy
      // with one member taken away.
      const dir = mkdtempSync(join(tmpdir(), 'pace-geojson-readme-'))
      try {
        mkdirSync(join(dir, 'examples'))
        cpSync(join(ROOT, 'examples/10k'), join(dir, 'examples/10k'), { recursive: true })
        const whole = JSON.stringify(json('examples/10k/document.json'))
        const broken = whole.replace(',"ascent_threshold_m":null', '')
        assert.notStrictEqual(broken, whole, 'the member to leave out is in the document')
        writeFileSync(join(dir, 'examples/10k/document.json'), broken)
        const [first = '', second = ''] = run('ts/examples/quickstart.ts', dir).split('\n')
        assert.strictEqual(first, 'malformed: the document did not decode: Missing key')
        assert.strictEqual(second.trim(), 'at ["pace:measure"]["ascent_threshold_m"] []')
        assert.include(API, `prints\n\`${first}\`, then`)
        assert.include(API, `\`${second.trim().replace(/ \[\]$/, '')}\``)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    CHILD_MS,
  )

  it('docs/api.md lists only what the package exports', () => {
    const api = fences(API).find((b) => b.lang === 'text' && b.body.startsWith('the whole call'))
    const listed = (api?.body ?? '')
      .split('\n')
      .flatMap((l) => /^ {2}([A-Za-z_]+)\b/.exec(l)?.[1] ?? [])
    assert.isAbove(listed.length, 20, 'docs/api.md lists the calls')
    for (const name of listed) assert.property(PaceGeoJSON, name, `docs/api.md lists ${name}`)
  })

  it('docs/api.md installs the tarball npm pack writes', () => {
    const Manifest = Schema.Struct({ name: Schema.String, version: Schema.String })
    const { name, version } = Schema.decodeUnknownSync(Manifest)(json('ts/package.json'))
    const named = [...API.matchAll(/[\w.-]+\.tgz/g)].map((m) => m[0])
    assert.isAbove(named.length, 1, 'docs/api.md packs the tarball and installs it')
    for (const tgz of named) assert.strictEqual(tgz, `${name}-${version}.tgz`)
  })

  // Built by `wasm-pack build wasm --target nodejs --out-dir pkg-node --release`;
  // CI builds it first and sets PACE_GEOJSON_REQUIRE_CORE=1, so there this runs.
  const core = existsSync(join(ROOT, 'wasm/pkg-node/pace_geojson_wasm.js'))
  it.skipIf(!core && process.env['PACE_GEOJSON_REQUIRE_CORE'] !== '1')(
    'the WebAssembly quick start prints what it says it prints',
    () => {
      assert.strictEqual(run('wasm/quickstart.mjs'), printed('wasm/quickstart.mjs'))
    },
    CHILD_MS,
  )

  it('link only to files in this repository, and to headings that exist', () => {
    /** Markdown without its fences: a `#` or a `](` inside code is not a heading or a link. */
    const prose = (markdown: string): string => {
      let inside = false
      return markdown
        .split('\n')
        .filter((line) => {
          if (line.startsWith('```')) inside = !inside
          return !inside && !line.startsWith('```')
        })
        .join('\n')
    }
    const slug = (heading: string) =>
      heading
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-')
    const headings = (path: string) =>
      prose(text(path))
        .split('\n')
        .filter((l) => /^#{1,6} /.test(l))
        .map((l) => slug(l.replace(/^#+ /, '')))

    /** Markdown links, and the pictures a `<source srcset>` or an `<img src>` loads. */
    const targets = (markdown: string) => [
      ...[...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => [m[0], m[1] ?? ''] as const),
      ...[...markdown.matchAll(/\b(?:src|srcset)="([^"]*)"/g)].flatMap((m) =>
        (m[1] ?? '').split(',').map((c) => [m[0], c.trim().split(/\s+/)[0] ?? ''] as const),
      ),
    ]

    let checked = 0
    for (const page of PAGES) {
      for (const [link, target] of targets(prose(text(page)))) {
        if (/^[a-z]+:/i.test(target)) continue // https:, mailto: — not this repository's
        const [file = '', anchor] = target.split('#')
        const path = file === '' ? page : normalize(join(dirname(page), file))
        const where = `${page} links ${link}`
        assert.isFalse(path.startsWith('..'), `${where}: outside the repository`)
        assert.isTrue(existsSync(join(ROOT, path)), `${where}: no such file`)
        if (anchor !== undefined)
          assert.include(headings(path), anchor, `${where}: no such heading`)
        checked += 1
      }
    }
    assert.isAbove(checked, 40, 'the pages link to what they cite')
  })

  it('leave GitHub the blank lines it needs to render Markdown inside a <details>', () => {
    let seen = 0
    for (const page of PAGES) {
      const lines = text(page).split('\n')
      lines.forEach((line, i) => {
        if (line.startsWith('<summary>')) {
          seen += 1
          assert.match(line, /<\/summary>$/, `${page}:${i + 1}: a <summary> on one line`)
          assert.strictEqual(lines[i + 1], '', `${page}:${i + 2}: a blank line after <summary>`)
        }
        if (line === '</details>')
          assert.strictEqual(lines[i - 1], '', `${page}:${i}: a blank line before </details>`)
      })
    }
    assert.isAbove(seen, 3, 'the pages fold their asides')
  })

  it('count the corpus as it is', () => {
    const cases = (dir: string) =>
      readdirSync(join(ROOT, 'corpus', dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => json(`corpus/${dir}/${f}`))
    const Conformance = Schema.Struct({ expect: Schema.Array(Schema.Unknown) })
    const Decode = Schema.Struct({ expect: Schema.Struct({ verdict: Schema.String }) })
    const conformance = cases('conformance').map((c) => Schema.decodeUnknownSync(Conformance)(c))
    const decode = cases('decode').map((c) => Schema.decodeUnknownSync(Decode)(c).expect.verdict)
    const verdicts = (v: string) => String(decode.filter((d) => d === v).length)
    const states = grouped(conformance.reduce((n, c) => n + c.expect.length, 0))
    const every = String(conformance.length + decode.length)
    const courses = String(
      readdirSync(join(ROOT, 'corpus/courses')).filter((f) => f !== 'index.json').length,
    )

    // Each pattern names what it counts; every match, on every page, must say the corpus's number.
    const claims: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]> = [
      [/(\d+) conformance cases/g, [String(conformance.length)]],
      [
        /(\d+) conformance cases covering (\d[\d ]*\d) entrant states/g,
        [String(conformance.length), states],
      ],
      [/(\d+) cases, (\d[\d ]*\d) entrant states/g, [String(conformance.length), states]],
      [/(\d+) decode cases/g, [String(decode.length)]],
      [
        /(\d+) (?:decode )?cases:? \(?(\d+) accept, (\d+) reject, (\d+) refuse/g,
        [String(decode.length), verdicts('accepts'), verdicts('rejects'), verdicts('refuses')],
      ],
      [/(\d+) synthetic courses/g, [courses]],
      // The badge counts both corpora: in the picture's address, and in the words beside it.
      [/badge\/(\d+)%20test%20cases/g, [every]],
      [/(\d+) public test cases/g, [every]],
    ]
    let checked = 0
    for (const page of [...PAGES, 'SPEC.md', 'CHANGELOG.md']) {
      const flat = text(page).replace(/\*\*/g, '').replace(/\s+/g, ' ')
      for (const [pattern, want] of claims)
        for (const match of flat.matchAll(pattern)) {
          assert.deepStrictEqual(match.slice(1), want, `${page}: "${match[0]}"`)
          checked += 1
        }
    }
    assert.isAbove(checked, 8, 'the pages count the corpus')
  })
})
