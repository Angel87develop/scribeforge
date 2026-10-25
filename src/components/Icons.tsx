/// Inline SVG icons for ScribeForge.
///
/// Each icon is a small React component rendering a 16x16 (or 24x24) SVG with
/// `currentColor` strokes/fills so they inherit text colour. No external icon
/// library is used, keeping the bundle small and the iconography uniform.

import type { CSSProperties } from "react";

interface IconProps {
    size?: number;
    className?: string;
    style?: CSSProperties;
}

function svg(size: number, className: string | undefined, style: CSSProperties | undefined, children: React.ReactNode) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            style={style}
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export function IconDocument({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6M9 17h6" />
        </>
    ));
}

export function IconFolder({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    ));
}

export function IconFolderOpen({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z" />
            <path d="M3 9h18l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </>
    ));
}

export function IconBook({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
            <path d="M4 5v14" />
            <path d="M8 7h6M8 11h6" />
        </>
    ));
}

export function IconPen({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </>
    ));
}

export function IconOpen({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
            <path d="M3 9h18l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </>
    ));
}

export function IconClock({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </>
    ));
}

export function IconClose({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
        </>
    ));
}

export function IconSettings({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>
    ));
}

export function IconSearch({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
        </>
    ));
}

export function IconSave({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
        </>
    ));
}

export function IconTrash({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M10 11v6M14 11v6" />
        </>
    ));
}

export function IconChevronRight({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, <path d="M9 6l6 6-6 6" />);
}

export function IconChevronDown({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, <path d="M6 9l6 6 6-6" />);
}

export function IconPlus({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M12 5v14M5 12h14" />
        </>
    ));
}

export function IconTarget({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1" />
        </>
    ));
}

export function IconList({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M8 6h13M8 12h13M8 18h13" />
            <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </>
    ));
}

export function IconCards({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <rect x="3" y="4" width="7" height="9" rx="1" />
            <rect x="14" y="4" width="7" height="9" rx="1" />
            <rect x="3" y="15" width="7" height="5" rx="1" />
            <rect x="14" y="15" width="7" height="5" rx="1" />
        </>
    ));
}

export function IconExport({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M12 3v12" />
            <path d="M7 8l5-5 5 5" />
            <path d="M5 21h14" />
        </>
    ));
}

export function IconRefresh({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </>
    ));
}

export function IconFolderTree({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 13h6M9 17h4" />
        </>
    ));
}

export function IconBold({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <path d="M7 4h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z" />
    ));
}

export function IconItalic({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M14 4h-4M10 20H6M14.5 4L9.5 20" />
        </>
    ));
}

export function IconUnderline({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M7 4v7a5 5 0 0 0 10 0V4" />
            <path d="M5 20h14" />
        </>
    ));
}

export function IconStrike({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M16 7c-.5-2-2-3-4-3-2.5 0-4 1.5-4 3.5 0 1.5 1 2.5 3 3.5M8 17c.5 2 2 3 4 3 2.5 0 4-1.5 4-3.5 0-.8-.3-1.5-.9-2.1" />
            <path d="M4 12h16" />
        </>
    ));
}

export function IconAlignLeft({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 6h16M4 12h10M4 18h14" />
        </>
    ));
}

export function IconAlignCenter({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 6h16M7 12h10M6 18h12" />
        </>
    ));
}

export function IconAlignRight({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 6h16M10 12h10M6 18h14" />
        </>
    ));
}

export function IconAlignJustify({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 6h16M4 12h16M4 18h16" />
        </>
    ));
}

export function IconListOrdered({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M10 6h11M10 12h11M10 18h11" />
            <path d="M4 6l1.5-1v4M4 14c0-1 2-1 2 0s-2 1-2 2 2 1 2 2" strokeWidth={1.4} />
        </>
    ));
}

export function IconListBullet({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M9 6h12M9 12h12M9 18h12" />
            <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
        </>
    ));
}

export function IconUndo({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 8h9a5 5 0 0 1 0 10H8" />
            <path d="M4 8l4-4M4 8l4 4" />
        </>
    ));
}

export function IconRedo({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M20 8h-9a5 5 0 0 0 0 10h5" />
            <path d="M20 8l-4-4M20 8l-4 4" />
        </>
    ));
}

export function IconScissors({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <path d="M8 8L20 18M8 16L20 6" />
        </>
    ));
}

export function IconCopy({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </>
    ));
}

export function IconPaste({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M9 4h6v3H9z" />
            <path d="M15 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </>
    ));
}

export function IconSidebar({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
        </>
    ));
}

export function IconPanelRight({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
        </>
    ));
}

export function IconMaximize({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
        </>
    ));
}

export function IconText({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M4 6V4h16v2M12 4v16M9 20h6" />
        </>
    ));
}

export function IconLink({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
            <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
        </>
    ));
}

export function IconKeyboard({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
        </>
    ));
}

export function IconInfo({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
        </>
    ));
}

export function IconHelp({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7" />
            <path d="M12 17h.01" />
        </>
    ));
}

export function IconExternal({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M14 3h7v7" />
            <path d="M21 3l-9 9" />
            <path d="M19 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </>
    ));
}

export function IconStar({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <path d="M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9-5.5 2.9 1-6.1L3 9.5l6.3-.9z" />
    ));
}

export function IconImage({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="8.5" cy="9.5" r="1.5" />
            <path d="M21 16l-5-5-9 9" />
        </>
    ));
}

export function IconDownload({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 21h14" />
        </>
    ));
}

export function IconExpand({ size = 16, className, style }: IconProps) {
    return svg(size, className, style, (
        <>
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
        </>
    ));
}
