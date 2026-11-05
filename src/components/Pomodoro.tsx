/// Pomodoro views (the timer itself is `services/pomodoro.ts`):
/// - `PomodoroButton`: status bar button with the time left; opens a panel
///   with a progress ring, Start/Pause, Reset, Skip, the round, today's
///   count, the words of the current sprint and the settings.
/// - `PomodoroNotice`: the message when a focus period or a break ends.
/// - `PomodoroPill`: small corner timer for composition mode.

import { useEffect, useRef, useState } from "react";
import {
    formatTime,
    LIMITS,
    phaseMs,
    pomodoro,
    usePomodoro,
    type Phase,
    type PomodoroSettings,
} from "../services/pomodoro";
import { IconTimer } from "./Icons";
import "../styles/pomodoro.css";
import { t, tn } from "../i18n";

/** Labels are English; translated when drawn. */
const PHASE_LABEL: Record<Phase, string> = {
    focus: "Focus",
    short: "Short break",
    long: "Long break",
};

export function PomodoroButton() {
    const s = usePomodoro();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const active = s.running || s.remainingMs !== phaseMs(s.phase, s.settings);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        window.addEventListener("mousedown", close);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", close);
            window.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div className="pomo-anchor" ref={rootRef}>
            <button
                type="button"
                className={`pomo-button phase-${s.phase}${s.running ? " running" : ""}`}
                title={t("Pomodoro: write in timed sprints with breaks")}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <IconTimer size={13} />
                {active ? (
                    <span className="pomo-button-time">{formatTime(s.remainingMs)}</span>
                ) : (
                    <span>{t("Pomodoro")}</span>
                )}
            </button>
            {open && <PomodoroPanel />}
        </div>
    );
}

function PomodoroPanel() {
    const s = usePomodoro();
    const [showSettings, setShowSettings] = useState(false);
    const total = phaseMs(s.phase, s.settings);
    const progress = 1 - s.remainingMs / total;
    const atStart = !s.running && s.remainingMs === total;
    const r = 52;
    const circumference = 2 * Math.PI * r;

    return (
        <div className={`pomo-panel phase-${s.phase}`} role="dialog" aria-label={t("Pomodoro")}>
            <div className="pomo-phase">{t(PHASE_LABEL[s.phase])}</div>
            <div className="pomo-ring">
                <svg viewBox="0 0 120 120" aria-hidden="true">
                    <circle className="pomo-ring-track" cx="60" cy="60" r={r} />
                    <circle
                        className="pomo-ring-value"
                        cx="60"
                        cy="60"
                        r={r}
                        strokeDasharray={circumference}
                        strokeDashoffset={circumference * (1 - progress)}
                    />
                </svg>
                <div className="pomo-ring-time">{formatTime(s.remainingMs)}</div>
            </div>
            <div className="pomo-rounds" title={t("Pomodoros until the long break")}>
                {Array.from({ length: s.settings.roundsBeforeLong }, (_, i) => (
                    <span key={i} className={`pomo-dot${i < s.round ? " done" : ""}`} />
                ))}
            </div>
            <div className="pomo-actions">
                {s.running ? (
                    <button type="button" className="primary" onClick={() => pomodoro.pause()}>
                        {t("Pause")}
                    </button>
                ) : (
                    <button type="button" className="primary" onClick={() => pomodoro.start()}>
                        {atStart ? t("Start") : t("Resume")}
                    </button>
                )}
                <button type="button" onClick={() => pomodoro.reset()} disabled={atStart}>
                    {t("Reset")}
                </button>
                <button type="button" onClick={() => pomodoro.skip()} title={t("End this period now")}>
                    {t("Skip")}
                </button>
            </div>
            <div className="pomo-stats">
                {s.phase === "focus" && s.liveWords !== null && (
                    <div>{tn(s.liveWords, "{n} word in this sprint", "{n} words in this sprint")}</div>
                )}
                <div>{tn(s.today, "{n} pomodoro today", "{n} pomodoros today")}</div>
            </div>
            <button type="button" className="pomo-settings-toggle" onClick={() => setShowSettings((v) => !v)}>
                {showSettings ? t("Hide settings") : t("Settings…")}
            </button>
            {showSettings && <PomodoroSettingsForm settings={s.settings} />}
        </div>
    );
}

