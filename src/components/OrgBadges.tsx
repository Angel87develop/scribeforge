/// Small coloured markers for labels and statuses, and the pickers that
/// choose them from the project's definitions. Colour never stands alone:
/// every marker carries the name as text or tooltip.

import { useOrganization } from "../services/organization";
import "../styles/organization.css";
import { t } from "../i18n";

/** A filled dot in the label's colour (nothing when the label has none). */
export function LabelDot({ name, size = 8 }: { name: string | undefined; size?: number }) {
    const { labelColor } = useOrganization();
    const color = labelColor(name);
    if (!color) return null;
    return (
        <span
            className="label-dot"
            style={{ background: color, width: size, height: size }}
            title={t("Label: {name}", { name: name ?? "" })}
            aria-label={t("Label: {name}", { name: name ?? "" })}
        />
    );
}

/** The status name with a dot in its colour; `compact` shows the dot only. */
export function StatusBadge({ name, compact = false }: { name: string; compact?: boolean }) {
    const { statusColor } = useOrganization();
    if (!name) return null;
    const color = statusColor(name) ?? "var(--text-muted)";
    return (
        <span className={`status-badge${compact ? " compact" : ""}`} title={t("Status: {name}", { name })}>
            <span className="status-badge-dot" style={{ borderColor: color, background: compact ? "transparent" : color }} />
            {!compact && <span className="status-badge-text">{name}</span>}
        </span>
    );
}

/** The label name in a tinted chip. */
export function LabelChip({ name }: { name: string }) {
    const { labelColor } = useOrganization();
    if (!name) return null;
    const color = labelColor(name);
    return (
        <span className="label-chip" title={t("Label: {name}", { name })}>
            {color && <span className="label-dot" style={{ background: color }} />}
            {name}
        </span>
    );
}

/** Select for a status; keeps an unknown current value selectable. */
export function StatusSelect({
    value,
    onChange,
    className,
}: {
    value: string;
    onChange: (v: string) => void;
    className?: string;
}) {
    const { statuses } = useOrganization();
    const known = statuses.some((s) => s.name === value);
    return (
        <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
            {!known && <option value={value}>{value || "(none)"}</option>}
            {statuses.map((s) => (
                <option key={s.name} value={s.name} style={{ color: s.color }}>
                    ● {s.name}
                </option>
            ))}
        </select>
    );
}

/** Select for a label: "(none)", the defined labels, and an unknown current one. */
export function LabelSelect({
    value,
    onChange,
    className,
}: {
    value: string;
    onChange: (v: string) => void;
    className?: string;
}) {
    const { labels } = useOrganization();
    const known = !value || labels.some((l) => l.name === value);
    return (
        <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{t("(no label)")}</option>
            {!known && <option value={value}>{value}</option>}
            {labels.map((l) => (
                <option key={l.name} value={l.name} style={{ color: l.color }}>
                    ● {l.name}
                </option>
            ))}
        </select>
    );
}
