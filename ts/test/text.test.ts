/**
 * The laws of the text, and the one place the engine reads text.
 *
 * `rust/src/text.rs` carries the same cases beside the same walk, and the
 * decode corpus holds both engines to the verdicts. What is here is what a
 * corpus case cannot say: which member, on which line; that a text which
 * merely looks like a breach is left alone; and that the walk is total and
 * does not slow down on a text built to make it.
 *
 * @see src/text.ts
 * @see SPEC.md §2 — the text
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { decodeResult } from 'effect/SchemaParser'

import { describe_issue } from '../src/run.ts'
import { broken_text_law, describe_text_law, JsonText } from '../src/text.ts'

const TWICE = 'a member is named twice'
const HALF = 'a string holds half a surrogate pair'

const law = (text: string) => {
  const broken = broken_text_law(text)
  return broken === null ? null : [broken.law, broken.what, broken.line]
}

describe('broken_text_law', () => {
  it('finds nothing in a lawful text', () => {
    for (const text of [
      '{}',
      '[]',
      '{"a": 1, "b": {"a": 1}, "c": [{"a": 1}, {"a": 2}]}',
      // The same name in two objects is two names.
      '[{"id": 1}, {"id": 1}]',
      // A value may repeat a name, and a value may look like a member.
      String.raw`{"a": "a", "b": "\"a\": 1, \"a\": 2"}`,
      // A whole pair, escaped, is text.
      String.raw`{"smile": "😀", "slash": "\\", "quote": "\""}`,
      // An escaped backslash before the closing quote does not escape it.
      String.raw`{"a\\": 1, "a": 2}`,
    ])
      assert.isNull(law(text), text)
  })

  it('finds a member named twice wherever it is', () => {
    assert.deepStrictEqual(law('{"a": 1, "a": 1}'), [TWICE, 'a', 1])
    assert.deepStrictEqual(law('{"a": 1, "b": 2, "a": 3}'), [TWICE, 'a', 1])
    assert.deepStrictEqual(law('{"x": [1, {"y": {\n"z": 1,\n"z": 2}}]}'), [TWICE, 'z', 3])
    // After the object that holds it has closed, an outer name is still remembered.
    assert.deepStrictEqual(law('{"a": {"b": 1}, "a": 2}'), [TWICE, 'a', 1])
    // The empty name is a name.
    assert.deepStrictEqual(law('{"": 1, "": 2}'), [TWICE, '', 1])
    // And so is one `Object.prototype` has: a lookup that is not an own-property one finds it once already.
    assert.isNull(law('{"constructor": 1, "toString": 2, "__proto__": 3}'))
    assert.deepStrictEqual(law('{"__proto__": 1, "__proto__": 2}'), [TWICE, '__proto__', 1])
  })

  it('compares names after their escapes are resolved', () => {
    assert.deepStrictEqual(law(String.raw`{"pace:name": "a", "pace:name": "b"}`), [
      TWICE,
      'pace:name',
      1,
    ])
    assert.deepStrictEqual(law(String.raw`{"a\/b": 1, "a/b": 2}`), [TWICE, 'a/b', 1])
    assert.deepStrictEqual(law(String.raw`{"😀": 1, "😀": 2}`), [TWICE, '😀', 1])
    // Nothing is normalised: an accent written two ways is two names.
    assert.isNull(law('{"é": 1, "é": 2}'))
    // And case is not folded.
    assert.isNull(law('{"a": 1, "A": 2}'))
  })

  it('checks an object of many members like one of few', () => {
    const members = (n: number) => Array.from({ length: n }, (_, i) => `"k${i}": ${i}`).join(', ')
    for (const n of [2, 16, 17, 400]) {
      assert.isNull(law(`{${members(n)}}`), `${n} members`)
      // The earliest second use is the one named, however many there are.
      assert.deepStrictEqual(
        law(`{${members(n)}, "k1": 0, "k0": 0}`),
        [TWICE, 'k1', 1],
        `${n} members`,
      )
    }
  })

  it('finds half a surrogate pair in a name or a value', () => {
    const half = (what: string) => [HALF, what, 1]
    assert.deepStrictEqual(law(String.raw`{"a": "\ud83d"}`), half(String.raw`\ud83d`))
    assert.deepStrictEqual(law(String.raw`{"a": "\ude00"}`), half(String.raw`\ude00`))
    assert.deepStrictEqual(law(String.raw`{"a": "x\ud83dy"}`), half(String.raw`x\ud83dy`))
    assert.deepStrictEqual(law(String.raw`{"a": "\ud83d\ud83d"}`), half(String.raw`\ud83d\ud83d`))
    assert.deepStrictEqual(law(String.raw`{"\ud83d": 1}`), half(String.raw`\ud83d`))
    assert.deepStrictEqual(law(String.raw`["\uD83D"]`), half(String.raw`\uD83D`))
    // The two halves the wrong way round are two halves.
    assert.deepStrictEqual(law(String.raw`["\ude00\ud83d"]`), half(String.raw`\ude00\ud83d`))
    // An escaped backslash before a `u` is not an escape.
    assert.isNull(law(String.raw`["\\ud83d"]`))
  })

  it('refuses a half written out rather than escaped: no bytes decode to it', () => {
    // A JavaScript string can hold what no UTF-8 file can. A host that built
    // its text from something other than the file's bytes is told so.
    assert.deepStrictEqual(law('["a",\n"\ud83d"]'), [
      HALF,
      'a surrogate written out, not escaped',
      2,
    ])
    assert.isNull(law('["😀"]'))
  })

  it('is total on text that is not JSON', () => {
    for (const text of [
      '',
      '"',
      '"\\',
      '{"a":1,"a":2',
      '}}}]]]',
      '{"a\\',
      '["\\u',
      '["\\ud8',
      'garbage " { " : , } ] "',
      '{"é\\',
    ])
      assert.doesNotThrow(() => broken_text_law(text), text)
  })

  it('reads a text built to be slow in the time it takes to read it', { timeout: 20_000 }, () => {
    // Nested two hundred thousand deep: no recursion to run out of.
    const deep = `${'['.repeat(200_000)}{"a": 1, "a": 2}${']'.repeat(200_000)}`
    assert.deepStrictEqual(law(deep), [TWICE, 'a', 1])
    // One object of two hundred thousand members: sorted, not compared pair by pair.
    const wide = `{${Array.from({ length: 200_000 }, (_, i) => `"k${i}": 1`).join(',')}`
    assert.isNull(law(`${wide}}`))
    assert.deepStrictEqual(law(`${wide},"k7": 2}`), [TWICE, 'k7', 1])
    // And no backslash anywhere: the search for one is made once, not per string.
    const plain = `[${Array.from({ length: 200_000 }, (_, i) => `"s${i}"`).join(',')}]`
    assert.isNull(law(plain))
  })
})

describe('JsonText', () => {
  const read = decodeResult(JsonText)
  const why = (text: string): string => {
    const value = read(text)
    return Result.isFailure(value) ? describe_issue(value.failure) : 'nothing: it is lawful'
  }

  it('says which of the three it was', () => {
    assert.strictEqual(why('[1, 2'), 'Expected a JSON text')
    assert.strictEqual(why('{"a": 1, "a": 2}'), 'a member is named twice: "a", line 1')
    assert.strictEqual(
      why('[\n"\\ud83d"]'),
      String.raw`a string holds half a surrogate pair: "\\ud83d", line 2`,
    )
    assert.deepStrictEqual(read('[1, 2]'), Result.succeed([1, 2]))
  })

  it('gives the value `JSON.parse` gives, for every lawful text', () => {
    for (const text of ['null', '0', '"a"', '[]', '{}', '{"a": [1, {"b": null}], "c": "\\n"}'])
      assert.deepStrictEqual(read(text), Result.succeed(JSON.parse(text)), text)
  })

  it('never repeats the text in its refusal', () => {
    // A log is tens of megabytes; a refusal that quoted it would be too.
    const text = `[${'"padding", '.repeat(2_000)}{"a": 1, "a": 2}]`
    assert.isBelow(why(text).length, 80)
    assert.isBelow(why(`${text} trailing`).length, 80)
  })

  it('writes a value back out as text', () => {
    assert.strictEqual(Schema.encodeSync(JsonText)({ a: [1, null] }), '{"a":[1,null]}')
  })

  it('names the law as the decode corpus does', () => {
    assert.strictEqual(
      describe_text_law({ law: TWICE, what: 'pace:name', line: 7 }),
      'a member is named twice: "pace:name", line 7',
    )
  })
})
