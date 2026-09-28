/**
 * JSON laid out the way the repository's formatter lays it out.
 *
 * Every generator writes through {@link render}, so the file a contributor
 * regenerates is the file that is committed, byte for byte, with or without
 * that formatter installed. A generator that wrote `JSON.stringify(x, null, 2)`
 * instead turned every regeneration into thousands of lines of layout diff, and
 * a real change to one expected state hid inside it.
 *
 * The formatter's rules for the JSON a generator writes:
 *
 * - An object always breaks, one member per line.
 * - An array holding an object breaks, because the object does.
 * - An array of two or more arrays that each hold two or more items breaks,
 *   one item per line — a line of coordinates is a column, never a paragraph.
 * - Any other array goes on one line when that line — indent, member name and
 *   trailing comma included — fits in {@link WIDTH}, and breaks one item per
 *   line when it does not.
 *
 * The formatter packs a long array of bare numbers several to a line; nothing
 * a generator writes has one, and the schema and corpus tests would say so the
 * day one did.
 *
 * Values must already be in their wire form — an instant as its string, not a
 * `DateTime` — which is what a schema's `encode` gives. This does not call
 * `toJSON`.
 */

/** The formatter's line width. */
export const WIDTH = 100

const is_object = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An array or scalar on one line, `[a, b]` spaced as the formatter spaces it; null when it holds an object. */
const flat = (value: unknown): string | null => {
  if (is_object(value)) return null
  if (!Array.isArray(value)) return JSON.stringify(value)
  const items: Array<string> = []
  for (const item of value) {
    const one = flat(item)
    if (one === null) return null
    items.push(one)
  }
  return `[${items.join(', ')}]`
}

const is_list = (value: unknown): boolean => Array.isArray(value) && value.length > 1

const layout = (value: unknown, indent: number, prefix: number, last: boolean): string => {
  const pad = ' '.repeat(indent + 2)
  const close = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const one_line = flat(value)
    const columns = value.length > 1 && value.every(is_list)
    if (
      one_line !== null &&
      !columns &&
      indent + prefix + one_line.length + (last ? 0 : 1) <= WIDTH
    )
      return one_line
    const items = value.map(
      (item, i) => `${pad}${layout(item, indent + 2, 0, i === value.length - 1)}`,
    )
    return `[\n${items.join(',\n')}\n${close}]`
  }
  if (is_object(value)) {
    // JSON.stringify drops an undefined member, so this does too.
    const entries = Object.entries(value).filter(([, member]) => member !== undefined)
    if (entries.length === 0) return '{}'
    const members = entries.map(([key, member], i) => {
      const name = `${JSON.stringify(key)}: `
      return `${pad}${name}${layout(member, indent + 2, name.length, i === entries.length - 1)}`
    })
    return `{\n${members.join(',\n')}\n${close}}`
  }
  return JSON.stringify(value)
}

/** One JSON file's text, newline-terminated, in the committed layout. */
export const render = (value: unknown): string => `${layout(value, 0, 0, true)}\n`
