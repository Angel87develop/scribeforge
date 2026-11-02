/// A thin progress bar toward a word goal. With no goal (0) it shows an
/// empty track; at or past the goal the fill turns to the success colour.

interface Props {
    value: number;
    goal: number;
    /** "sm" for the status bar and title bars. */
    size?: "sm" | "md";
    title?: string;
}

export function ProgressBar({ value, goal, size = "md", title }: Props) {
    const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
    const done = goal > 0 && value >= goal;
    return (
        <span
            className={`progress progress-${size}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={goal || 1}
            aria-valuenow={Math.min(value, goal || value)}
            title={title}
        >
            <span className={`progress-fill${done ? " done" : ""}`} style={{ width: `${pct}%` }} />
        </span>
    );
}