function PomodoroSettingsForm({ settings }: { settings: PomodoroSettings }) {
    const field = (key: keyof typeof LIMITS, label: string) => (
        <label className="pomo-field">
            <span>{label}</span>
            <input
                type="number"
                min={LIMITS[key][0]}
                max={LIMITS[key][1]}
                value={settings[key]}
                onChange={(e) => pomodoro.updateSettings({ [key]: Number(e.target.value) })}
            />
        </label>
    );
    return (
        <div className="pomo-settings">
            {field("focusMin", t("Focus (minutes)"))}
            {field("shortMin", t("Short break (minutes)"))}
            {field("longMin", t("Long break (minutes)"))}
            {field("roundsBeforeLong", t("Long break every"))}
            <label className="pomo-check">
                <input
                    type="checkbox"
                    checked={settings.sound}
                    onChange={(e) => pomodoro.updateSettings({ sound: e.target.checked })}
                />
                {t("Play a sound when a period ends")}
            </label>
        </div>
    );
}

/// The message when a period ends. A finished focus period shows the words
/// written and goes away by itself; a finished break offers the next sprint.
export function PomodoroNotice() {
    const s = usePomodoro();
    useEffect(() => {
        if (s.ended !== "focus") return;
        const id = window.setTimeout(() => pomodoro.dismiss(), 20_000);
        return () => window.clearTimeout(id);
    }, [s.ended]);

    if (!s.ended) return null;
    if (s.ended === "focus") {
        const breakMin = s.phase === "long" ? s.settings.longMin : s.settings.shortMin;
        return (
            <div className="pomo-notice phase-focus" role="status">
                <div className="pomo-notice-title">🍅 {t("Pomodoro done!")}</div>
                <div className="pomo-notice-text">
                    {s.finished?.words != null
                        ? tn(s.finished.words, "You wrote {n} word.", "You wrote {n} words.")
                        : t("Well done.")}{" "}
                    {s.phase === "long"
                        ? t("Take a long break: {min} minutes.", { min: breakMin })
                        : t("Take a short break: {min} minutes.", { min: breakMin })}
                </div>
                <div className="pomo-notice-actions">
                    <button type="button" onClick={() => pomodoro.dismiss()}>
                        {t("OK")}
                    </button>
                </div>
            </div>
        );
    }
    return (
        <div className="pomo-notice phase-short" role="status">
            <div className="pomo-notice-title">{t("Break over")}</div>
            <div className="pomo-notice-text">{t("Ready for another sprint?")}</div>
            <div className="pomo-notice-actions">
                <button type="button" onClick={() => pomodoro.dismiss()}>
                    {t("Not now")}
                </button>
                <button
                    type="button"
                    className="primary"
                    onClick={() => {
                        pomodoro.dismiss();
                        pomodoro.start();
                    }}
                >
                    {t("Start")}
                </button>
            </div>
        </div>
    );
}

/// Corner timer for composition mode: shown while a period is under way;
/// a click pauses or resumes it.
export function PomodoroPill() {
    const s = usePomodoro();
    const active = s.running || s.remainingMs !== phaseMs(s.phase, s.settings);
    if (!active) return null;
    return (
        <button
            type="button"
            className={`pomo-pill phase-${s.phase}${s.running ? "" : " paused"}`}
            title={s.running ? t("Pause") : t("Resume")}
            onClick={() => (s.running ? pomodoro.pause() : pomodoro.start())}
        >
            <span className="pomo-pill-dot" />
            {formatTime(s.remainingMs)}
            {s.phase === "focus" && s.liveWords !== null && s.liveWords > 0 && (
                <span className="pomo-pill-words">· {tn(s.liveWords, "{n} word", "{n} words")}</span>
            )}
        </button>
    );
}

/// Start/pause control for the composition bar.
export function PomodoroToggle() {
    const s = usePomodoro();
    const atStart = !s.running && s.remainingMs === phaseMs(s.phase, s.settings);
    return (
        <button
            type="button"
            className={`comp-toggle${s.running ? " active" : ""}`}
            aria-pressed={s.running}
            title={t("Pomodoro: write in timed sprints with breaks")}
            onClick={() => (s.running ? pomodoro.pause() : pomodoro.start())}
        >
            <IconTimer size={14} />{" "}
            {s.running ? formatTime(s.remainingMs) : atStart ? t("Pomodoro") : formatTime(s.remainingMs)}
        </button>
    );
}
