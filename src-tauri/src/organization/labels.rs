//! Label and status definitions: validation, and renaming a label or status
//! on every document that uses it.

use serde::Deserialize;

use crate::project::manifest::ColorDef;
use crate::project::model::Project;

/// A label or status renamed in the definitions editor.
#[derive(Debug, Clone, Deserialize)]
pub struct Rename {
    /// "label" or "status".
    pub kind: String,
    pub from: String,
    pub to: String,
}

fn is_hex(s: &str) -> bool {
    let h = s.strip_prefix('#').unwrap_or("");
    h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit())
}

/// Trim names, drop empty and duplicate ones, and fix invalid colours.
pub fn clean(defs: Vec<ColorDef>) -> Vec<ColorDef> {
    let mut out: Vec<ColorDef> = Vec::new();
    for mut d in defs {
        d.name = d.name.trim().to_string();
        if d.name.is_empty() || out.iter().any(|o| o.name.eq_ignore_ascii_case(&d.name)) {
            continue;
        }
        if !is_hex(&d.color) {
            d.color = "#9a948a".into();
        }
        d.color = d.color.to_lowercase();
        out.push(d);
    }
    out
}

/// Apply renames to every document. Returns how many documents changed.
pub fn apply_renames(project: &mut Project, renames: &[Rename]) -> usize {
    let mut changed = 0;
    for doc in project.documents.values_mut() {
        let mut touched = false;
        for r in renames {
            let to = r.to.trim();
            if to.is_empty() || r.from == to {
                continue;
            }
            match r.kind.as_str() {
                "label" => {
                    if doc.labels.first().is_some_and(|l| *l == r.from) {
                        doc.labels[0] = to.to_string();
                        touched = true;
                    }
                }
                "status" => {
                    if doc.status == r.from {
                        doc.status = to.to_string();
                        touched = true;
                    }
                }
                _ => {}
            }
        }
        if touched {
            changed += 1;
        }
    }
    if changed > 0 {
        project.touch();
    }
    changed
}
