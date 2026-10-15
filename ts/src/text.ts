/**
 * The text of a document or a log, before anything reads a member of it.
 *
 * JSON leaves two things to whoever parses it, and two lawful parsers given
 * the same bytes then hold two different files:
 *
 * - **A member named twice.** `{"pace-geojson": 1, "pace-geojson": 2}` is JSON.
 *   One parser keeps the last value, another the first, a strict one refuses.
 *   Version 1 or version 2, a cut-off at one hour or at two: the race would be
 *   scored under whichever the reader's parser happened to keep.
 * - **Half a surrogate pair.** `"\ud83d"` is JSON and is not text. A language
 *   whose strings are UTF-16 holds it; one whose strings are Unicode cannot. An
 *   entrant whose id carries one is an entrant to the first and a malformed log
 *   to the second.
 *
 * Neither is read here: a text that does either is not a document and not a
 * log. Refused rather than guessed, like an instant with an offset.
 *
 * ## Why this is about text, and nothing else in the engine is
 *
 * **Only the text can show a member named twice.** By the time `JSON.parse`
 * has answered there is one value per name and no trace that there were two,
 * so no check on the value can find it. That is why these laws live in the
 * functions that take text — {@link JsonText}, and through it `parse_document`,
 * `parse_log` and a `run` handed strings — and why a host that parses for
 * itself and hands over a value has already let its parser choose.
 *
 * @see SPEC.md §2 — the text
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaIssue from 'effect/SchemaIssue'

/**
 * A law of the text, broken: which, by what, and on which line.
 *
 * `law` is a fixed sentence, the same in both engines. `what` is the member's
 * name with its escapes resolved, or the string as it was written.
 */
export type TBrokenTextLaw = {
  readonly law: 'a member is named twice' | 'a string holds half a surrogate pair'
  readonly what: string
  /** The line it is on, from 1. */
  readonly line: number
}

const QUOTE = 34
const COMMA = 44
const COLON = 58
const OPEN_ARRAY = 91
const BACKSLASH = 92
const CLOSE_ARRAY = 93
const OPEN_OBJECT = 123
const CLOSE_OBJECT = 125

/** An escape that stands for one character, as that character. */
const escaped = (letter: string): string => {
  switch (letter) {
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    default:
      // `\"`, `\\` and `\/` stand for themselves.
      return letter
  }
}

const is_high = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const is_low = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

/**
 * A string's content with its escapes resolved, or null when one of them is
 * half a surrogate pair.
 *
 * Written out rather than handed to `JSON.parse`, which would resolve
 * `"\ud83d"` without complaint: that is the difference being closed.
 */
const resolved = (raw: string): string | null => {
  let out = ''
  let at = 0
  for (;;) {
    const slash = raw.indexOf('\\', at)
    if (slash === -1) return out + raw.slice(at)
    out += raw.slice(at, slash)
    const letter = raw.charAt(slash + 1)
    if (letter !== 'u') {
      out += escaped(letter)
      at = slash + 2
      continue
    }
    const unit = Number.parseInt(raw.slice(slash + 2, slash + 6), 16)
    at = slash + 6
    if (is_low(unit)) return null
    if (!is_high(unit)) {
      out += String.fromCharCode(unit)
      continue
    }
    // A high surrogate is text only with its low half written right after it.
    const low = raw.startsWith('\\u', at) ? Number.parseInt(raw.slice(at + 2, at + 6), 16) : -1
    if (!is_low(low)) return null
    out += String.fromCharCode(unit, low)
    at += 6
  }
}

/** As many names as are compared pair by pair before sorting is the cheaper way. */
const HANDFUL = 16

/**
 * Where, among the names of one object, a name is used a second time: the
 * index of the earliest such use in `names`, or -1.
 *
 * `names` is every open object's names on one stack, and this object's are
 * the ones from `start`. A handful are compared pair by pair, which allocates
 * nothing and is every object a real file has. More are sorted first, so a
 * name used twice sits beside itself: an object of a million members is
 * checked in the time it takes to sort them, not a million times that.
 */
const second_use = (names: ReadonlyArray<string>, start: number): number => {
  const count = names.length - start
  if (count <= HANDFUL) {
    for (let later = start + 1; later < names.length; later += 1)
      for (let earlier = start; earlier < later; earlier += 1)
        if (names[later] === names[earlier]) return later
    return -1
  }
  const order = Array.from({ length: count }, (_, i) => start + i).sort((a, b) => {
    const left = names[a] ?? ''
    const right = names[b] ?? ''
    return left < right ? -1 : left > right ? 1 : a - b
  })
  let found = -1
  for (let i = 1; i < order.length; i += 1) {
    const here = order[i] ?? -1
    if (names[here] === names[order[i - 1] ?? -1] && (found === -1 || here < found)) found = here
  }
  return found
}

