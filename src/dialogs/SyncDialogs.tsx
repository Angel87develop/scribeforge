/// Working on one project from several computers through a synced folder
/// (OneDrive, Google Drive, Dropbox…). ScribeForge never talks to the cloud:
/// these dialogs only explain what the files on disk say.
///
/// - `useGuardedOpen`: checks a project before opening it and asks when
///   another computer has it open, or has a version still on its way.
/// - `SyncConflictDialog`: combines this computer's version with the one on
///   disk (or a conflict copy), document by document.
/// - `ConflictCopiesDialog`: offers the copies a cloud client made.
/// - `BackupsDialog`: this computer's backups of the open project.
/// - `SyncHelpDialog` and `SyncTip`: how to set up a synced folder.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    api,
    type BackupDto,
    type CloudProvider,
    type ConflictCopy,
    type DiffResult,
    type MergeItem,
    type MergeSide,
    type OpenCheck,
    type OpenProjectResult,
    type SyncConflict,
} from "../services/api";
import { IconClock, IconFolder, IconHelp, IconRefresh } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/writing.css";
import "../styles/sync.css";
import { getLanguage, t } from "../i18n";

/** The other computer's name, or a generic one when it has none. */
export function deviceLabel(name: string | null | undefined): string {
    return name ? name : t("another computer");
}

export function providerFolderLabel(p: CloudProvider): string {
    switch (p) {
        case "onedrive":
            return t("OneDrive folder");
        case "google_drive":
            return t("Google Drive folder");
        case "dropbox":
            return t("Dropbox folder");
        case "icloud":
            return t("iCloud Drive folder");
    }
}

/** "2 minutes ago", in the interface language. */
function ago(iso: string | null): string {
    if (!iso) return "—";
    const secs = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(getLanguage(), { numeric: "auto" });
    if (Math.abs(secs) < 60) return rtf.format(secs, "second");
    if (Math.abs(secs) < 3600) return rtf.format(Math.round(secs / 60), "minute");
    if (Math.abs(secs) < 86400) return rtf.format(Math.round(secs / 3600), "hour");
    return rtf.format(Math.round(secs / 86400), "day");
}

function dateTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(getLanguage(), { dateStyle: "medium", timeStyle: "short" });
}

function useEscape(onEscape: () => void) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onEscape();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onEscape]);
}

// ---------------------------------------------------------------------------
// Opening a project
// ---------------------------------------------------------------------------

/**
 * `request(path)` opens a project, first asking when another computer has
 * it open or has saved a version that has not arrived yet. Render `dialog`.
 */
export function useGuardedOpen(
    onOpened: (r: OpenProjectResult) => void,
    onError: (msg: string) => void,
    onCancelled?: () => void,
) {
    const [pending, setPending] = useState<{ path: string; check: OpenCheck } | null>(null);

    const open = useCallback(
        async (path: string, readOnly = false) => {
            setPending(null);
            try {
                onOpened(await api.openProjectAtPath(path, readOnly));
            } catch (e) {
                onError(t("Failed to open project: {error}", { error: String(e) }));
            }
        },
        [onOpened, onError],
    );

    const request = useCallback(
        async (path: string) => {
            try {
                const check = await api.checkProjectOpen(path);
                if (check.status === "ok") await open(path);
                else setPending({ path, check });
            } catch (e) {
                onError(t("Failed to open project: {error}", { error: String(e) }));
            }
        },
        [open, onError],
    );

    const dialog = pending ? (
        <OpenCheckDialog
            path={pending.path}
            check={pending.check}
            onOpen={(readOnly) => open(pending.path, readOnly)}
            onCancel={() => {
                setPending(null);
                onCancelled?.();
            }}
        />
    ) : null;

    return { request, dialog };
}

