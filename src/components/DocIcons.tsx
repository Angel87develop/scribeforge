/// Custom document icons for the binder ("Change Icon" menu).
///
/// Unlike `Icons.tsx` (monochrome UI glyphs that inherit `currentColor`),
/// these are small full-colour pictures in the spirit of Scrivener's binder
/// icons. Each one is drawn on a 16x16 grid.
///
/// Icon ids are stored on the document (`icon` field):
/// - grouped icons use "group:variant", e.g. "book:red", "todo:ticked";
/// - single icons use a plain id, e.g. "light-bulb".
/// Unknown ids render nothing, so the caller can fall back to the default.

import type { CSSProperties, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

interface Swatch {
    id: string;
    label: string;
    fill: string;
    dark: string;
}

const COLORS: Swatch[] = [
    { id: "red", label: "Red", fill: "#e5534b", dark: "#a8312b" },
    { id: "orange", label: "Orange", fill: "#f0883e", dark: "#b45f1f" },
    { id: "yellow", label: "Yellow", fill: "#f5c842", dark: "#b8901c" },
    { id: "green", label: "Green", fill: "#57ab5a", dark: "#2f7a33" },
    { id: "teal", label: "Teal", fill: "#39b0a8", dark: "#1f7a74" },
    { id: "blue", label: "Blue", fill: "#4a90d9", dark: "#2a62a3" },
    { id: "purple", label: "Purple", fill: "#9b6bd3", dark: "#6a419e" },
    { id: "pink", label: "Pink", fill: "#ec7fb0", dark: "#b24d7d" },
    { id: "brown", label: "Brown", fill: "#a87b51", dark: "#6f4d2e" },
    { id: "grey", label: "Grey", fill: "#9aa0a6", dark: "#5f6368" },
    { id: "black", label: "Black", fill: "#3c3c3c", dark: "#111111" },
];

const color = (id: string) => COLORS.find((c) => c.id === id);

// Shared neutrals.
const PAPER = "#ffffff";
const LINE = "#7d8590";
const INK = "#4b5258";

// ---------------------------------------------------------------------------
// Coloured families
// ---------------------------------------------------------------------------

function book(c: Swatch): ReactNode {
    return (
        <>
            <rect x="3" y="1.5" width="10.5" height="13" rx="1" fill={c.fill} stroke={c.dark} />
            <path d="M5 1.5v13" stroke={c.dark} />
            <rect x="7" y="4" width="4.5" height="2.5" rx="0.4" fill={PAPER} opacity="0.85" />
        </>
    );
}

function wayStation(c: Swatch): ReactNode {
    return (
        <>
            <path d="M3.5 1.5v13" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
            <path d="M4 2.5h8.5l2 2.25-2 2.25H4z" fill={c.fill} stroke={c.dark} strokeLinejoin="round" />
            <path d="M4 8.5h6.5l1.5 1.75-1.5 1.75H4z" fill={c.fill} stroke={c.dark} strokeLinejoin="round" opacity="0.75" />
        </>
    );
}

function flag(c: Swatch): ReactNode {
    return (
        <>
            <path d="M3 1.5v13" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
            <path
                d="M3.5 2.5c2-1 3.5 1 5.5 0s3-1 4.5-.5v6.5c-1.5-.5-2.5-.5-4.5.5s-3.5-1-5.5 0z"
                fill={c.fill}
                stroke={c.dark}
                strokeLinejoin="round"
            />
        </>
    );
}

function notepad(c: Swatch): ReactNode {
    return (
        <>
            <rect x="2.5" y="2.5" width="11" height="12" rx="1" fill={c.fill} stroke={c.dark} />
            <path d="M4.5 6.5h7M4.5 9h7M4.5 11.5h5" stroke={c.dark} strokeWidth="0.8" opacity="0.7" />
            <path d="M5 1v3M8 1v3M11 1v3" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
        </>
    );
}

// ---------------------------------------------------------------------------
// Single icons
// ---------------------------------------------------------------------------

const sheet = (extra: ReactNode): ReactNode => (
    <>
        <path d="M3 1.5h7l3 3v10H3z" fill={PAPER} stroke={LINE} strokeLinejoin="round" />
        <path d="M10 1.5v3h3" fill="none" stroke={LINE} strokeLinejoin="round" />
        {extra}
    </>
);

const SINGLES: Record<string, ReactNode> = {
    // Characters
    "character:sheet": sheet(
        <>
            <circle cx="8" cy="7" r="1.8" fill="#e0a370" />
            <path d="M4.8 12.5c.4-2 1.6-3 3.2-3s2.8 1 3.2 3z" fill="#4a90d9" />
        </>,
    ),
    "character:mask": (
        <>
            <path d="M2 3.5c2-1 4-1 6 0 2-1 4-1 6 0v3.5c0 3.5-2.5 6-6 7-3.5-1-6-3.5-6-7z" fill="#f5c842" stroke="#b8901c" strokeLinejoin="round" />
            <path d="M4 6.5c.7-.6 1.6-.6 2.3 0M9.7 6.5c.7-.6 1.6-.6 2.3 0" stroke={INK} strokeWidth="1.1" strokeLinecap="round" fill="none" />
            <path d="M5.5 10c1.5 1.3 3.5 1.3 5 0" stroke="#a8312b" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </>
    ),
    "character:photo": (
        <>
            <rect x="2" y="1.5" width="12" height="13" rx="0.8" fill={PAPER} stroke={LINE} />
            <rect x="3.5" y="3" width="9" height="8" fill="#cfe3f5" />
            <circle cx="8" cy="6" r="1.7" fill="#e0a370" />
            <path d="M4.8 11c.4-1.8 1.6-2.7 3.2-2.7s2.8.9 3.2 2.7z" fill="#57ab5a" />
        </>
    ),

    // Locations
    "location:sheet": sheet(
        <>
            <path d="M8 13s-3-3.2-3-5.3a3 3 0 0 1 6 0C11 9.8 8 13 8 13z" fill="#e5534b" stroke="#a8312b" strokeWidth="0.8" />
            <circle cx="8" cy="7.6" r="1" fill={PAPER} />
        </>,
    ),
    "location:map": (
        <>
            <path d="M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z" fill="#f4e6b8" stroke="#a8925a" strokeLinejoin="round" />
            <path d="M5.5 2v10.5M10.5 3.5V14" stroke="#a8925a" strokeWidth="0.8" />
            <path d="M3 8.5c1.5-1 2.5 1 4 0s2.5-2 4.5-.5" stroke="#4a90d9" strokeWidth="1" fill="none" />
            <circle cx="11.5" cy="6" r="1.1" fill="#e5534b" />
        </>
    ),

    // To Do
    "todo:unticked": (
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill={PAPER} stroke={LINE} strokeWidth="1.2" />
    ),
    "todo:ticked": (
        <>
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill={PAPER} stroke={LINE} strokeWidth="1.2" />
            <path d="M4.5 8.2l2.4 2.4 5-5.6" stroke="#2f7a33" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
    ),

    // TV
    tv: (
        <>
            <rect x="1.5" y="3" width="13" height="9" rx="1" fill="#4b5258" stroke="#24292e" />
            <rect x="3" y="4.5" width="10" height="6" rx="0.5" fill="#7ab8e8" />
            <path d="M5.5 14.5h5M8 12v2.5" stroke="#24292e" strokeLinecap="round" />
        </>
    ),

    // Flat list
    "back-matter": (
        <>
            <rect x="3.5" y="1.5" width="10" height="13" rx="0.8" fill="#d8dce0" stroke={LINE} />
            <rect x="2.5" y="1.5" width="2.5" height="13" rx="0.6" fill="#9aa0a6" stroke={LINE} />
            <path d="M7 11h4.5M7 12.8h3" stroke={LINE} strokeWidth="0.9" />
        </>
    ),
    "front-matter": (
        <>
            <rect x="2.5" y="1.5" width="10" height="13" rx="0.8" fill="#d8dce0" stroke={LINE} />
            <rect x="11" y="1.5" width="2.5" height="13" rx="0.6" fill="#9aa0a6" stroke={LINE} />
            <path d="M4.5 4h4.5M4.5 5.8h3" stroke={LINE} strokeWidth="0.9" />
        </>
    ),
    blackboard: (
        <>
            <rect x="1.5" y="2" width="13" height="9.5" rx="0.6" fill="#2f4a3a" stroke="#8b5e34" strokeWidth="1.2" />
            <path d="M3.5 5h5M3.5 7.5h7" stroke="#f0f0f0" strokeWidth="0.9" strokeLinecap="round" />
            <path d="M4 11.5L3 14.5M12 11.5l1 3" stroke="#8b5e34" strokeWidth="1.2" strokeLinecap="round" />
        </>
    ),
    calendar: (
        <>
            <rect x="2" y="2.5" width="12" height="12" rx="1" fill={PAPER} stroke={LINE} />
            <path d="M2 2.5h12v3H2z" fill="#e5534b" />
            <path d="M5 1.5v2.5M11 1.5v2.5" stroke={INK} strokeLinecap="round" />
            <path d="M4 8h2M7 8h2M10 8h2M4 10.5h2M7 10.5h2M10 10.5h2M4 13h2" stroke={LINE} strokeWidth="1" />
        </>
    ),
    "clapper-board": (
        <>
            <rect x="2" y="6" width="12" height="8.5" rx="0.6" fill="#3c3c3c" />
            <path d="M2 3.5l11.5-2 .5 3-11.5 2z" fill="#f0f0f0" stroke="#3c3c3c" strokeLinejoin="round" />
            <path d="M4.5 3.1l1.8 2.6M7.8 2.5l1.8 2.6M11.1 1.9l1.8 2.6" stroke="#3c3c3c" strokeWidth="1.2" />
            <path d="M4 9h8M4 11.5h5" stroke="#f0f0f0" strokeWidth="0.9" />
        </>
    ),
    clock: (
        <>
            <circle cx="8" cy="8" r="6.5" fill={PAPER} stroke={LINE} strokeWidth="1.2" />
            <path d="M8 4.2V8l2.6 1.8" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </>
    ),
    cog: (
        <>
            <path
                d="M7 1.5h2l.4 1.8 1.3.6 1.6-1 1.4 1.4-1 1.6.6 1.3 1.8.4v2l-1.8.4-.6 1.3 1 1.6-1.4 1.4-1.6-1-1.3.6L9 14.5H7l-.4-1.8-1.3-.6-1.6 1-1.4-1.4 1-1.6-.6-1.3L1.5 9V7l1.8-.4.6-1.3-1-1.6 1.4-1.4 1.6 1 1.3-.6z"
                fill="#9aa0a6"
                stroke="#5f6368"
                strokeWidth="0.8"
                strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="2.2" fill={PAPER} stroke="#5f6368" strokeWidth="0.8" />
        </>
    ),
    eye: (
        <>
            <path d="M1 8c2-3.5 4.4-5 7-5s5 1.5 7 5c-2 3.5-4.4 5-7 5s-5-1.5-7-5z" fill={PAPER} stroke={INK} strokeLinejoin="round" />
            <circle cx="8" cy="8" r="2.8" fill="#4a90d9" />
            <circle cx="8" cy="8" r="1.2" fill="#111" />
        </>
    ),
    "figures-graphs": (
        <>
            <rect x="1.5" y="2" width="13" height="12" rx="0.8" fill={PAPER} stroke={LINE} />
            <path d="M3 12.5l3-4 2.5 2 4.5-6" stroke="#4a90d9" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 3.5v9.5h10.5" stroke={LINE} strokeWidth="0.8" fill="none" />
        </>
    ),
    "filing-cabinet": (
        <>
            <rect x="3" y="1.5" width="10" height="13" rx="0.8" fill="#c4c9ce" stroke="#5f6368" />
            <path d="M3 5.8h10M3 10.2h10" stroke="#5f6368" />
            <path d="M6.5 3.6h3M6.5 8h3M6.5 12.4h3" stroke="#3c3c3c" strokeWidth="1.2" strokeLinecap="round" />
        </>
    ),
    information: (
        <>
            <path d="M8 1.5l6.8 12.5H1.2z" fill="#4a90d9" stroke="#2a62a3" strokeLinejoin="round" />
            <circle cx="8" cy="6.5" r="0.9" fill={PAPER} />
            <path d="M8 8.8v3.2" stroke={PAPER} strokeWidth="1.6" strokeLinecap="round" />
        </>
    ),
    lectern: (
        <>
            <path d="M2.5 3l11-1-1 4h-9z" fill="#c98a4b" stroke="#6f4d2e" strokeLinejoin="round" />
            <path d="M7 6h2v7H7z" fill="#a87b51" stroke="#6f4d2e" />
            <path d="M4 14.5h8" stroke="#6f4d2e" strokeWidth="1.4" strokeLinecap="round" />
        </>
    ),
    "light-bulb": (
        <>
            <path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.5.4.8 1 .8 1.6h3.6c0-.6.3-1.2.8-1.6A4.5 4.5 0 0 0 8 1.5z" fill="#f5d94a" stroke="#b8901c" strokeLinejoin="round" />
            <path d="M6.2 12.3h3.6M6.5 13.8h3" stroke={LINE} strokeWidth="1.2" strokeLinecap="round" />
        </>
    ),
    "magnifying-glass": (
        <>
            <circle cx="6.5" cy="6.5" r="4.5" fill="#cfe3f5" stroke="#4a90d9" strokeWidth="1.4" />
            <path d="M10 10l4.5 4.5" stroke="#6f4d2e" strokeWidth="2.2" strokeLinecap="round" />
        </>
    ),
    music: (
        <>
            <path d="M6 12V3.5l7-1.5v8.5" stroke="#4a90d9" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
            <ellipse cx="4.5" cy="12.3" rx="2" ry="1.6" fill="#4a90d9" />
            <ellipse cx="11.5" cy="10.8" rx="2" ry="1.6" fill="#4a90d9" />
        </>
    ),
    "musical-notes": (
        <>
            <path d="M5.5 12V3l4 1.5" stroke="#4a90d9" strokeWidth="1.3" fill="none" strokeLinecap="round" />
            <ellipse cx="4" cy="12.3" rx="2" ry="1.6" fill="#4a90d9" />
            <path d="M12.5 13V6.5l2 .8" stroke="#9b6bd3" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <ellipse cx="11.2" cy="13.2" rx="1.6" ry="1.3" fill="#9b6bd3" />
        </>
    ),
    outline: (
        <>
            <rect x="2" y="2" width="12" height="12" rx="0.8" fill={PAPER} stroke={LINE} />
            <path d="M4 5h1M6.5 5h5M5.5 8h1M8 8h4M5.5 11h1M8 11h4" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
        </>
    ),
    pencil: (
        <>
            <path d="M11 2l3 3-8.5 8.5-3.7.7.7-3.7z" fill="#f5c842" stroke="#b8901c" strokeLinejoin="round" />
            <path d="M11 2l3 3-1.3 1.3-3-3z" fill="#ec7fb0" stroke="#b24d7d" strokeLinejoin="round" />
            <path d="M2.8 13.2l.3-1.6 1.3 1.3z" fill={INK} />
        </>
    ),
    "question-mark": (
        <>
            <circle cx="8" cy="8" r="6.5" fill="#f0883e" stroke="#b45f1f" />
            <path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3v.4" stroke={PAPER} strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="8" cy="11.8" r="0.9" fill={PAPER} />
        </>
    ),
    "reviewer-comments": (
        <path
            d="M8 1.2l2 4.2 4.6.6-3.4 3.2.9 4.6L8 11.5l-4.1 2.3.9-4.6L1.4 6l4.6-.6z"
            fill="#f5c842"
            stroke="#b8901c"
            strokeLinejoin="round"
        />
    ),
    scissors: (
        <>
            <circle cx="4" cy="11.5" r="2.2" fill="none" stroke="#e5534b" strokeWidth="1.3" />
            <circle cx="12" cy="11.5" r="2.2" fill="none" stroke="#e5534b" strokeWidth="1.3" />
            <path d="M5.6 10L11.5 1.5M10.4 10L4.5 1.5" stroke="#5f6368" strokeWidth="1.3" strokeLinecap="round" />
        </>
    ),
    "speech-bubble": (
        <path d="M2 3.5C2 2.7 2.7 2 3.5 2h9c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H7l-3.5 3v-3h0C2.7 11 2 10.3 2 9.5z" fill="#f5d94a" stroke="#b8901c" strokeLinejoin="round" />
    ),
    "speech-marks": (
        <>
            <circle cx="4.5" cy="6" r="2.3" fill={INK} />
            <path d="M6.7 6c0 2.5-1.5 4.3-3.7 5.2" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <circle cx="11" cy="6" r="2.3" fill={INK} />
            <path d="M13.2 6c0 2.5-1.5 4.3-3.7 5.2" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </>
    ),
    statistics: (
        <>
            <rect x="2" y="9" width="2.8" height="5.5" fill="#f0883e" />
            <rect x="6.6" y="5.5" width="2.8" height="9" fill="#f5c842" />
            <rect x="11.2" y="2" width="2.8" height="12.5" fill="#57ab5a" />
            <path d="M1.5 14.5h13" stroke={LINE} />
        </>
    ),
    "sync-folder": (
        <>
            <path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#f0a64b" stroke="#b45f1f" strokeLinejoin="round" />
            <path d="M5.5 9.5a2.5 2.5 0 0 1 4.6-1.2M10.5 9.5a2.5 2.5 0 0 1-4.6 1.2" stroke={PAPER} strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <path d="M10.4 6.8v1.7H8.7M5.6 12.2v-1.7h1.7" stroke={PAPER} strokeWidth="1" fill="none" strokeLinecap="round" />
        </>
    ),
    tables: (
        <>
            <rect x="1.5" y="2.5" width="13" height="11" rx="0.6" fill={PAPER} stroke="#4a90d9" />
            <path d="M1.5 2.5h13v2.8h-13z" fill="#4a90d9" />
            <path d="M1.5 8.4h13M1.5 11h13M5.8 5.3v8.2M10.2 5.3v8.2" stroke="#4a90d9" strokeWidth="0.8" />
        </>
    ),
    "test-tube": (
        <>
            <path d="M6 1.5h4M6.8 1.5v10.3a1.2 1.2 0 0 0 2.4 0V1.5" stroke={LINE} fill={PAPER} strokeLinejoin="round" />
            <path d="M6.8 7.5h2.4v4.3a1.2 1.2 0 0 1-2.4 0z" fill="#9b6bd3" />
        </>
    ),
    "thought-bubble": (
        <>
            <ellipse cx="8.5" cy="6.5" rx="6" ry="4.5" fill={PAPER} stroke={LINE} />
            <circle cx="4" cy="12" r="1.3" fill={PAPER} stroke={LINE} />
            <circle cx="2.2" cy="14.3" r="0.8" fill={PAPER} stroke={LINE} />
        </>
    ),
    warning: (
        <>
            <path d="M8 1.5l6.8 12.5H1.2z" fill="#f5c842" stroke="#b8901c" strokeLinejoin="round" />
            <path d="M8 5.8v4" stroke="#3c3c3c" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="11.9" r="0.9" fill="#3c3c3c" />
        </>
    ),
};

const FAMILIES: Record<string, (c: Swatch) => ReactNode> = {
    book,
    "way-station": wayStation,
    flag,
    notes: notepad,
};

// ---------------------------------------------------------------------------
// Menu catalogue
// ---------------------------------------------------------------------------

export interface IconChoice {
    id: string;
    label: string;
}

export interface IconGroup {
    label: string;
    items: IconChoice[];
}

const colorChoices = (family: string): IconChoice[] =>
    COLORS.map((c) => ({ id: `${family}:${c.id}`, label: c.label }));

/** Submenus of the "Change Icon" menu, in display order. */
export const ICON_GROUPS: IconGroup[] = [
    { label: "Book", items: colorChoices("book") },
    {
        label: "Characters",
        items: [
            { id: "character:sheet", label: "Character Sheet" },
            { id: "character:mask", label: "Mask" },
            { id: "character:photo", label: "Photo" },
        ],
    },
    { label: "Flag", items: colorChoices("flag") },
    {
        label: "Locations",
        items: [
            { id: "location:sheet", label: "Location Sheet" },
            { id: "location:map", label: "Map" },
        ],
    },
    { label: "Notes", items: colorChoices("notes") },
    {
        label: "To Do",
        items: [
            { id: "todo:ticked", label: "Ticked" },
            { id: "todo:unticked", label: "Unticked" },
        ],
    },
    { label: "Way-Station", items: colorChoices("way-station") },
];

/** Single icons listed after the submenus, alphabetically. */
export const ICON_SINGLES: IconChoice[] = [
    { id: "back-matter", label: "Back Matter" },
    { id: "blackboard", label: "Blackboard" },
    { id: "calendar", label: "Calendar" },
    { id: "clapper-board", label: "Clapper Board" },
    { id: "clock", label: "Clock" },
    { id: "cog", label: "Cog" },
    { id: "eye", label: "Eye" },
    { id: "figures-graphs", label: "Figures and Graphs" },
    { id: "filing-cabinet", label: "Filing Cabinet" },
    { id: "front-matter", label: "Front Matter" },
    { id: "information", label: "Information" },
    { id: "lectern", label: "Lectern" },
    { id: "light-bulb", label: "Light Bulb" },
    { id: "magnifying-glass", label: "Magnifying Glass" },
    { id: "music", label: "Music" },
    { id: "musical-notes", label: "Musical Notes" },
    { id: "outline", label: "Outline" },
    { id: "pencil", label: "Pencil" },
    { id: "question-mark", label: "Question Mark" },
    { id: "reviewer-comments", label: "Reviewer Comments" },
    { id: "scissors", label: "Scissors" },
    { id: "speech-bubble", label: "Speech Bubble" },
    { id: "speech-marks", label: "Speech Marks" },
    { id: "statistics", label: "Statistics" },
    { id: "sync-folder", label: "Sync Folder" },
    { id: "tables", label: "Tables" },
    { id: "test-tube", label: "Test Tube" },
    { id: "thought-bubble", label: "Thought Bubble" },
    { id: "tv", label: "TV" },
    { id: "warning", label: "Warning" },
];

/** Icon shown next to a group name in the menu (its first variant). */
export const groupIconId = (g: IconGroup): string => g.items[0].id;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawing(id: string): ReactNode | null {
    if (SINGLES[id]) return SINGLES[id];
    const [family, variant] = id.split(":");
    const c = variant ? color(variant) : undefined;
    return family in FAMILIES && c ? FAMILIES[family](c) : null;
}

/** True when `id` names an icon this catalogue can draw. */
export function isKnownIcon(id: string | null | undefined): boolean {
    return !!id && drawing(id) !== null;
}

export function DocIcon({
    id,
    size = 16,
    className,
    style,
}: {
    id: string;
    size?: number;
    className?: string;
    style?: CSSProperties;
}) {
    const art = drawing(id);
    if (!art) return null;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            className={className}
            style={style}
            aria-hidden="true"
        >
            {art}
        </svg>
    );
}
