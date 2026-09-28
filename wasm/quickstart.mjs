// The README's 10 km, folded by the Rust engine compiled to WebAssembly.
// Build it once: `wasm-pack build wasm --target nodejs --out-dir pkg-node --release`.
// Then, from the repository root: `node wasm/quickstart.mjs`.
import { readFileSync } from 'node:fs'
import { dialects, run } from './pkg-node/sport_lang_wasm.js'

const say = (line) => process.stdout.write(`${line}\n`)
const read = (path) => readFileSync(path, 'utf8')

say(dialects()) // the dialects this build can run
const answer = JSON.parse(run(read('examples/10k/document.json'), read('examples/10k/log.json')))
// { kind: 'ran', states } | { kind: 'refused', why: { refused, broken, … } } | { kind: 'malformed', why, broken }
if (answer.kind !== 'ran') say(`${answer.kind}: ${JSON.stringify(answer.why)}`)
for (const s of answer.states ?? []) {
  say(`${s.entrant} ${s.standing} ${s.total_ms} ${JSON.stringify(s.awards)}`)
}

// $ node wasm/quickstart.mjs
// ["athletics@1","backyard@1","orienteering@1","triathlon@1"]
// ent_ana clean 2790000 ["sub-50"]
// ent_ben gated 5100000 []
// ent_cy penalised 3240000 []
// ent_dee clean 2880000 ["sub-50"]
// ent_eve disqualified 3300000 []
