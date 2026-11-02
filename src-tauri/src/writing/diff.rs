//! Word-level text comparison for snapshots.
//!
//! The two texts are first compared paragraph by paragraph; paragraphs that
//! changed are then compared word by word. Both steps use Myers' O(ND)
//! algorithm, which is fast when the texts are mostly alike — the usual case
//! for two versions of one document. The edit distance is capped, and past
//! the cap the remaining region is reported as one deletion plus one
//! insertion, so a comparison of unrelated texts stays cheap.

use serde::Serialize;

use crate::project::document::RichDoc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChunkKind {
    Equal,
    Insert,
    Delete,
}

/// A run of text that is unchanged, added or removed. Paragraphs end in
/// `\n`, so the chunks can be shown with `white-space: pre-wrap`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffChunk {
    pub kind: ChunkKind,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffResult {
    pub chunks: Vec<DiffChunk>,
    pub words_added: u32,
    pub words_removed: u32,
}

/// Maximum edit distance explored by one Myers run.
const MAX_EDIT_DISTANCE: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Equal,
    Delete,
    Insert,
}

/// Myers diff of two sequences. Returns one op per element: `Equal` and
/// `Delete` consume `a`, `Equal` and `Insert` consume `b`.
fn myers<T: PartialEq>(a: &[T], b: &[T]) -> Vec<Op> {
    // Common prefix and suffix are cheap to strip and shrink the problem.
    let prefix = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let a_mid = &a[prefix..a.len() - suffix];
    let b_mid = &b[prefix..b.len() - suffix];

    let mut ops = vec![Op::Equal; prefix];
    ops.extend(myers_core(a_mid, b_mid));
    ops.extend(std::iter::repeat(Op::Equal).take(suffix));
    ops
}

fn myers_core<T: PartialEq>(a: &[T], b: &[T]) -> Vec<Op> {
    let n = a.len() as isize;
    let m = b.len() as isize;
    if n == 0 {
        return vec![Op::Insert; b.len()];
    }
    if m == 0 {
        return vec![Op::Delete; a.len()];
    }
    let max = (n + m) as usize;
    let limit = max.min(MAX_EDIT_DISTANCE);
    let offset = max as isize;
    let mut v = vec![0isize; 2 * max + 2];
    // trace[d] holds v[-d..=d] as it was before step d.
    let mut trace: Vec<Vec<isize>> = Vec::new();
    let mut found = None;

    'outer: for d in 0..=limit as isize {
        trace.push(v[(offset - d) as usize..=(offset + d) as usize].to_vec());
        let mut k = -d;
        while k <= d {
            let idx = (k + offset) as usize;
            let mut x = if k == -d || (k != d && v[idx - 1] < v[idx + 1]) {
                v[idx + 1]
            } else {
                v[idx - 1] + 1
            };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[idx] = x;
            if x >= n && y >= m {
                found = Some(d);
                break 'outer;
            }
            k += 2;
        }
    }

    let Some(d_final) = found else {
        // Too different: report the whole region as replaced.
        let mut ops = vec![Op::Delete; a.len()];
        ops.extend(vec![Op::Insert; b.len()]);
        return ops;
    };

    // Walk the trace backwards to recover the path.
    let mut ops = Vec::with_capacity(a.len() + b.len());
    let (mut x, mut y) = (n, m);
    for d in (1..=d_final).rev() {
        let row = &trace[d as usize];
        let get = |k: isize| row[(k + d) as usize];
        let k = x - y;
        let prev_k = if k == -d || (k != d && get(k - 1) < get(k + 1)) { k + 1 } else { k - 1 };
        let prev_x = get(prev_k);
        let prev_y = prev_x - prev_k;
        while x > prev_x && y > prev_y {
            ops.push(Op::Equal);
            x -= 1;
            y -= 1;
        }
        if x == prev_x {
            ops.push(Op::Insert);
        } else {
            ops.push(Op::Delete);
        }
        x = prev_x;
        y = prev_y;
    }
    while x > 0 && y > 0 {
        ops.push(Op::Equal);
        x -= 1;
        y -= 1;
    }
    ops.reverse();
    ops
}

/// Split text into words, runs of whitespace and single punctuation marks.
fn tokenize(text: &str) -> Vec<&str> {
    #[derive(PartialEq, Clone, Copy)]
    enum Class {
        Word,
        Space,
        Other,
    }
    let class = |c: char| {
        if c.is_alphanumeric() || c == '\'' || c == '\u{2019}' {
            Class::Word
        } else if c.is_whitespace() {
            Class::Space
        } else {
            Class::Other
        }
    };
    let mut out = Vec::new();
    let mut start = 0;
    let mut current: Option<Class> = None;
    for (i, c) in text.char_indices() {
        let cl = class(c);
        match current {
            Some(prev) if prev == cl && cl != Class::Other => {}
            Some(_) => {
                out.push(&text[start..i]);
                start = i;
            }
            None => start = i,
        }
        current = Some(cl);
    }
    if current.is_some() {
        out.push(&text[start..]);
    }
    out
}

