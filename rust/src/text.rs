//! The text of a document or a log, before anything reads a member of it.
//!
//! JSON leaves two things to whoever parses it, and two lawful parsers given
//! the same bytes then hold two different files:
//!
//! - **A member named twice.** `{"pace-geojson": 1, "pace-geojson": 2}` is JSON.
//!   One parser keeps the last value, another the first, a strict one refuses.
//!   Version 1 or version 2, a cut-off at one hour or at two: the race would be
//!   scored under whichever the reader's parser happened to keep.
//! - **Half a surrogate pair.** `"\ud83d"` is JSON and is not text. A language
//!   whose strings are UTF-16 holds it; this one cannot. An entrant whose id
//!   carries one is an entrant to the first and a malformed log here.
//!
//! Neither is read: a text that does either is not a document and not a log.
//!
//! ## Why this is not left to serde
//!
//! A derived `Deserialize` refuses a member named twice **only where it has a
//! field of that name**. A foreign member, and anything kept as a
//! `serde_json::Value` — a rule's `params`, a feature's `geometry` — keeps the
//! last and says nothing, so the same law held in one place and not in the
//! next. And it never looks inside a string it is not going to keep. So the
//! text is read here, once, for exactly these two laws, by the same walk the
//! reference makes: the two cannot disagree about a text because they do not
//! consult their parsers about it.

use std::borrow::Cow;

use serde::de::{DeserializeOwned, IgnoredAny};

/// The sentence for an object that names a member twice. Byte-identical to the reference's.
pub const NAMED_TWICE: &str = "a member is named twice";
/// The sentence for a string holding half a surrogate pair. Byte-identical to the reference's.
pub const HALF_A_PAIR: &str = "a string holds half a surrogate pair";

/// A law of the text, broken: which, by what, and on which line.
///
/// `what` is the member's name with its escapes resolved, or the string as it
/// was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokenTextLaw {
    pub law: &'static str,
    pub what: String,
    /// The line it is on, from 1.
    pub line: usize,
}

impl std::fmt::Display for BrokenTextLaw {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Quoted as JSON quotes it, so the sentence reads the same in both engines.
        let what = serde_json::to_string(&self.what).unwrap_or_else(|_| format!("{:?}", self.what));
        write!(f, "{}: {what}, line {}", self.law, self.line)
    }
}

impl std::error::Error for BrokenTextLaw {}

/// A JSON text as a `T`, or why it is not one: it is not JSON, it breaks a law
/// of the text, or `T` refuses a member of it. In that order.
///
/// The one place the crate reads text. `parse_document`, `parse_log` and `run`
/// all come through here, so the two laws are checked on every file.
pub fn read<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    serde_json::from_str::<IgnoredAny>(text).map_err(|e| e.to_string())?;
    if let Some(broken) = broken_text_law(text) {
        return Err(broken.to_string());
    }
    serde_json::from_str(text).map_err(|e| e.to_string())
}

/// The first law of the text that `text` breaks, or `None` when it keeps both.
///
/// One pass over the bytes, with no recursion, so a text nested a hundred
/// thousand deep is read as easily as a flat one. It assumes the text is JSON —
/// [`read`] asks first — and is total on anything else: it never panics, and
/// what it says of a text that is not JSON does not matter.
///
/// Names are compared **after their escapes are resolved**: `"pace:name"` and
/// `"pace:\u006eame"` are one name, as they are to every parser. Nothing is
/// normalised beyond that.
pub fn broken_text_law(text: &str) -> Option<BrokenTextLaw> {
    let bytes = text.as_bytes();
    // Every open object's names so far, on one stack: `opened` holds where each
    // open object's names start, and `None` for an array.
    let mut names: Vec<Cow<'_, str>> = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();
    let mut opened: Vec<Option<usize>> = Vec::new();
    // Whether the next string is a member's name rather than a value.
    let mut naming = false;

    let mut at = 0;
    while let Some(&byte) = bytes.get(at) {
        match byte {
            b'"' => {
                let mut end = at + 1;
                let mut has_escapes = false;
                loop {
                    match bytes.get(end) {
                        None => return None,
                        Some(b'"') => break,
                        Some(b'\\') => {
                            has_escapes = true;
                            end += 2;
                        }
                        Some(_) => end += 1,
                    }
                }
                // A value with no escape in it says nothing either law is about.
                if naming || has_escapes {
                    // Both ends are a quote, which no multi-byte character contains.
                    let raw = text.get(at + 1..end).unwrap_or("");
                    let value = if has_escapes {
                        match resolved(raw) {
                            Some(value) => Cow::Owned(value),
                            None => {
                                return Some(BrokenTextLaw {
                                    law: HALF_A_PAIR,
                                    what: raw.to_string(),
                                    line: line_of(bytes, at),
                                })
                            }
                        }
                    } else {
                        Cow::Borrowed(raw)
                    };
                    if naming {
                        names.push(value);
                        offsets.push(at);
                        naming = false;
                    }
                }
                at = end + 1;
                continue;
            }
            b'{' => {
                opened.push(Some(names.len()));
                naming = true;
            }
            b'[' => {
                opened.push(None);
                naming = false;
            }
            b':' => naming = false,
            b',' => naming = matches!(opened.last(), Some(Some(_))),
            b']' => {
                opened.pop();
                naming = false;
            }
            b'}' => {
                naming = false;
                if let Some(Some(start)) = opened.pop() {
                    if let Some(second) = second_use(&names, start) {
                        return Some(BrokenTextLaw {
                            law: NAMED_TWICE,
                            what: names.get(second).map(|name| name.to_string()).unwrap_or_default(),
                            line: line_of(bytes, offsets.get(second).copied().unwrap_or(at)),
                        });
                    }
                    names.truncate(start);
                    offsets.truncate(start);
                }
            }
            _ => {}
        }
        at += 1;
    }
    None
}