function OpenCheckDialog({
    path,
    check: initial,
    onOpen,
    onCancel,
}: {
    path: string;
    check: OpenCheck;
    onOpen: (readOnly: boolean) => void;
    onCancel: () => void;
}) {
    const [check, setCheck] = useState(initial);
    const [waiting, setWaiting] = useState(false);
    useEscape(onCancel);

    // "Wait": look again every few seconds and open as soon as the version
    // from the other computer is here.
    useEffect(() => {
        if (!waiting) return;
        const id = window.setInterval(async () => {
            try {
                const next = await api.checkProjectOpen(path);
                if (next.status === "ok") {
                    window.clearInterval(id);
                    onOpen(false);
                } else {
                    setCheck(next);
                    if (next.status !== "syncing") setWaiting(false);
                }
            } catch {
                // The file may be mid-download; try again on the next tick.
            }
        }, 3000);
        return () => window.clearInterval(id);
    }, [waiting, path, onOpen]);

    return (
        <div className="overlay-root" onMouseDown={onCancel}>
            <div className="dialog sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
                {check.status === "open_elsewhere" && (
                    <>
                        <div className="dialog-header">
                            <span className="sync-dialog-icon">🔒</span>
                            <span className="dialog-title">
                                {t("This project is open on {device}", { device: deviceLabel(check.device_name) })}
                            </span>
                        </div>
                        <div className="dialog-body">
                            <p>{t("Last activity: {when}.", { when: ago(check.last_seen) })}</p>
                            <p className="sync-muted">
                                {t("If you write in both places at once, you may have to choose between versions later.")}
                            </p>
                        </div>
                        <div className="dialog-footer">
                            <button onClick={onCancel}>{t("Cancel")}</button>
                            <button onClick={() => onOpen(false)}>{t("Open anyway")}</button>
                            <button className="primary" autoFocus onClick={() => onOpen(true)}>
                                {t("Open read-only")}
                            </button>
                        </div>
                    </>
                )}
                {check.status === "syncing" && (
                    <>
                        <div className="dialog-header">
                            <span className="sync-dialog-icon">⏳</span>
                            <span className="dialog-title">{t("The latest version is still syncing")}</span>
                        </div>
                        <div className="dialog-body">
                            <p>
                                {t("You saved this project on {device} {when}, but your cloud app has not brought that version to this computer yet.", {
                                    device: deviceLabel(check.device_name),
                                    when: ago(check.saved_at),
                                })}
                            </p>
                            {waiting && (
                                <p className="sync-waiting">
                                    <span className="spinner" /> {t("Waiting for the new version…")}
                                </p>
                            )}
                        </div>
                        <div className="dialog-footer">
                            <button onClick={onCancel}>{t("Cancel")}</button>
                            <button onClick={() => onOpen(false)}>{t("Open the version that is here")}</button>
                            <button className="primary" autoFocus disabled={waiting} onClick={() => setWaiting(true)}>
                                <IconClock size={14} /> {t("Wait")}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Combining two versions
// ---------------------------------------------------------------------------

interface ConflictProps {
    /** A conflict copy to combine; omitted for the version on disk. */
    copyPath?: string;
    /** `applied` is false when the user cancelled (copies only). */
    onDone: (applied: boolean) => void;
    onError: (msg: string) => void;
}

export function SyncConflictDialog({ copyPath, onDone, onError }: ConflictProps) {
    const [data, setData] = useState<SyncConflict | null>(null);
    const [choices, setChoices] = useState<Record<string, MergeSide>>({});
    const [diffFor, setDiffFor] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Read once per dialog, whatever the parent passes on later renders.
    const callbacks = useRef({ onDone, onError });
    callbacks.current = { onDone, onError };

    useEffect(() => {
        api.getSyncConflict(copyPath)
            .then((d) => {
                setData(d);
                setChoices(Object.fromEntries(d.items.filter((i) => i.change === "both").map((i) => [i.id, i.suggested])));
            })
            .catch((e) => {
                callbacks.current.onError(String(e));
                callbacks.current.onDone(false);
            });
    }, [copyPath]);

    const cancel = useCallback(() => {
        if (!copyPath) return; // The version on disk has to be combined.
        api.cancelSyncConflict().catch(() => undefined);
        onDone(false);
    }, [copyPath, onDone]);
    useEscape(cancel);

    const apply = async () => {
        if (!data) return;
        setBusy(true);
        const label = t("Version from {device} ({date})", {
            device: data.copy_name ?? deviceLabel(data.device_name),
            date: new Date().toLocaleString(getLanguage(), { dateStyle: "short", timeStyle: "short" }),
        });
        try {
            await api.resolveSyncConflict(choices, label);
            onDone(true);
        } catch (e) {
            onError(String(e));
            setBusy(false);
        }
    };

    const other = data ? (data.copy_name ?? deviceLabel(data.device_name)) : "";

    return (
        <div className="overlay-root">
            <div className="dialog sync-dialog sync-conflict" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconRefresh size={18} />
                    <span className="dialog-title">
                        {copyPath ? t("Combine with another copy") : t("Changes on two computers")}
                    </span>
                </div>
                <div className="dialog-body">
                    {!data ? (
                        <p>{t("Comparing…")}</p>
                    ) : (
                        <>
                            <p>
                                {copyPath
                                    ? t("“{file}” has changes that are not in the open project.", { file: data.copy_name ?? "" })
                                    : t("This project was changed here and on {device}.", { device: other })}
                            </p>
                            {data.items.length === 0 ? (
                                <p className="sync-muted">{t("Both versions have the same documents.")}</p>
                            ) : (
                                <div className="sync-items">
                                    {data.items.map((item) => (
                                        <ConflictRow
                                            key={item.id}
                                            item={item}
                                            other={other}
                                            choice={choices[item.id]}
                                            onChoose={(side) => setChoices((c) => ({ ...c, [item.id]: side }))}
                                            showDiff={diffFor === item.id}
                                            onToggleDiff={() => setDiffFor((d) => (d === item.id ? null : item.id))}
                                            onError={onError}
                                        />
                                    ))}
                                </div>
                            )}
                            <p className="sync-muted">
                                {t("“Keep both” keeps this computer's text and saves the other one as a snapshot of the document, so nothing is lost.")}
                            </p>
                        </>
                    )}
                </div>
                <div className="dialog-footer">
                    {copyPath && <button onClick={cancel}>{t("Cancel")}</button>}
                    <button className="primary" disabled={!data || busy} onClick={apply}>
                        {copyPath ? t("Combine") : t("Apply")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ConflictRow({
    item,
    other,
    choice,
    onChoose,
    showDiff,
    onToggleDiff,
    onError,
}: {
    item: MergeItem;
    other: string;
    choice: MergeSide | undefined;
    onChoose: (side: MergeSide) => void;
    showDiff: boolean;
    onToggleDiff: () => void;
    onError: (msg: string) => void;
}) {
    const title = item.title || t("Untitled");
    let where: string;
    let result: string | null = null;
    if (item.change === "local_only") {
        where = item.local_deleted ? t("deleted here") : t("only here");
        result = item.local_deleted ? t("stays deleted") : t("kept");
    } else if (item.change === "remote_only") {
        where = item.remote_deleted
            ? t("deleted on {device}", { device: other })
            : t("only on {device}", { device: other });
        result = item.remote_deleted ? t("deleted") : t("added");
    } else {
        where = item.local_deleted
            ? t("deleted here, changed on {device}", { device: other })
            : item.remote_deleted
              ? t("changed here, deleted on {device}", { device: other })
              : t("on both");
    }
    return (
        <div className="sync-item">
            <div className="sync-item-row">
                <span className="sync-item-title" title={title}>
                    {title}
                </span>
                <span className="sync-item-where">{where}</span>
                {result !== null ? (
                    <span className="sync-item-result">✓ {result}</span>
                ) : (
                    <select value={choice ?? item.suggested} onChange={(e) => onChoose(e.target.value as MergeSide)}>
                        <option value="local">{t("This computer")}</option>
                        <option value="remote">{other}</option>
                        <option value="both">{t("Keep both")}</option>
                    </select>
                )}
                {item.change === "both" && item.comparable && (
                    <button className="subtle" onClick={onToggleDiff}>
                        {showDiff ? t("Hide differences") : t("Show differences")}
                    </button>
                )}
            </div>
            {showDiff && <ConflictDiff id={item.id} other={other} onError={onError} />}
        </div>
    );
}

function ConflictDiff({ id, other, onError }: { id: string; other: string; onError: (msg: string) => void }) {
    const [diff, setDiff] = useState<DiffResult | null>(null);
    useEffect(() => {
        api.syncConflictDiff(id)
            .then(setDiff)
            .catch((e) => onError(String(e)));
    }, [id, onError]);
    return (
        <div className="sync-diff">
            <div className="compare-legend">
                <del>{other}</del>
                <span>→</span>
                <ins>{t("This computer")}</ins>
            </div>
            {!diff ? (
                t("Comparing…")
            ) : (
                <div className="compare-text">
                    {diff.chunks.map((c, i) =>
                        c.kind === "insert" ? (
                            <ins key={i}>{c.text}</ins>
                        ) : c.kind === "delete" ? (
                            <del key={i}>{c.text}</del>
                        ) : (
                            <span key={i}>{c.text}</span>
                        ),
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Conflict copies
// ---------------------------------------------------------------------------

export function ConflictCopiesDialog({
    copies,
    onReview,
    onIgnore,
}: {
    copies: ConflictCopy[];
    onReview: (copy: ConflictCopy) => void;
    onIgnore: () => void;
}) {
    useEscape(onIgnore);
    return (
        <div className="overlay-root" onMouseDown={onIgnore}>
            <div className="dialog sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconFolder size={18} />
                    <span className="dialog-title">
                        {copies.length === 1
                            ? t("Another copy of this project was found")
                            : t("Other copies of this project were found")}
                    </span>
                </div>
                <div className="dialog-body">
                    <p className="sync-muted">
                        {t("Cloud apps make these copies when two computers changed the project at the same time.")}
                    </p>
                    <div className="sync-items">
                        {copies.map((c) => (
                            <div key={c.path} className="sync-item-row">
                                <span className="sync-item-title" title={c.path}>
                                    {c.file_name}
                                </span>
                                <span className="sync-item-where">{dateTime(c.modified_at)}</span>
                                <button onClick={() => onReview(c)}>{t("Review and combine")}</button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="dialog-footer">
                    <button onClick={onIgnore}>{t("Ignore")}</button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export function BackupsDialog({
    onClose,
    onRestored,
    onError,
}: {
    onClose: () => void;
    /** Called after a backup replaced the project (already saved). */
    onRestored: () => void;
    onError: (msg: string) => void;
}) {
    const [backups, setBackups] = useState<BackupDto[] | null>(null);
    useEscape(onClose);

    useEffect(() => {
        api.listLocalBackups()
            .then(setBackups)
            .catch((e) => onError(String(e)));
    }, [onError]);

    const restore = async (b: BackupDto) => {
        if (!confirm(t("Replace the project with the backup from {date}?", { date: dateTime(b.created_at) }))) return;
        try {
            await api.restoreLocalBackup(b.path);
            onRestored();
        } catch (e) {
            onError(String(e));
        }
    };

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconClock size={18} />
                    <span className="dialog-title">{t("Backups")}</span>
                </div>
                <div className="dialog-body">
                    {!backups ? (
                        <p>{t("Loading…")}</p>
                    ) : backups.length === 0 ? (
                        <p className="sync-muted">{t("There are no backups of this project on this computer yet.")}</p>
                    ) : (
                        <div className="sync-items">
                            {backups.map((b) => (
                                <div key={b.path} className="sync-item-row">
                                    <span className="sync-item-title">{dateTime(b.created_at)}</span>
                                    <span className="sync-item-where">
                                        {(b.size / 1024).toLocaleString(getLanguage(), { maximumFractionDigits: 0 })} KB
                                    </span>
                                    <button onClick={() => restore(b)}>{t("Restore")}</button>
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="sync-muted">
                        {t("These backups are kept only on this computer. For versions saved on another computer, use your cloud's version history (right-click the file → Version history).")}
                    </p>
                </div>
                <div className="dialog-footer">
                    <button onClick={onClose}>{t("Close")}</button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Setting up a synced folder
// ---------------------------------------------------------------------------

type HelpTab = "google_drive" | "onedrive" | "dropbox";

export function SyncHelpDialog({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<HelpTab>("google_drive");
    useEscape(onClose);

    const steps: Record<HelpTab, string[]> = {
        google_drive: [
            t("Install “Google Drive for desktop” from Google's website."),
            t("Open it and sign in with your Google account — in Google's app, not in ScribeForge."),
            t("A new drive appears: “Google Drive (G:)” on Windows, or “Google Drive” in the Finder sidebar on a Mac."),
            t("Save your projects in a folder inside “My Drive”, for example My Drive\\Novels."),
            t("Recommended: right-click that folder → “Available offline”, so projects open quickly and without internet."),
            t("Repeat on your other computer with the same Google account."),
        ],
        onedrive: [
            t("OneDrive comes with Windows. Sign in to it with your Microsoft account (on a Mac, install the OneDrive app)."),
            t("Save your projects in a folder inside OneDrive, for example OneDrive\\Novels."),
            t("Recommended: right-click that folder → “Always keep on this device”."),
            t("Repeat on your other computer with the same Microsoft account."),
        ],
        dropbox: [
            t("Install the Dropbox app and sign in to it."),
            t("Save your projects in a folder inside Dropbox, for example Dropbox\\Novels."),
            t("Recommended: right-click that folder → “Make available offline”."),
            t("Repeat on your other computer with the same Dropbox account."),
        ],
    };

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog sync-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconHelp size={18} />
                    <span className="dialog-title">{t("Write on several computers")}</span>
                </div>
                <div className="dialog-body">
                    <p>
                        {t("ScribeForge does not connect to your cloud account. It only saves files in the folder you choose; your OneDrive, Google Drive or Dropbox app uploads them and brings them to your other computers.")}
                    </p>
                    <div className="sync-help-tabs">
                        {(["google_drive", "onedrive", "dropbox"] as HelpTab[]).map((id) => (
                            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                                {id === "google_drive" ? "Google Drive" : id === "onedrive" ? "OneDrive" : "Dropbox"}
                            </button>
                        ))}
                    </div>
                    <ol className="sync-help-steps">
                        {steps[tab].map((s) => (
                            <li key={s}>{s}</li>
                        ))}
                    </ol>
                    <p className="sync-muted">
                        {t("Close the project when you finish on one computer. If something does not match, ScribeForge warns you and lets you choose, without losing anything.")}
                    </p>
                </div>
                <div className="dialog-footer">
                    <button className="primary" onClick={onClose}>
                        {t("Close")}
                    </button>
                </div>
            </div>
        </div>
    );
}

const TIP_KEY = "sf.syncTip.dismissed";

function tipDismissed(): boolean {
    try {
        return localStorage.getItem(TIP_KEY) === "1";
    } catch {
        return false;
    }
}

/** First-run card: keep projects in a cloud folder to use several computers. */
export function SyncTip({ onChooseFolder }: { onChooseFolder: () => void }) {
    const [hidden, setHidden] = useState(tipDismissed);
    const [help, setHelp] = useState(false);
    if (hidden) return null;
    const dismiss = () => {
        try {
            localStorage.setItem(TIP_KEY, "1");
        } catch {
            // Without storage the card simply shows again next time.
        }
        setHidden(true);
    };
    return (
        <div className="sync-tip">
            <div className="sync-tip-title">💡 {t("Do you write on several computers?")}</div>
            <div className="sync-tip-text">
                {t("Save your projects inside your OneDrive, Google Drive or Dropbox folder and open them on any computer with ScribeForge.")}
            </div>
            <div className="sync-tip-actions">
                <button
                    className="primary"
                    onClick={() => {
                        onChooseFolder();
                        dismiss();
                    }}
                >
                    {t("Choose projects folder")}
                </button>
                <button onClick={() => setHelp(true)}>{t("How do I set it up?")}</button>
                <button className="subtle" onClick={dismiss}>
                    {t("Not now")}
                </button>
            </div>
            {help && <SyncHelpDialog onClose={() => setHelp(false)} />}
        </div>
    );
}
