/// Writing Statistics: headline numbers (today, streaks, totals), a
/// year-long heatmap of words written per day and a bar chart of the last
/// 30 days. Hovering a cell or bar shows that day's figures.

import { useEffect, useMemo, useState } from "react";
import { api, type DayRow, type WritingStatsDto } from "../services/api";
import { IconChart } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/writing.css";
import { getLanguage, t, tn } from "../i18n";

interface Props {
    onClose: () => void;
    onError: (msg: string) => void;
}

const WEEKS = 53;

function parseDay(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function dayKey(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

function longDate(d: Date): string {
    return d.toLocaleDateString(getLanguage(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Heatmap level 0–4 from quartiles of the writing days. */
function levels(rows: DayRow[]): (words: number) => number {
    const vals = rows.map((r) => r.added).filter((v) => v > 0).sort((a, b) => a - b);
    if (vals.length === 0) return () => 0;
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
    return (w) => (w <= 0 ? 0 : w <= q1 ? 1 : w <= q2 ? 2 : w <= q3 ? 3 : 4);
}

interface Hover {
    date: Date;
    added: number;
    removed: number;
}

export function StatsDialog({ onClose, onError }: Props) {
    const [stats, setStats] = useState<WritingStatsDto | null>(null);
    const [hover, setHover] = useState<Hover | null>(null);

    useEffect(() => {
        api.getWritingStats()
            .then(setStats)
            .catch((e) => onError(String(e)));
    }, [onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const byDay = useMemo(() => {
        const m = new Map<string, DayRow>();
        for (const r of stats?.history ?? []) m.set(r.date, r);
        return m;
    }, [stats]);

    if (!stats) {
        return (
            <div className="overlay-root" onMouseDown={onClose}>
                <div className="dialog stats-dialog" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="dialog-body">{t("Loading statistics…")}</div>
                </div>
            </div>
        );
    }

    const today = parseDay(stats.today_date);
    // Heatmap: columns are weeks (Monday first), the last column holds today.
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = addDays(today, -mondayOffset - (WEEKS - 1) * 7);
    const level = levels(stats.history);
    const weeks: { date: Date; row: DayRow | undefined }[][] = [];
    for (let w = 0; w < WEEKS; w++) {
        const col = [];
        for (let d = 0; d < 7; d++) {
            const date = addDays(start, w * 7 + d);
            col.push({ date, row: byDay.get(dayKey(date)) });
        }
        weeks.push(col);
    }
    const monthLabels = weeks.map((col, i) => {
        const first = col[0].date;
        const prev = i > 0 ? weeks[i - 1][0].date : null;
        return !prev || prev.getMonth() !== first.getMonth()
            ? first.toLocaleDateString(getLanguage(), { month: "short" })
            : "";
    });

    // Last 30 days bar chart.
    const last30 = Array.from({ length: 30 }, (_, i) => {
        const date = addDays(today, i - 29);
        const row = byDay.get(dayKey(date));
        return { date, added: row?.added ?? 0, removed: row?.removed ?? 0 };
    });
    const maxBar = Math.max(1, ...last30.map((d) => d.added));
    const niceMax = niceCeil(maxBar);

    const tiles: { label: string; value: string; note?: string }[] = [
        { label: t("Today"), value: stats.today.toLocaleString(getLanguage()), note: t("words") },
        { label: t("Current streak"), value: stats.current_streak.toLocaleString(getLanguage()), note: stats.current_streak === 1 ? t("day") : t("days") },
        { label: t("Longest streak"), value: stats.longest_streak.toLocaleString(getLanguage()), note: stats.longest_streak === 1 ? t("day") : t("days") },
        { label: t("Last 7 days"), value: stats.last_7_days.toLocaleString(getLanguage()), note: t("words") },
        { label: t("Last 30 days"), value: stats.last_30_days.toLocaleString(getLanguage()), note: t("words") },
        { label: t("Average"), value: stats.average_per_writing_day.toLocaleString(getLanguage()), note: t("words per writing day") },
    ];

    const hoverText = hover
        ? `${longDate(hover.date)} · ${tn(hover.added, "{n} word written", "{n} words written")}${hover.removed ? ` · ${t("{n} removed", { n: hover.removed.toLocaleString(getLanguage()) })}` : ""}`
        : stats.best_day
            ? `Best day: ${longDate(parseDay(stats.best_day.date))}, ${stats.best_day.words.toLocaleString(getLanguage())} words · ${stats.days_written.toLocaleString(getLanguage())} writing days · ${stats.total_added.toLocaleString(getLanguage())} words in total`
            : "No writing recorded yet. Words you type in the editor are counted here, day by day.";

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog stats-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconChart size={18} />
                    <span className="dialog-title">{t("Writing Statistics")}</span>
                </div>
                <div className="dialog-body">
                    <div className="stats-tiles">
                        {tiles.map((tile) => (
                            <div key={tile.label} className="stats-tile">
                                <div className="stats-tile-label">{tile.label}</div>
                                <div className="stats-tile-value">{tile.value}</div>
                                {tile.note && <div className="stats-tile-note">{tile.note}</div>}
                            </div>
                        ))}
                    </div>

                    <h3 className="stats-heading">{t("Words written per day, last 12 months")}</h3>
                    <div className="heatmap" onMouseLeave={() => setHover(null)}>
                        <div className="heatmap-months">
                            {monthLabels.map((m, i) => (
                                <span key={i}>{m}</span>
                            ))}
                        </div>
                        <div className="heatmap-body">
                            <div className="heatmap-days">
                                <span>{t("Mon")}</span>
                                <span />
                                <span>{t("Wed")}</span>
                                <span />
                                <span>{t("Fri")}</span>
                                <span />
                                <span />
                            </div>
                            <div className="heatmap-grid">
                                {weeks.map((col, w) => (
                                    <div key={w} className="heatmap-col">
                                        {col.map(({ date, row }) => {
                                            const future = date.getTime() > today.getTime();
                                            const added = row?.added ?? 0;
                                            return (
                                                <span
                                                    key={date.getTime()}
                                                    className={`heatmap-cell l${future ? "x" : level(added)}`}
                                                    aria-label={`${longDate(date)}: ${tn(added, "{n} word", "{n} words")}`}
                                                    onMouseEnter={() =>
                                                        !future && setHover({ date, added, removed: row?.removed ?? 0 })
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="heatmap-legend">
                            {t("Less")}
                            {[0, 1, 2, 3, 4].map((l) => (
                                <span key={l} className={`heatmap-cell l${l}`} />
                            ))}
                            {t("More")}
                        </div>
                    </div>

                    <h3 className="stats-heading">{t("Last 30 days")}</h3>
                    <div className="bars" onMouseLeave={() => setHover(null)}>
                        <div className="bars-axis">
                            <span>{niceMax.toLocaleString(getLanguage())}</span>
                            <span>{Math.round(niceMax / 2).toLocaleString(getLanguage())}</span>
                            <span>0</span>
                        </div>
                        <div className="bars-plot">
                            <div className="bars-grid">
                                <span />
                                <span />
                                <span />
                            </div>
                            {last30.map((d) => (
                                <div
                                    key={d.date.getTime()}
                                    className="bars-slot"
                                    onMouseEnter={() => setHover({ date: d.date, added: d.added, removed: d.removed })}
                                >
                                    <span
                                        className={`bars-bar${hover && hover.date.getTime() === d.date.getTime() ? " hover" : ""}`}
                                        style={{ height: `${(d.added / niceMax) * 100}%` }}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="bars-dates">
                            <span>{last30[0].date.toLocaleDateString(getLanguage(), { day: "numeric", month: "short" })}</span>
                            <span>{last30[15].date.toLocaleDateString(getLanguage(), { day: "numeric", month: "short" })}</span>
                            <span>{t("Today")}</span>
                        </div>
                    </div>

                    <div className="stats-readout" aria-live="polite">
                        {hoverText}
                    </div>
                </div>
                <div className="dialog-footer">
                    <button type="button" className="primary" onClick={onClose}>
                        {t("Close")}
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Round up to 1, 2 or 5 × a power of ten, for a clean axis maximum. */
function niceCeil(n: number): number {
    const p = Math.pow(10, Math.floor(Math.log10(n)));
    for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p;
    return 10 * p;
}
