//! Daily writing statistics, the current writing session and goal maths.
//!
//! Every edit made in the editor reports the change in a document's word
//! count. Positive changes count as words written, negative ones as words
//! removed, and both are added to the entry for the local calendar day. The
//! history is stored in `metadata/stats.json`; the session lives only in
//! memory and starts again whenever the project is opened.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Words written and removed on one day.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DayStats {
    #[serde(default)]
    pub added: u32,
    #[serde(default)]
    pub removed: u32,
}

/// The per-day history, keyed by local date (`YYYY-MM-DD`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WritingStats {
    #[serde(default)]
    pub days: BTreeMap<NaiveDate, DayStats>,
}

/// Words written since the project was opened (or the session was reset).
#[derive(Debug, Clone)]
pub struct SessionStats {
    pub started_at: DateTime<Utc>,
    pub added: u32,
    pub removed: u32,
}

impl Default for SessionStats {
    fn default() -> Self {
        Self { started_at: Utc::now(), added: 0, removed: 0 }
    }
}

impl SessionStats {
    pub fn record(&mut self, delta: i64) {
        if delta > 0 {
            self.added = self.added.saturating_add(delta as u32);
        } else if delta < 0 {
            self.removed = self.removed.saturating_add((-delta) as u32);
        }
    }
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

impl WritingStats {
    /// Add a word-count change to the entry for `day`.
    pub fn record(&mut self, day: NaiveDate, delta: i64) {
        if delta == 0 {
            return;
        }
        let entry = self.days.entry(day).or_default();
        if delta > 0 {
            entry.added = entry.added.saturating_add(delta.min(u32::MAX as i64) as u32);
        } else {
            entry.removed = entry.removed.saturating_add((-delta).min(u32::MAX as i64) as u32);
        }
    }

    pub fn added_on(&self, day: NaiveDate) -> u32 {
        self.days.get(&day).map(|d| d.added).unwrap_or(0)
    }

    /// Words written in the `n` days ending with `today` (inclusive).
    pub fn added_in_last(&self, today: NaiveDate, n: i64) -> u32 {
        let from = today - Duration::days(n - 1);
        self.days
            .range(from..=today)
            .map(|(_, d)| d.added)
            .fold(0u32, |a, b| a.saturating_add(b))
    }

    /// Consecutive writing days ending today. A day without writing yet does
    /// not break the streak until it is over, so the count starts from
    /// yesterday when nothing has been written today.
    pub fn current_streak(&self, today: NaiveDate) -> u32 {
        let mut day = if self.added_on(today) > 0 { today } else { today - Duration::days(1) };
        let mut streak = 0;
        while self.added_on(day) > 0 {
            streak += 1;
            day -= Duration::days(1);
        }
        streak
    }

    /// The longest run of consecutive writing days in the history.
    pub fn longest_streak(&self) -> u32 {
        let mut best = 0;
        let mut run = 0;
        let mut prev: Option<NaiveDate> = None;
        for (day, stats) in &self.days {
            if stats.added == 0 {
                continue;
            }
            run = match prev {
                Some(p) if *day - p == Duration::days(1) => run + 1,
                _ => 1,
            };
            best = best.max(run);
            prev = Some(*day);
        }
        best
    }

    pub fn summary(&self, today: NaiveDate) -> StatsSummary {
        let written: Vec<(&NaiveDate, &DayStats)> =
            self.days.iter().filter(|(_, d)| d.added > 0).collect();
        let total_added = written.iter().fold(0u32, |a, (_, d)| a.saturating_add(d.added));
        let total_removed = self.days.values().fold(0u32, |a, d| a.saturating_add(d.removed));
        let best = written.iter().max_by_key(|(_, d)| d.added).map(|(day, d)| BestDay {
            date: **day,
            words: d.added,
        });
        let days_written = written.len() as u32;
        StatsSummary {
            today: self.added_on(today),
            last_7_days: self.added_in_last(today, 7),
            last_30_days: self.added_in_last(today, 30),
            total_added,
            total_removed,
            days_written,
            average_per_writing_day: if days_written > 0 { total_added / days_written } else { 0 },
            current_streak: self.current_streak(today),
            longest_streak: self.longest_streak(),
            best_day: best,
            history: self
                .days
                .iter()
                .map(|(date, d)| DayRow { date: *date, added: d.added, removed: d.removed })
                .collect(),
            today_date: today,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BestDay {
    pub date: NaiveDate,
    pub words: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayRow {
    pub date: NaiveDate,
    pub added: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatsSummary {
    pub today: u32,
    pub last_7_days: u32,
    pub last_30_days: u32,
    pub total_added: u32,
    pub total_removed: u32,
    pub days_written: u32,
    pub average_per_writing_day: u32,
    pub current_streak: u32,
    pub longest_streak: u32,
    pub best_day: Option<BestDay>,
    /// Every recorded day, oldest first.
    pub history: Vec<DayRow>,
    /// The local date the summary was computed for.
    pub today_date: NaiveDate,
}

/// How many words a day are still needed to reach `goal` by `deadline`.
///
/// Returns `(days_left, words_per_day)`. `days_left` counts today, so a
/// deadline of today leaves one day. When the deadline has passed, the days
/// are zero or negative and no daily figure is given.
pub fn daily_target(
    goal: u32,
    current: u32,
    deadline: NaiveDate,
    today: NaiveDate,
) -> (i64, Option<u32>) {
    let days_left = (deadline - today).num_days() + 1;
    if days_left <= 0 {
        return (days_left, None);
    }
    let remaining = goal.saturating_sub(current) as i64;
    let per_day = (remaining + days_left - 1) / days_left;
    (days_left, Some(per_day as u32))
}