const line_of = (text: string, offset: number): number => {
  let line = 1
  for (let at = text.indexOf('\n'); at !== -1 && at < offset; at = text.indexOf('\n', at + 1))
    line += 1
  return line
}

/**
 * The first law of the text that `text` breaks, or null when it keeps both.
 *
 * One pass over the characters, with no recursion, so a text nested a hundred
 * thousand deep is read as easily as a flat one. It assumes the text is JSON —
 * {@link JsonText} asks `JSON.parse` first — and is total on anything else: it
 * never throws, and what it says of a text that is not JSON does not matter.
 *
 * Names are compared **after their escapes are resolved**, code unit for code
 * unit: `"pace:name"` and `"pace:name"` are one name, as they are to
 * every parser. Nothing is normalised beyond that.
 */
export const broken_text_law = (text: string): TBrokenTextLaw | null => {
  if (!text.isWellFormed()) {
    // No bytes decode to this: a host built the string from something else.
    const offset = text.search(/\p{Cs}/u)
    return {
      law: 'a string holds half a surrogate pair',
      what: 'a surrogate written out, not escaped',
      line: line_of(text, offset),
    }
  }

  // Every open object's names so far, on one stack: `opened` holds where each
  // open object's names start, and -1 for an array.
  const names: Array<string> = []
  const offsets: Array<number> = []
  const opened: Array<number> = []
  // Whether the next string is a member's name rather than a value.
  let naming = false
  // The next backslash at or after `at`, found once and carried: asking afresh
  // for every string would read a text with none to its end each time.
  let slash = text.indexOf('\\')

  let at = 0
  while (at < text.length) {
    const code = text.charCodeAt(at)

    if (code === QUOTE) {
      let end = text.indexOf('"', at + 1)
      // A quote is the string's end unless an odd run of backslashes escapes it.
      while (end !== -1) {
        let run = end - 1
        while (run > at && text.charCodeAt(run) === BACKSLASH) run -= 1
        if ((end - 1 - run) % 2 === 0) break
        end = text.indexOf('"', end + 1)
      }
      if (end === -1) return null
      if (slash !== -1 && slash < at) slash = text.indexOf('\\', at)
      const has_escapes = slash !== -1 && slash < end
      // A value with no escape in it says nothing either law is about.
      if (naming || has_escapes) {
        const raw = text.slice(at + 1, end)
        const value = has_escapes ? resolved(raw) : raw
        if (value === null)
          return { law: 'a string holds half a surrogate pair', what: raw, line: line_of(text, at) }
        if (naming) {
          names.push(value)
          offsets.push(at)
          naming = false
        }
      }
      at = end + 1
      continue
    }

    if (code === OPEN_OBJECT) {
      opened.push(names.length)
      naming = true
    } else if (code === OPEN_ARRAY) {
      opened.push(-1)
      naming = false
    } else if (code === COLON) {
      naming = false
    } else if (code === COMMA) {
      naming = (opened[opened.length - 1] ?? -1) >= 0
    } else if (code === CLOSE_ARRAY) {
      opened.pop()
      naming = false
    } else if (code === CLOSE_OBJECT) {
      const start = opened.pop() ?? -1
      naming = false
      if (start >= 0) {
        const second = second_use(names, start)
        if (second !== -1)
          return {
            law: 'a member is named twice',
            what: names[second] ?? '',
            line: line_of(text, offsets[second] ?? at),
          }
        names.length = start
        offsets.length = start
      }
    }
    at += 1
  }
  return null
}

/** A broken text law as a sentence a person reads. */
export const describe_text_law = (broken: TBrokenTextLaw): string =>
  `${broken.law}: ${JSON.stringify(broken.what)}, line ${broken.line}`

/**
 * A JSON text, as the value it says — or refused, when it is not JSON or
 * breaks a law of the text.
 *
 * The one place the engine reads text. Everything that takes a file as a
 * string goes through this, so the two laws are checked exactly where they can
 * be: `JSON.parse` says whether it is JSON at all, and
 * {@link broken_text_law} reads the same characters for what `JSON.parse`
 * resolved without saying.
 */
export const JsonText = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, {
    decode: SchemaGetter.transformEffect((text: string, options) =>
      Effect.flatMap(
        Effect.try({
          try: (): unknown => JSON.parse(text),
          catch: () => new SchemaIssue.InvalidValue({ expected: 'a JSON text' }, text, options),
        }),
        (value) => {
          const broken = broken_text_law(text)
          return broken === null
            ? Effect.succeed(value)
            : Effect.fail(
                new SchemaIssue.InvalidValue({ message: describe_text_law(broken) }, text, options),
              )
        },
      ),
    ),
    encode: SchemaGetter.stringifyJson(),
  }),
)
