/// Rejoining text that was cut into fixed-width lines, as text copied from a
/// PDF, an ebook or an e-mail is. ProseMirror turns every line of pasted
/// plain text into its own paragraph, so such a paste ends up with one
/// "paragraph" per line: each gets the profile's first-line indent and none
/// can be justified.
///
/// The line width is estimated from the longest lines. A break is kept
/// (it ends a paragraph) when the next line's first word would have fitted
/// on the line, when the next line starts with a dialogue dash or a
/// list marker, or at a blank line. Any other break is a wrap: the lines are
/// joined with a space, or without one after a hyphen splitting a word.

/// Lines longer than this are not fixed-width text.
const MAX_WRAP_WIDTH = 140;
/// Shorter wrap widths are lists or verse, not wrapped prose.
const MIN_WRAP_WIDTH = 35;
/// Character counts only approximate proportional text: a line is taken as
/// ended on purpose only if the next word fits within this share of the
/// width. A line that finishes a sentence may well end its paragraph, so the
/// test is less strict for it than for a line cut mid-sentence.
const FIT_RATIO = 0.85;
const FIT_RATIO_SENTENCE_END = 0.95;

const ENDS_SENTENCE = /[.!?…:;»”"')\]]$/;

const STARTS_BLOCK = /^\s*(?:[—–―•·*]|-\s|\d+[.)]\s)/;

function firstWord(line: string): string {
    return line.trim().split(/\s+/)[0] ?? "";
}

/// Estimated wrap width: the length most full lines reach.
function wrapWidth(lines: string[]): number {
    const lengths = lines.map((l) => l.trim().length).filter((n) => n > 0).sort((a, b) => b - a);
    if (lengths.length === 0) return 0;
    // The second-longest line, so that one overlong line does not set it.
    return lengths[Math.min(1, lengths.length - 1)];
}

/// Whether a paragraph could be a single cut line rather than a real
/// paragraph. Blank lines are not: they separate paragraphs.
export function looksLikeLine(text: string): boolean {
    const n = text.trim().length;
    return n > 0 && n <= MAX_WRAP_WIDTH;
}

/// Whether `lines` look like prose cut at a fixed width.
export function looksHardWrapped(lines: string[]): boolean {
    const text = lines.map((l) => l.trim()).filter(Boolean);
    if (text.length < 3) return false;
    if (text.some((l) => l.length > MAX_WRAP_WIDTH)) return false;
    const width = wrapWidth(text);
    if (width < MIN_WRAP_WIDTH) return false;
    // Most lines of wrapped prose run close to the width.
    const full = text.filter((l) => l.length >= width * 0.7).length;
    return full >= text.length * 0.5;
}

/// For each line but the last, whether it continues on the next line.
export function wrapJoins(lines: string[]): boolean[] {
    const width = wrapWidth(lines);
    return lines.slice(0, -1).map((line, i) => {
        const cur = line.trim();
        const next = lines[i + 1].trim();
        if (!cur || !next) return false;
        if (STARTS_BLOCK.test(next)) return false;
        const ratio = ENDS_SENTENCE.test(cur) ? FIT_RATIO_SENTENCE_END : FIT_RATIO;
        return cur.length + 1 + firstWord(next).length > width * ratio;
    });
}

/// A line ending in a hyphen that splits a word ("bio-" + "tecnología").
export function endsInSplitWord(line: string, next: string): boolean {
    return /\p{L}-$/u.test(line.trimEnd()) && /^\p{Ll}/u.test(next.trimStart());
}

/// Rejoin pasted plain text when it looks hard-wrapped; otherwise return it
/// unchanged. Paragraphs come out one per line, as ProseMirror expects.
export function unwrapPlainText(text: string): string {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (!looksHardWrapped(lines)) return text;
    const joins = wrapJoins(lines);
    const out: string[] = [];
    let para = "";
    lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line) {
            if (para) out.push(para);
            para = "";
            return;
        }
        if (!para) para = line;
        else if (endsInSplitWord(para, line)) para = para.trimEnd().slice(0, -1) + line;
        else para += " " + line;
        if (!joins[i]) {
            out.push(para);
            para = "";
        }
    });
    if (para) out.push(para);
    return out.join("\n");
}