/// Where, among the names of one object, a name is used a second time: the
/// index of the earliest such use in `names`, or `None`.
///
/// `names` is every open object's names on one stack, and this object's are the
/// ones from `start`. A handful are compared pair by pair, which allocates
/// nothing and is every object a real file has. More are sorted first, so a
/// name used twice sits beside itself: an object of a million members is
/// checked in the time it takes to sort them, not a million times that.
fn second_use(names: &[Cow<'_, str>], start: usize) -> Option<usize> {
    const HANDFUL: usize = 16;
    let mine = names.get(start..).unwrap_or(&[]);
    if mine.len() <= HANDFUL {
        return (1..mine.len())
            .find(|&later| mine[..later].contains(&mine[later]))
            .map(|later| start + later);
    }
    let mut order: Vec<usize> = (0..mine.len()).collect();
    order.sort_by(|&a, &b| mine[a].cmp(&mine[b]).then(a.cmp(&b)));
    order
        .windows(2)
        .filter(|pair| mine[pair[0]] == mine[pair[1]])
        .map(|pair| start + pair[1])
        .min()
}

/// A string's content with its escapes resolved, or `None` when one of them is
/// half a surrogate pair.
///
/// Written out rather than handed to serde, which says a lone surrogate is an
/// error and never which one: the law is this function's to name.
fn resolved(raw: &str) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(slash) = rest.find('\\') {
        out.push_str(rest.get(..slash).unwrap_or(""));
        let after = rest.get(slash + 1..).unwrap_or("");
        let Some(letter) = after.chars().next() else {
            return Some(out);
        };
        if letter != 'u' {
            out.push(match letter {
                'b' => '\u{8}',
                'f' => '\u{c}',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                // `\"`, `\\` and `\/` stand for themselves.
                other => other,
            });
            rest = after.get(letter.len_utf8()..).unwrap_or("");
            continue;
        }
        let unit = hex4(after, 1);
        if is_low(unit) {
            return None;
        }
        if !is_high(unit) {
            out.push(char::from_u32(unit).unwrap_or(char::REPLACEMENT_CHARACTER));
            rest = after.get(5..).unwrap_or("");
            continue;
        }
        // A high surrogate is text only with its low half written right after it.
        let low = if after.get(5..7) == Some("\\u") {
            hex4(after, 7)
        } else {
            0
        };
        if !is_low(low) {
            return None;
        }
        let scalar = 0x1_0000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
        out.push(char::from_u32(scalar).unwrap_or(char::REPLACEMENT_CHARACTER));
        rest = after.get(11..).unwrap_or("");
    }
    out.push_str(rest);
    Some(out)
}

/// The four hex digits of a `\u` escape, as the code unit they name.
fn hex4(text: &str, from: usize) -> u32 {
    text.get(from..from + 4)
        .filter(|digits| digits.bytes().all(|b| b.is_ascii_hexdigit()))
        .and_then(|digits| u32::from_str_radix(digits, 16).ok())
        .unwrap_or(0)
}

fn is_high(unit: u32) -> bool {
    (0xD800..=0xDBFF).contains(&unit)
}

fn is_low(unit: u32) -> bool {
    (0xDC00..=0xDFFF).contains(&unit)
}

