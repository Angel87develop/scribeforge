/// The project's label and status definitions (name + colour), shared
/// through React context so the binder, corkboard, outliner and inspector
/// colour things the same way and offer the same choices.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type ColorDef, type DefinitionRename } from "./api";

interface OrganizationValue {
    labels: ColorDef[];
    statuses: ColorDef[];
    /** Colour of a label, or null when it has none (unknown or empty). */
    labelColor: (name: string | undefined) => string | null;
    statusColor: (name: string | undefined) => string | null;
    save: (labels: ColorDef[], statuses: ColorDef[], renames: DefinitionRename[]) => Promise<void>;
}

const OrganizationContext = createContext<OrganizationValue>({
    labels: [],
    statuses: [],
    labelColor: () => null,
    statusColor: () => null,
    save: async () => undefined,
});

function finder(defs: ColorDef[]) {
    const map = new Map(defs.map((d) => [d.name.toLowerCase(), d.color]));
    return (name: string | undefined) => (name ? map.get(name.trim().toLowerCase()) ?? null : null);
}

export function OrganizationProvider({
    children,
    onError,
    onSaved,
}: {
    children: React.ReactNode;
    onError: (msg: string) => void;
    /** Called after definitions were stored (documents may have changed). */
    onSaved?: () => void;
}) {
    const [labels, setLabels] = useState<ColorDef[]>([]);
    const [statuses, setStatuses] = useState<ColorDef[]>([]);

    useEffect(() => {
        api.getOrganization()
            .then((o) => {
                setLabels(o.labels);
                setStatuses(o.statuses);
            })
            .catch(() => undefined);
    }, []);

    const save = useCallback(
        async (l: ColorDef[], s: ColorDef[], renames: DefinitionRename[]) => {
            try {
                const o = await api.setOrganization(l, s, renames);
                setLabels(o.labels);
                setStatuses(o.statuses);
                onSaved?.();
            } catch (e) {
                onError(String(e));
            }
        },
        [onError, onSaved],
    );

    const value = useMemo(
        () => ({ labels, statuses, labelColor: finder(labels), statusColor: finder(statuses), save }),
        [labels, statuses, save],
    );
    return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationValue {
    return useContext(OrganizationContext);
}
