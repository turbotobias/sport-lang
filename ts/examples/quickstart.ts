// The README's 10 km, folded. From the repository root: `node ts/examples/quickstart.ts`.
import { readFileSync } from 'node:fs'
import { PACKS, run } from 'pace-geojson'

const read = (path: string): string => readFileSync(path, 'utf8')
const say = (line: string) => process.stdout.write(`${line}\n`)

// Parse both files, plan the rules, check the log, fold. Three answers and no fourth.
// Each file goes in as its text: a value `JSON.parse` made can no longer show a member named twice.
const answer = run(PACKS, read('examples/10k/document.json'), read('examples/10k/log.json'))

if (answer.kind === 'malformed') {
  // Not a document, or not a log: what was expected, and where.
  say(`malformed: ${answer.why} ${JSON.stringify(answer.broken)}`)
} else if (answer.kind === 'refused') {
  // Readable, not runnable: draw the course, refuse to score it.
  say(`refused: ${JSON.stringify(answer.why)}`)
} else {
  for (const s of answer.states) {
    const why = s.applied.map((a) => a.sentence)
    say(`${s.entrant} ${s.standing} ${s.total_ms} ${JSON.stringify(why)}`)
  }
}

// $ node ts/examples/quickstart.ts
// ent_ana clean 2790000 ["Finishing inside 50:00 qualifies for sub-50."]
// ent_ben gated 5100000 ["The day ends for anyone reaching km-5 after 07:40."]
// ent_cy penalised 3240000 ["Missing km-5 costs 2:00."]
// ent_dee clean 2880000 ["Finishing inside 50:00 qualifies for sub-50."]
// ent_eve disqualified 3300000 ["Taking outside assistance ends the day."]
