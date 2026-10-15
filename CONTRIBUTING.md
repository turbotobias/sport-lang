# Contributing to pace-geojson

pace-geojson is meant to be implemented by people who have never met its authors: timing
companies, event organisers, federations, media, watch makers. Contributions that make that
easier — a sharper sentence in `SPEC.md`, a case that pins an ambiguity, a third engine — are the
most valuable kind.

## Most wanted

In order:

1. **A case the engines get wrong.** A document, a log, the states you expect, and a `why`
   sentence saying what it pins.
2. **A third implementation, in any language** ([docs/implementing.md](docs/implementing.md)).
   Where it disagrees, the result is a new case, not an argument.
3. **A rule your event runs that no kind can say**: the sentence, the place, and a log that should
   trip it.
4. **A dialect for a sport not yet covered**: per kind, a parameter schema, an expansion into the
   existing kernel, the sentence it prints, and a case.

## How the language grows

**The corpus is the specification.** Prose lets two implementations read a sentence differently
and both believe they are right; a case in `corpus/` turns that disagreement into a failing test.
So the rule for every change to what a document means is the same:

- **A new dialect kind lands with a conformance case.** The case is a document, an observation
  log and the expected result for every entrant, in `corpus/conformance/`. A kind with no case
  does not exist yet: both engines' conformance runners fail when a shipped kind is reached by
  no case. Its sentence lands in `ts/test/support/sentences.json`, which both engines check, and
  says what the expansion does — nothing more.
- **Both engines must pass it.** A change to the format or a dialect lands in the Rust crate and
  the TypeScript package in the same pull request, and the differential test must still report
  zero disagreements. A wire change is a spec change in both engines, never one.
- **A new parse or law verdict lands with a decode case** in `corpus/decode/`: `accept`, `reject`
  (the document is malformed) or `refuse` (it draws but will not run), with the reason. A verdict
  on a log rides on a case whose document is accepted, as its `log` and `expect.log`. A law of
  the text cannot be written as a JSON value, so its case carries the file as a string,
  `document_text` or `log_text`.
- **Rules are append-only within a major version.** A rule written under `athletics@1` in 2027
  must mean the same thing in 2031. Changing what an existing kind does is a new major version
  of its dialect (`athletics@2`), shipped beside the old one.
- **The kernel changes rarely.** Most new sports are a new dialect expanding into the existing
  9 atoms and 5 consequences. A proposal to add an atom or consequence needs a case no dialect
  can express without it.

Generated cases come from `ts/scripts/` over the synthetic courses in `corpus/courses/`. Only
synthetic or openly licensed geometry belongs in the corpus. Every generator writes JSON through
`ts/scripts/render.ts`, in the committed layout, so regenerating an unchanged corpus changes no
byte: after running them, `git status corpus schema` shows only the cases you meant to change.

## House rules for the engines

- **Pure.** No clock, IO, network, randomness (the simulator takes a seed) or global state in the
  language. Anything that touches the world is a bridge, and its only output is an observation
  log.
- **Integers.** Time in milliseconds, distance in metres. No floating-point accumulation in any
  decision: a cut-off edge that depends on rounding is decided differently on different machines.
  The two fractions the kernel admits, a measured `quantity` and a `field` atom's `ratio`, are
  each one operation (`SPEC.md §1`).
- **No recursion, no user-defined functions.** A document is data a stranger can be handed.
- **A fold grows with the log, never with the log times the field.** Settle once, partition by
  entrant once (`by_entrant`, in both engines). `ts/test/fold.test.ts` holds that without a
  clock by counting entrant reads. A change to what a fold costs shows
  `node --expose-gc ts/scripts/bench.ts` before and after in the pull request; each answer's
  digest must not change.
- **No new dependency without a reason** stated in the pull request. The Rust crate depends on
  `serde` and `serde_json`, and the WebAssembly binding adds `wasm-bindgen`; the TypeScript
  package depends on `effect`.
- **TypeScript: Effect and Effect Schema.** Every wire shape is a Schema, and types are inferred
  from it, never written in parallel. Ids are branded. No `throw`, no `as any`/`as unknown`, no
  `new Map`/`new Set` (use `HashMap`/`HashSet`), no `console.*` outside `ts/scripts/`. Relative
  imports carry their `.ts` extension.
- **Rust: `cargo clippy --workspace --all-targets -- -D warnings`** and `cargo fmt --all` clean.
  No `unsafe`, no panics on input — a bad document is a verdict, not a crash.
- **Comments say why, with numbers.** Point at `SPEC.md §n` rather than restating it.

## The repository