fn line_of(bytes: &[u8], offset: usize) -> usize {
    1 + bytes.iter().take(offset).filter(|&&b| b == b'\n').count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn law(text: &str) -> Option<(&'static str, String, usize)> {
        broken_text_law(text).map(|b| (b.law, b.what, b.line))
    }

    #[test]
    fn a_lawful_text_keeps_both() {
        for text in [
            "{}",
            "[]",
            r#"{"a": 1, "b": {"a": 1}, "c": [{"a": 1}, {"a": 2}]}"#,
            // The same name in two objects is two names.
            r#"[{"id": 1}, {"id": 1}]"#,
            // A value may repeat a name, and a value may look like a member.
            r#"{"a": "a", "b": "\"a\": 1, \"a\": 2"}"#,
            // A whole pair, escaped, is text.
            r#"{"smile": "\ud83d\ude00", "slash": "\\", "quote": "\""}"#,
            // An escaped backslash before the closing quote does not escape it.
            r#"{"a\\": 1, "a": 2}"#,
        ] {
            assert_eq!(law(text), None, "{text}");
        }
    }

    #[test]
    fn a_member_named_twice_is_found_wherever_it_is() {
        let twice = |what: &str, line: usize| Some((NAMED_TWICE, what.to_string(), line));
        assert_eq!(law(r#"{"a": 1, "a": 1}"#), twice("a", 1));
        assert_eq!(law(r#"{"a": 1, "b": 2, "a": 3}"#), twice("a", 1));
        assert_eq!(law("{\"x\": [1, {\"y\": {\n\"z\": 1,\n\"z\": 2}}]}"), twice("z", 3));
        // After the object that holds it has closed, an outer name is still remembered.
        assert_eq!(law(r#"{"a": {"b": 1}, "a": 2}"#), twice("a", 1));
        // The empty name is a name.
        assert_eq!(law(r#"{"": 1, "": 2}"#), twice("", 1));
    }

    #[test]
    fn names_are_compared_after_their_escapes_are_resolved() {
        assert_eq!(
            law(r#"{"pace:name": "a", "pace:\u006eame": "b"}"#),
            Some((NAMED_TWICE, "pace:name".to_string(), 1))
        );
        assert_eq!(
            law(r#"{"a\/b": 1, "a/b": 2}"#),
            Some((NAMED_TWICE, "a/b".to_string(), 1))
        );
        assert_eq!(
            law(r#"{"\ud83d\ude00": 1, "😀": 2}"#),
            Some((NAMED_TWICE, "😀".to_string(), 1))
        );
        // Nothing is normalised: an accent written two ways is two names.
        assert_eq!(law("{\"\u{e9}\": 1, \"e\u{301}\": 2}"), None);
        // And case is not folded.
        assert_eq!(law(r#"{"a": 1, "A": 2}"#), None);
    }

    #[test]
    fn an_object_of_many_members_is_checked_like_one_of_few() {
        let members = |n: usize| (0..n).map(|i| format!("\"k{i}\": {i}")).collect::<Vec<_>>().join(", ");
        for n in [2, 16, 17, 400] {
            assert_eq!(law(&format!("{{{}}}", members(n))), None, "{n} members");
            // The earliest second use is the one named, however many there are.
            let text = format!("{{{}, \"k1\": 0, \"k0\": 0}}", members(n));
            assert_eq!(law(&text), Some((NAMED_TWICE, "k1".to_string(), 1)), "{n} members");
        }
    }

    #[test]
    fn half_a_surrogate_pair_is_found_in_a_name_or_a_value() {
        let half = |what: &str| Some((HALF_A_PAIR, what.to_string(), 1));
        assert_eq!(law(r#"{"a": "\ud83d"}"#), half(r"\ud83d"));
        assert_eq!(law(r#"{"a": "\ude00"}"#), half(r"\ude00"));
        assert_eq!(law(r#"{"a": "x\ud83dy"}"#), half(r"x\ud83dy"));
        assert_eq!(law(r#"{"a": "\ud83d\ud83d"}"#), half(r"\ud83d\ud83d"));
        assert_eq!(law(r#"{"\ud83d": 1}"#), half(r"\ud83d"));
        assert_eq!(law(r#"["\uD83D"]"#), half(r"\uD83D"));
        // The two halves the wrong way round are two halves.
        assert_eq!(law(r#"["\ude00\ud83d"]"#), half(r"\ude00\ud83d"));
        // An escaped backslash before a `u` is not an escape.
        assert_eq!(law(r#"["\\ud83d"]"#), None);
    }

    #[test]
    fn it_is_total_on_text_that_is_not_json() {
        for text in [
            "",
            "\"",
            "\"\\",
            "{\"a\":1,\"a\":2",
            "}}}]]]",
            "{\"a\\",
            "[\"\\u",
            "[\"\\ud8",
            "garbage \" { \" : , } ] \"",
            "{\"é\\",
        ] {
            let _ = broken_text_law(text);
        }
    }

    #[test]
    fn a_text_nested_very_deep_is_read_without_recursion() {
        let deep = format!("{}{{\"a\": 1, \"a\": 2}}{}", "[".repeat(200_000), "]".repeat(200_000));
        assert_eq!(law(&deep), Some((NAMED_TWICE, "a".to_string(), 1)));
        // And `read` answers for it: the first walk has no depth to run out of.
        assert!(read::<IgnoredAny>(&deep).is_err());
    }

    #[test]
    fn read_says_which_of_the_three_it_was() {
        let not_json = read::<Vec<u8>>("[1, 2").expect_err("not JSON");
        assert!(not_json.starts_with("EOF while parsing"), "{not_json}");
        let twice = read::<serde_json::Value>(r#"{"a": 1, "a": 2}"#).expect_err("a law");
        assert_eq!(twice, r#"a member is named twice: "a", line 1"#);
        let half = read::<serde_json::Value>("[\n\"\\ud83d\"]").expect_err("a law");
        assert_eq!(half, r#"a string holds half a surrogate pair: "\\ud83d", line 2"#);
        let field = read::<Vec<u8>>("[1, 256]").expect_err("a member");
        assert!(field.starts_with("invalid value"), "{field}");
        assert_eq!(read::<Vec<u8>>("[1, 2]"), Ok(vec![1, 2]));
    }
}
