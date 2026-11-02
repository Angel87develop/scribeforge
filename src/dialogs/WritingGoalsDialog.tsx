/// Project Targets: the manuscript word goal with an optional deadline, and
/// the goal for the current writing session.
///
/// With a goal and a deadline, the dialog shows how many words a day are
/// still needed (the days left include today). The session counts the words
/// written since the project was opened; "New Session" starts it again.

import { useEffect, useState } from "react";
import { api, type WritingGoalsDto } from "../services/api";
import { IconTarget } from "../components/Icons";
import { ProgressBar } from "../components/ProgressBar";
import "../styles/dialogs.css";
import "../styles/writing.css";
import { getLanguage, t, tn } from "../i18n";

interface Props {
    onClose: () => void;
    onError: (msg: string) => void;
    /** Called with the stored goals after a change. */
    onChanged: (goals: WritingGoalsDto) => void;
}


export function WritingGoalsDialog({ onClose, onError, onChanged }: Props) {
    const [goals, setGoals] = useState<WritingGoalsDto | null>(null);
    const [projectGoal, setProjectGoal] = useState("0");
    const [sessionGoal, setSessionGoal] = useState("0");
    const [deadline, setDeadline] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getWritingGoals()
            .then((g) => {
                setGoals(g);
                setProjectGoal(String(g.project_goal));
                setSessionGoal(String(g.session_goal));
                setDeadline(g.deadline ?? "");
            })
            .catch((e) => onError(String(e)));
    }, [onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const toNum = (v: string) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };

    async function submit() {
        setSaving(true);
        try {
            const stored = await api.setWritingGoals({
                project_goal: toNum(projectGoal),
                session_goal: toNum(sessionGoal),
                deadline: deadline || null,
            });
            onChanged(stored);
            onClose();
        } catch (e) {
            onError(String(e));
            setSaving(false);
        }
    }

    async function newSession() {
        try {
            const g = await api.resetWritingSession();
            setGoals(g);
            onChanged(g);
        } catch (e) {
            onError(String(e));
        }
    }

    // Live preview of the daily target while the fields are edited.
    const pGoal = toNum(projectGoal);
    const current = goals?.manuscript_words ?? 0;
    let daily: string | null = null;
    if (pGoal > 0 && deadline) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const end = new Date(`${deadline}T00:00:00`);
        const daysLeft = Math.round((end.getTime() - today.getTime()) / 86_400_000) + 1;
        const remaining = Math.max(0, pGoal - current);
        if (remaining === 0) daily = t("Goal reached. Well done!");
        else if (daysLeft <= 0) daily = t("The deadline has passed.");
        else
            daily = t("{words} a day for {days} (today included) to write the remaining {remaining}.", {
                words: tn(Math.ceil(remaining / daysLeft), "{n} word", "{n} words"),
                days: tn(daysLeft, "{n} day", "{n} days"),
                remaining: remaining.toLocaleString(getLanguage()),
            });
    }

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog goals-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconTarget size={18} />
                    <span className="dialog-title">{t("Project Targets")}</span>
                </div>
                <div className="dialog-body">
                    {!goals ? (
                        t("Loading…")
                    ) : (
                        <>
                            <section className="goals-section">
                                <h3>{t("Manuscript")}</h3>
                                <div className="goals-row">
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Word goal")}</span>
                                        <input
                                            type="number"
                                            autoFocus
                                            min={0}
                                            step={1000}
                                            value={projectGoal}
                                            onChange={(e) => setProjectGoal(e.target.value)}
                                        />
                                    </label>
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Deadline")}</span>
                                        <input
                                            type="date"
                                            value={deadline}
                                            onChange={(e) => setDeadline(e.target.value)}
                                        />
                                    </label>
                                </div>
                                <ProgressBar value={current} goal={pGoal} />
                                <div className="goals-caption">
                                    {pGoal > 0
                                        ? t("{n} of {goal} words ({pct}%)", {
                                              n: current.toLocaleString(getLanguage()),
                                              goal: pGoal.toLocaleString(getLanguage()),
                                              pct: Math.min(100, Math.round((current / pGoal) * 100)),
                                          })
                                        : t("{n} words in the manuscript. Set a goal to track progress.", {
                                              n: current.toLocaleString(getLanguage()),
                                          })}
                                </div>
                                {daily && <div className="goals-daily">{daily}</div>}
                                {deadline && pGoal === 0 && (
                                    <div className="goals-caption">{t("Add a word goal to see how much to write each day.")}</div>
                                )}
                            </section>

                            <section className="goals-section">
                                <h3>{t("Session")}</h3>
                                <label className="form-field">
                                    <span className="form-field-label">{t("Word goal for each session")}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step={100}
                                        value={sessionGoal}
                                        onChange={(e) => setSessionGoal(e.target.value)}
                                    />
                                </label>
                                <ProgressBar value={goals.session_added} goal={toNum(sessionGoal)} />
                                <div className="goals-caption">
                                    {tn(goals.session_added, "{n} word written since {time}", "{n} words written since {time}", {
                                        time: new Date(goals.session_started_at).toLocaleTimeString(getLanguage(), {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        }),
                                    })}
                                    {goals.session_removed > 0 &&
                                        ` · ${t("{n} removed", { n: goals.session_removed.toLocaleString(getLanguage()) })}`}
                                    {" · "}
                                    {tn(goals.today_added, "{n} word today", "{n} words today")}
                                </div>
                                <button type="button" onClick={newSession}>
                                    {t("New Session")}
                                </button>
                            </section>
                            <p className="prefs-note">
                                {t("Document targets are set in the Inspector (Metadata tab). Words count as written when you type them; find and replace or restoring a snapshot does not count.")}
                            </p>
                        </>
                    )}
                </div>
                <div className="dialog-footer">
                    <button type="button" onClick={onClose}>
                        {t("Cancel")}
                    </button>
                    <button type="button" className="primary" disabled={!goals || saving} onClick={submit}>
                        {t("Save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
