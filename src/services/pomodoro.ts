/// Pomodoro timer for writing sprints.
///
/// One timer for the whole app (a module-level store), so it keeps running
/// while composition mode opens and closes and every view of it agrees.
///
/// Cycle: focus → short break → focus → … → long break after every
/// `roundsBeforeLong` focus periods. When a focus period ends the break
/// starts by itself; when a break ends the next focus waits for Start, so
/// writing never restarts by surprise. Each focus period counts the words
/// written during it (the project's session counter at the end minus at the
/// start; see `setSessionWords`).
///
/// The lengths, the sound and today's count stay on this computer
/// (localStorage); the timer itself is not saved and stops when the app
/// closes.

import { useSyncExternalStore } from "react";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { api } from "./api";

export type Phase = "focus" | "short" | "long";

export interface PomodoroSettings {
    focusMin: number;
    shortMin: number;
    longMin: number;
    /** Focus periods before a long break. */
    roundsBeforeLong: number;
    sound: boolean;
}

export interface SprintResult {
    words: number | null;
    minutes: number;
}

export interface PomodoroState {
    phase: Phase;
    running: boolean;
    /** Milliseconds left (kept up to date about once a second). */
    remainingMs: number;
    /** Focus periods finished since the last long break. */
    round: number;
    /** Focus periods finished today. */
    today: number;
    /** Words written so far in the current focus period. */
    liveWords: number | null;
    /** The focus period that just ended, until dismissed. */
    finished: SprintResult | null;
    /** A phase just ended (for the notice); cleared by `dismiss`. */
    ended: Phase | null;
    settings: PomodoroSettings;
}

const SETTINGS_KEY = "sf.pomodoro.settings";
const TODAY_KEY = "sf.pomodoro.today";

export const DEFAULT_SETTINGS: PomodoroSettings = {
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    roundsBeforeLong: 4,
    sound: true,
};

export const LIMITS = {
    focusMin: [5, 90],
    shortMin: [1, 30],
    longMin: [5, 60],
    roundsBeforeLong: [2, 8],
} as const;

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;
}

function loadSettings(): PomodoroSettings {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<PomodoroSettings>;
        return sanitize({ ...DEFAULT_SETTINGS, ...raw });
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function sanitize(s: PomodoroSettings): PomodoroSettings {
    return {
        focusMin: clamp(s.focusMin, LIMITS.focusMin),
        shortMin: clamp(s.shortMin, LIMITS.shortMin),
        longMin: clamp(s.longMin, LIMITS.longMin),
        roundsBeforeLong: clamp(s.roundsBeforeLong, LIMITS.roundsBeforeLong),
        sound: s.sound !== false,
    };
}

function todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadToday(): number {
    try {
        const raw = JSON.parse(localStorage.getItem(TODAY_KEY) ?? "null") as { day: string; count: number } | null;
        return raw && raw.day === todayKey() ? raw.count : 0;
    } catch {
        return 0;
    }
}

function saveToday(count: number) {
    try {
        localStorage.setItem(TODAY_KEY, JSON.stringify({ day: todayKey(), count }));
    } catch {
        // Only today's tally is lost.
    }
}

export function phaseMs(phase: Phase, s: PomodoroSettings): number {
    const min = phase === "focus" ? s.focusMin : phase === "short" ? s.shortMin : s.longMin;
    return min * 60_000;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSettings = loadSettings();
let state: PomodoroState = {
    phase: "focus",
    running: false,
    remainingMs: phaseMs("focus", initialSettings),
    round: 0,
    today: loadToday(),
    liveWords: null,
    finished: null,
    ended: null,
    settings: initialSettings,
};
/** When the running phase ends (ms since epoch). */
let endsAt: number | null = null;
let tick: number | null = null;
/** Session words when the focus period started, and the latest known. */
let wordsAtStart: number | null = null;
let sessionWords: number | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<PomodoroState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
}

function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
}

function stopTicking() {
    if (tick !== null) window.clearInterval(tick);
    tick = null;
}

function startTicking() {
    stopTicking();
    tick = window.setInterval(() => {
        if (endsAt === null) return;
        const left = endsAt - Date.now();
        if (left <= 0) phaseEnded();
        else set({ remainingMs: left });
    }, 250);
}

function liveWords(): number | null {
    return state.phase === "focus" && wordsAtStart !== null && sessionWords !== null
        ? Math.max(0, sessionWords - wordsAtStart)
        : null;
}

async function freshSessionWords(): Promise<number | null> {
    try {
        sessionWords = (await api.getWritingGoals()).session_added;
    } catch {
        // No project open: keep the last known value.
    }
    return sessionWords;
}

