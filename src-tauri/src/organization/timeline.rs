//! The story timeline: events with a story date, an optional time, a track
//! (a storyline or point of view), and links to the scene where they happen
//! and the characters involved.
//!
//! Story dates are free text, so invented calendars work ("Year 3, Day 12").
//! Events are sorted by `date_key`: real dates (`YYYY-MM-DD`) by their
//! numbers, anything else by the numbers it contains, then by the text.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimelineEvent {
    pub id: Uuid,
    pub title: String,
    /// Story date as written by the user.
    #[serde(default)]
    pub date: String,
    /// Optional time of day ("21:30", "dawn").
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub description: String,
    /// Storyline or point of view; events with the same track share a lane.
    #[serde(default)]
    pub track: String,
    /// CSS hex colour; empty for the default.
    #[serde(default)]
    pub color: String,
    /// The scene (document) where the event happens.
    #[serde(default)]
    pub document: Option<Uuid>,
    /// Character documents involved.
    #[serde(default)]
    pub characters: Vec<Uuid>,
}

impl TimelineEvent {
    pub fn sanitize(&mut self) {
        self.title = self.title.trim().to_string();
        if self.title.is_empty() {
            self.title = "Untitled event".into();
        }
        self.date = self.date.trim().to_string();
        self.time = self.time.trim().to_string();
        self.track = self.track.trim().to_string();
        let mut seen = std::collections::HashSet::new();
        self.characters.retain(|c| seen.insert(*c));
    }
}

/// The numbers in a story date, used to sort it. "2026-05-04" → [2026, 5, 4];
/// "Year 3, Day 12" → [3, 12]; a leading minus counts for the first number
/// ("-300-01-01" is before "0001-01-01").
pub fn date_key(date: &str) -> Vec<i64> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut negative = false;
    let chars: Vec<char> = date.trim().chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if c.is_ascii_digit() {
            if cur.is_empty() && out.is_empty() && i > 0 && chars[i - 1] == '-' && (i == 1 || !chars[i - 2].is_alphanumeric()) {
                negative = true;
            }
            cur.push(*c);
        } else if !cur.is_empty() {
            let n: i64 = cur.parse().unwrap_or(i64::MAX);
            out.push(if out.is_empty() && negative { -n } else { n });
            cur.clear();
        }
    }
    if !cur.is_empty() {
        let n: i64 = cur.parse().unwrap_or(i64::MAX);
        out.push(if out.is_empty() && negative { -n } else { n });
    }
    out
}

/// Chronological order; undated events go last.
pub fn compare(a: &TimelineEvent, b: &TimelineEvent) -> Ordering {
    match (a.date.is_empty(), b.date.is_empty()) {
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        _ => {}
    }
    date_key(&a.date)
        .cmp(&date_key(&b.date))
        .then_with(|| a.date.to_lowercase().cmp(&b.date.to_lowercase()))
        .then_with(|| date_key(&a.time).cmp(&date_key(&b.time)))
        .then_with(|| a.time.cmp(&b.time))
        .then_with(|| a.title.cmp(&b.title))
}

pub fn sort(events: &mut [TimelineEvent]) {
    events.sort_by(compare);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(title: &str, date: &str, time: &str) -> TimelineEvent {
        TimelineEvent {
            id: Uuid::new_v4(),
            title: title.into(),
            date: date.into(),
            time: time.into(),
            description: String::new(),
            track: String::new(),
            color: String::new(),
            document: None,
            characters: vec![],
        }
    }

    #[test]
    fn sorts_real_and_invented_dates() {
        assert_eq!(date_key("2026-05-04"), vec![2026, 5, 4]);
        assert_eq!(date_key("Year 3, Day 12"), vec![3, 12]);
        assert_eq!(date_key("-300-01-01"), vec![-300, 1, 1]);
        assert_eq!(date_key("Day-2"), vec![2]);

        let mut v = vec![
            ev("c", "Day 10", ""),
            ev("none", "", ""),
            ev("b", "Day 2", "21:00"),
            ev("a", "Day 2", "09:30"),
            ev("old", "Day 1", ""),
        ];
        sort(&mut v);
        let order: Vec<&str> = v.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(order, vec!["old", "a", "b", "c", "none"]);
    }
}