fn push_chunk(chunks: &mut Vec<DiffChunk>, kind: ChunkKind, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = chunks.last_mut() {
        if last.kind == kind {
            last.text.push_str(text);
            return;
        }
    }
    chunks.push(DiffChunk { kind, text: text.to_string() });
}

/// Compare two texts (paragraphs separated by `\n`).
pub fn diff_text(old: &str, new: &str) -> DiffResult {
    let old_paras: Vec<&str> = old.split_inclusive('\n').collect();
    let new_paras: Vec<&str> = new.split_inclusive('\n').collect();
    let ops = myers(&old_paras, &new_paras);

    let mut chunks = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    let mut pending_old = String::new();
    let mut pending_new = String::new();

    let flush = |chunks: &mut Vec<DiffChunk>, old_buf: &mut String, new_buf: &mut String| {
        if old_buf.is_empty() && new_buf.is_empty() {
            return;
        }
        let a = tokenize(old_buf);
        let b = tokenize(new_buf);
        let word_ops = myers(&a, &b);
        let (mut x, mut y) = (0usize, 0usize);
        for op in word_ops {
            match op {
                Op::Equal => {
                    push_chunk(chunks, ChunkKind::Equal, a[x]);
                    x += 1;
                    y += 1;
                }
                Op::Delete => {
                    push_chunk(chunks, ChunkKind::Delete, a[x]);
                    x += 1;
                }
                Op::Insert => {
                    push_chunk(chunks, ChunkKind::Insert, b[y]);
                    y += 1;
                }
            }
        }
        old_buf.clear();
        new_buf.clear();
    };

    for op in ops {
        match op {
            Op::Equal => {
                flush(&mut chunks, &mut pending_old, &mut pending_new);
                push_chunk(&mut chunks, ChunkKind::Equal, old_paras[i]);
                i += 1;
                j += 1;
            }
            Op::Delete => {
                pending_old.push_str(old_paras[i]);
                i += 1;
            }
            Op::Insert => {
                pending_new.push_str(new_paras[j]);
                j += 1;
            }
        }
    }
    flush(&mut chunks, &mut pending_old, &mut pending_new);

    let count = |kind: ChunkKind| -> u32 {
        chunks
            .iter()
            .filter(|c| c.kind == kind)
            .map(|c| c.text.split_whitespace().count() as u32)
            .sum()
    };
    DiffResult { words_added: count(ChunkKind::Insert), words_removed: count(ChunkKind::Delete), chunks }
}

pub fn diff_docs(old: &RichDoc, new: &RichDoc) -> DiffResult {
    diff_text(&old.plain_text(), &new.plain_text())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rebuild(chunks: &[DiffChunk], keep: ChunkKind) -> String {
        chunks
            .iter()
            .filter(|c| c.kind == ChunkKind::Equal || c.kind == keep)
            .map(|c| c.text.as_str())
            .collect()
    }

    #[test]
    fn identical_texts_are_one_equal_chunk() {
        let r = diff_text("Uno dos.\nTres.\n", "Uno dos.\nTres.\n");
        assert_eq!(r.chunks.len(), 1);
        assert_eq!(r.words_added + r.words_removed, 0);
    }

    #[test]
    fn word_change_inside_a_paragraph() {
        let old = "El perro corre rápido.\nOtra línea.\n";
        let new = "El gato corre muy rápido.\nOtra línea.\n";
        let r = diff_text(old, new);
        assert_eq!(rebuild(&r.chunks, ChunkKind::Delete), old);
        assert_eq!(rebuild(&r.chunks, ChunkKind::Insert), new);
        assert_eq!(r.words_removed, 1);
        assert_eq!(r.words_added, 2);
    }

    #[test]
    fn added_and_removed_paragraphs() {
        let old = "A.\nB.\nC.\n";
        let new = "A.\nC.\nD.\n";
        let r = diff_text(old, new);
        assert_eq!(rebuild(&r.chunks, ChunkKind::Delete), old);
        assert_eq!(rebuild(&r.chunks, ChunkKind::Insert), new);
    }

    #[test]
    fn unrelated_long_texts_stay_correct() {
        let old: String = (0..3000).map(|i| format!("a{i} ")).collect();
        let new: String = (0..3000).map(|i| format!("b{i} ")).collect();
        let r = diff_text(&old, &new);
        assert_eq!(rebuild(&r.chunks, ChunkKind::Delete), old);
        assert_eq!(rebuild(&r.chunks, ChunkKind::Insert), new);
    }
}