| path | what it holds |
| --- | --- |
| [SPEC.md](SPEC.md) | the prose specification, which explains the corpus |
| [docs/](docs) | [why a format](docs/why.md), [one event, end to end](docs/one-event.md), [the data model](docs/data-model.md), [API](docs/api.md), [reading a result](docs/results.md), [rules](docs/rules.md), [rehearsal](docs/rehearsal.md), [implementing it](docs/implementing.md), [scope and versioning](docs/scope.md), [guarantees and conformance](docs/guarantees.md), [known gaps](docs/known-gaps.md); `docs/assets/` holds the README's pictures |
| [corpus/](corpus) | `conformance/`, `decode/` and `courses/`: the normative part |
| [examples/](examples) | the 10 km the README and docs show, folded by both engines in CI |
| [schema/](schema) | JSON Schema for the document, the observation and the entrant state |
| [ts/](ts) | the TypeScript reference, npm package `pace-geojson`; `ts/scripts/` generates the corpus and times the fold (`bench.ts`) |
| [rust/](rust) | the Rust engine, crate `pace-geojson` |
| [wasm/](wasm) | the Rust engine for JavaScript, crate `pace-geojson-wasm`: `run`, `dialects` |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | `cargo fmt`, clippy and the Rust tests; the WebAssembly build; the TypeScript tests on Node 22 and 24 against that build, so both engines fold every change; and the packed package installed and imported the way a consumer would ([.github/smoke.mjs](.github/smoke.mjs)) |

In one line each: `cargo test --workspace` (corpus, examples, properties); `wasm-pack build wasm
--target nodejs --out-dir pkg-node --release`; `cd ts && npm ci && npm test` (corpus, examples,
the differential sweep against that build). The rest is below.

## Running everything

Rust (the toolchain is pinned by `rust-toolchain.toml`; rustup installs it on first use):

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace
```

TypeScript (Node 22 or 24):

```sh
cd ts
npm ci          # exactly package-lock.json
npm run check   # tsc
npm test        # vitest
npm run build   # dist/
npm pack        # the tarball a consumer installs; prepack builds and checks the exports map
```

A change to `ts/package.json`'s dependencies regenerates `ts/package-lock.json` (`npm install`
in `ts/`) in the same pull request; CI's `npm ci` fails when the two disagree.

The WebAssembly core, which the differential test loads (needs `wasm-pack`):

```sh
wasm-pack build wasm --target nodejs --out-dir pkg-node --release   # for Node and the tests
wasm-pack build wasm --target web --out-dir pkg --release           # for a browser
```

Without `wasm/pkg-node/` the differential test skips, because there is only one engine to
compare. Before opening a pull request, make it fail instead:

```sh
cd ts && PACE_GEOJSON_REQUIRE_CORE=1 npm test
```

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request, except the browser
build, and then packs `ts/`, installs the tarball into a scratch project and imports and
typechecks it the way an outside program would (`.github/smoke.mjs`).

## Pull requests and issues

**Issues are welcome for anything the spec leaves open** — a sentence two readers could take two
ways, a race rule no dialect can express, a result you believe an engine gets wrong. The most
useful issue includes a document and a log that show it.

**How a pull request lands.** This repository is published from a private upstream repository as
snapshot commits: the engines are maintained beside software that uses them, and that software is
not public. A pull request is reviewed here as usual; once accepted, it is applied upstream and
appears here in the next snapshot, whose message credits you with a `Co-authored-by:` trailer. The
pull request is then closed with a link to that commit. The history here is therefore a series of
snapshots rather than a merge graph, and nothing you cannot see decides what a document means:
the corpus, the specification and both engines are all here.

**Who decides.** The maintainer (see [Governance](#governance)) decides what lands, by the
rules above: a new meaning is a case both engines pass, a changed meaning is a new dialect major
or format version. Disagreement about what a sentence of `SPEC.md` means is settled the same
way — by a case whose `expect` says it — not by whoever argued last.

**Security.** Report a vulnerability — an input that crashes an engine, hangs it, or makes it
answer differently from the other — through GitHub's private vulnerability reporting on this
repository, not in a public issue.

**Conduct.** Be exact and be kind. Criticise documents, logs and sentences, not people.

By contributing you agree that your contribution is licensed under the Apache License 2.0, as
stated in `LICENSE`.

## Governance

- **Who decides.** The maintainer, Tobias Goulden Schultz, who wrote both engines. A new meaning
  lands as a corpus case both engines pass; a changed meaning is a new dialect major or format
  version, never an edit. It lives in the maintainer's account for now and may move to an
  organisation, so timing companies, organisers and federations can join as maintainers; GitHub
  redirects every link when it does.
- **Stability.** Until the first release is tagged, format version 1 may still change (every change
  is in [CHANGELOG.md](CHANGELOG.md)). From that tag it is frozen: a change that alters any verdict
  or any fold is format version 2, even while the packages are 0.x.
- **Where the code comes from.** Snapshot commits from a private upstream, where the engines are
  maintained beside software that uses them. Pull requests are reviewed here and credited in the
  snapshot that carries them ([Pull requests and issues](#pull-requests-and-issues)).
- **Where to ask.** Questions, proposals, a result you believe is wrong: a GitHub issue, with a
  document and a log that show it. Security: GitHub's private vulnerability reporting, not an issue.
