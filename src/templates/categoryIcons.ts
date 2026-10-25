/// Category icon helper: maps a category id to an icon component.

import type { ComponentType } from "react";
import {
    IconBook,
    IconDocument,
    IconFolderOpen,
    IconList,
    IconPen,
    IconCards,
    IconSettings,
} from "../components/Icons";

const MAP: Record<string, ComponentType<{ size?: number; className?: string }>> = {
    "getting-started": IconBook,
    all: IconList,
    blank: IconDocument,
    fiction: IconPen,
    "non-fiction": IconBook,
    scriptwriting: IconCards,
    miscellaneous: IconFolderOpen,
};

export function categoryIcon(id: string): ComponentType<{ size?: number; className?: string }> {
    return MAP[id] ?? IconSettings;
}
