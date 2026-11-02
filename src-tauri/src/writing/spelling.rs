//! Spell checking with Hunspell dictionaries for Spanish and English.
//!
//! The dictionaries ship inside the application (`src-tauri/dictionaries/`)
//! and are parsed on first use. A project chooses which languages apply
//! (`ProjectConfig::spell_language`): with both, a word is accepted when
//! either dictionary knows it. Words in the project's personal dictionary are
//! always accepted; that list is stored in the `.scri` file, so it travels
//! with the project.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use spellbook::Dictionary;

const ES_AFF: &str = include_str!("../../dictionaries/es/es.aff");
const ES_DIC: &str = include_str!("../../dictionaries/es/es.dic");
const EN_AFF: &str = include_str!("../../dictionaries/en/en.aff");
const EN_DIC: &str = include_str!("../../dictionaries/en/en.dic");

static ES: OnceLock<Option<Dictionary>> = OnceLock::new();
static EN: OnceLock<Option<Dictionary>> = OnceLock::new();

/// Language codes understood by the checker.
pub const LANGUAGES: [&str; 2] = ["es", "en"];

fn load(lang: &str) -> Option<&'static Dictionary> {
    let (cell, aff, dic) = match lang {
        "es" => (&ES, ES_AFF, ES_DIC),
        "en" => (&EN, EN_AFF, EN_DIC),
        _ => return None,
    };
    cell.get_or_init(|| match Dictionary::new(aff, dic) {
        Ok(d) => Some(d),
        Err(e) => {
            log::error!("could not load the {lang} dictionary: {e}");
            None
        }
    })
    .as_ref()
}

/// Parse a language setting ("es", "en", "es,en", "off") into codes.
pub fn languages(setting: &str) -> Vec<&'static str> {
    let mut out = Vec::new();
    for part in setting.split(',') {
        let p = part.trim().to_ascii_lowercase();
        if let Some(code) = LANGUAGES.iter().find(|c| **c == p) {
            if !out.contains(code) {
                out.push(*code);
            }
        }
    }
    out
}

/// Normalise a setting to its canonical form ("es", "en", "es,en" or "off").
pub fn normalize_setting(setting: &str) -> String {
    let langs = languages(setting);
    if langs.is_empty() {
        "off".to_string()
    } else {
        langs.join(",")
    }
}

/// Typographic apostrophes are checked as plain ones.
fn normalize_word(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '\u{2019}')
        .replace('\u{2019}', "'")
}

fn in_personal(personal: &BTreeSet<String>, word: &str) -> bool {
    personal.contains(word) || personal.contains(&word.to_lowercase())
}

/// True when the word is spelled correctly in at least one of the languages.
pub fn is_correct(langs: &[&str], personal: &BTreeSet<String>, word: &str) -> bool {
    let w = normalize_word(word);
    if w.is_empty() || w.chars().any(|c| c.is_ascii_digit()) {
        return true;
    }
    // Single letters ("a", "y", "o", "I") are never flagged.
    if w.chars().count() == 1 {
        return true;
    }
    if in_personal(personal, &w) {
        return true;
    }
    let mut any_loaded = false;
    for lang in langs {
        if let Some(dict) = load(lang) {
            any_loaded = true;
            if dict.check(&w) {
                return true;
            }
        }
    }
    // A missing dictionary must not flag every word.
    !any_loaded
}

/// The words of `words` that are misspelled, in input order, deduplicated.
pub fn misspelled(setting: &str, personal: &BTreeSet<String>, words: &[String]) -> Vec<String> {
    let langs = languages(setting);
    if langs.is_empty() {
        return Vec::new();
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for w in words {
        if !seen.insert(w.as_str()) {
            continue;
        }
        if !is_correct(&langs, personal, w) {
            out.push(w.clone());
        }
    }
    out
}

/// Up to `limit` suggestions, drawn from each language in turn.
pub fn suggest(setting: &str, word: &str, limit: usize) -> Vec<String> {
    let w = normalize_word(word);
    let mut out: Vec<String> = Vec::new();
    for lang in languages(setting) {
        let Some(dict) = load(lang) else { continue };
        let mut found = Vec::new();
        dict.suggest(&w, &mut found);
        for s in found {
            // Keep the user's typographic apostrophe style.
            let s = if word.contains('\u{2019}') { s.replace('\'', "\u{2019}") } else { s };
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out.truncate(limit);
    out
}

/// Clean up a word before adding it to the personal dictionary.
pub fn personal_entry(word: &str) -> Option<String> {
    let w = normalize_word(word);
    if w.is_empty() || w.chars().count() > 64 || w.chars().any(char::is_whitespace) {
        return None;
    }
    Some(w)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spanish_and_english_words() {
        let none = BTreeSet::new();
        let es = languages("es");
        let en = languages("en");
        assert!(is_correct(&es, &none, "canción"));
        assert!(is_correct(&es, &none, "Mañana"));
        assert!(!is_correct(&es, &none, "cancion"));
        assert!(is_correct(&en, &none, "writing"));
        assert!(is_correct(&en, &none, "don’t"));
        assert!(!is_correct(&en, &none, "wrting"));
    }

    #[test]
    fn both_languages_accept_either() {
        let none = BTreeSet::new();
        let both = languages("es,en");
        assert!(is_correct(&both, &none, "corazón"));
        assert!(is_correct(&both, &none, "heart"));
        assert!(!is_correct(&both, &none, "corazn"));
    }

    #[test]
    fn personal_dictionary_and_suggestions() {
        let mut personal = BTreeSet::new();
        personal.insert("Eldoria".to_string());
        assert!(misspelled("es", &personal, &["Eldoria".into()]).is_empty());
        assert_eq!(misspelled("off", &BTreeSet::new(), &["zzqx".into()]), Vec::<String>::new());
        let s = suggest("es", "cancion", 5);
        assert!(s.iter().any(|w| w == "canción"), "{s:?}");
    }
}