function phaseEnded() {
    const ended = state.phase;
    const settings = state.settings;
    endsAt = null;
    stopTicking();
    chime(ended === "focus");
    flashTaskbar();

    if (ended === "focus") {
        const round = state.round + 1;
        const today = state.today + 1;
        saveToday(today);
        const next: Phase = round >= settings.roundsBeforeLong ? "long" : "short";
        const startWords = wordsAtStart;
        wordsAtStart = null;
        set({
            phase: next,
            running: true,
            remainingMs: phaseMs(next, settings),
            round: next === "long" ? 0 : round,
            today,
            liveWords: null,
            finished: { words: null, minutes: settings.focusMin },
            ended,
        });
        // The break starts by itself.
        endsAt = Date.now() + phaseMs(next, settings);
        startTicking();
        freshSessionWords().then((now) => {
            const words = startWords !== null && now !== null ? Math.max(0, now - startWords) : null;
            if (state.finished) set({ finished: { ...state.finished, words } });
        });
    } else {
        // After a break the next focus waits for Start.
        set({ phase: "focus", running: false, remainingMs: phaseMs("focus", settings), ended });
    }
}

export const pomodoro = {
    start() {
        if (state.running) return;
        if (state.phase === "focus" && wordsAtStart === null) {
            wordsAtStart = sessionWords;
            freshSessionWords().then((now) => {
                if (wordsAtStart === null || (now !== null && wordsAtStart > now)) wordsAtStart = now;
                set({ liveWords: liveWords() });
            });
        }
        endsAt = Date.now() + state.remainingMs;
        set({ running: true, ended: null, liveWords: liveWords() });
        startTicking();
    },
    pause() {
        if (!state.running || endsAt === null) return;
        const left = Math.max(0, endsAt - Date.now());
        endsAt = null;
        stopTicking();
        set({ running: false, remainingMs: left });
    },
    /** Back to the start of the current phase, stopped. */
    reset() {
        endsAt = null;
        stopTicking();
        if (state.phase === "focus") wordsAtStart = null;
        set({ running: false, remainingMs: phaseMs(state.phase, state.settings), liveWords: null });
    },
    /** End the current phase now (a focus period skipped this way still counts its words). */
    skip() {
        if (state.phase === "focus" && !state.running && wordsAtStart === null) {
            // Nothing written yet: go straight to the break.
            const next: Phase = state.round + 1 >= state.settings.roundsBeforeLong ? "long" : "short";
            set({ phase: next, remainingMs: phaseMs(next, state.settings), ended: null });
            return;
        }
        phaseEnded();
    },
    /** Hide the notice of the phase that ended. */
    dismiss() {
        set({ ended: null, finished: null });
    },
    updateSettings(patch: Partial<PomodoroSettings>) {
        const settings = sanitize({ ...state.settings, ...patch });
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
            // The change lasts until the app closes.
        }
        // A stopped timer at the start of its phase takes the new length.
        const untouched = !state.running && state.remainingMs === phaseMs(state.phase, state.settings);
        set({ settings, remainingMs: untouched ? phaseMs(state.phase, settings) : state.remainingMs });
    },
    /** The project's words written this session (from the status bar). */
    setSessionWords(n: number | null | undefined) {
        if (n === null || n === undefined) return;
        sessionWords = n;
        if (wordsAtStart !== null && n < wordsAtStart) wordsAtStart = n;
        const live = liveWords();
        if (live !== state.liveWords) set({ liveWords: live });
    },
};

export function usePomodoro(): PomodoroState {
    return useSyncExternalStore(subscribe, () => state);
}

/** "24:59". */
export function formatTime(ms: number): string {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Sound and taskbar
// ---------------------------------------------------------------------------

/// Make the taskbar button blink when the window is not in front.
function flashTaskbar() {
    try {
        getCurrentWindow()
            .requestUserAttention(UserAttentionType.Informational)
            .catch(() => undefined);
    } catch {
        // Outside the desktop app.
    }
}

/// A soft two- (or three-) note chime made with Web Audio; no sound file.
function chime(focusEnded: boolean) {
    if (!state.settings.sound) return;
    try {
        const ctx = new AudioContext();
        const notes = focusEnded ? [659.25, 783.99, 1046.5] : [783.99, 659.25];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            const at = ctx.currentTime + i * 0.22;
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
            osc.connect(gain).connect(ctx.destination);
            osc.start(at);
            osc.stop(at + 0.95);
        });
        window.setTimeout(() => ctx.close().catch(() => undefined), 2000);
    } catch {
        // No audio available.
    }
}
