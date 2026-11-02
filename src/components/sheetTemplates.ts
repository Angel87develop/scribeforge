/// Starting fields for character and place sheets, and helpers that create
/// a sheet document or add a sheet to an existing one.
///
/// Field names and the new document's title are written in the interface
/// language at the moment the sheet is created; after that they are the
/// user's text. The label stays in English because it must match the label
/// defined in the project.

import { api, type DocumentMetaDto, type Sheet } from "../services/api";
import { t } from "../i18n";

export type SheetKind = "character" | "place";

const FIELDS: Record<SheetKind, string[]> = {
    character: [
        "Full name",
        "Age",
        "Role in the story",
        "Appearance",
        "Personality",
        "Traits and habits",
        "Wants",
        "Fears",
        "Background",
    ],
    place: ["Type", "Where", "Description", "Atmosphere", "Sounds and smells", "Who goes there", "Why it matters"],
};

export const SHEET_LABELS: Record<SheetKind, string> = { character: "Character", place: "Location" };
export const SHEET_ICONS: Record<SheetKind, string> = { character: "character:sheet", place: "location:sheet" };

export function sheetTemplate(kind: SheetKind): Sheet {
    return { kind, fields: FIELDS[kind].map((label) => ({ label: t(label), value: "" })), relations: [] };
}

/** Give an existing document a sheet (and the matching icon and label). */
export async function addSheet(meta: DocumentMetaDto, kind: SheetKind) {
    await api.updateDocument({
        id: meta.id,
        sheet: sheetTemplate(kind),
        icon: meta.icon || SHEET_ICONS[kind],
        labels: meta.labels[0] ? meta.labels : [SHEET_LABELS[kind], ...meta.labels.slice(1)],
    });
}

/** Create a new sheet document under `parent`. Returns its id. */
export async function createSheet(binder: DocumentMetaDto[], parent: string, kind: SheetKind): Promise<string> {
    const p = binder.find((d) => d.id === parent);
    const inResearch = p?.kind === "research_root" || p?.kind === "research" || isUnderResearch(binder, parent);
    const title = kind === "character" ? t("New Character") : t("New Place");
    const meta = await api.createDocument(parent, inResearch ? "research" : "document", title);
    await addSheet(meta, kind);
    return meta.id;
}

function isUnderResearch(binder: DocumentMetaDto[], id: string): boolean {
    const byId = new Map(binder.map((d) => [d.id, d]));
    let cur = byId.get(id);
    while (cur) {
        if (cur.kind === "research_root") return true;
        cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return false;
}
