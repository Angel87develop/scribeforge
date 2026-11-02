// Check that every interface string has a Spanish translation.
//
// Collects the English keys the app can show:
// - literal arguments of t() and tn() in src/;
// - English data drawn through t(variable): menu, tab, column and icon
//   labels, sheet fields, compile formats... (DATA_FILES below);
// - text that arrives from Rust and is translated in the interface:
//   template catalogue, format profiles and compile presets (RUST_FILES).
// Then compares them with the keys of src/i18n/es.ts.
//
// Usage: node tools/check-i18n.cjs            report missing and unused keys
//        node tools/check-i18n.cjs --keys     print every key, one JSON string per line
// Exits with 1 when a translation is missing.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

/** Files whose English data is drawn with t(x.label) and similar. */
const DATA_FILES = {
    "src/components/Workspace.tsx": ["label"],
    "src/components/DocIcons.tsx": ["label"],
    "src/components/Outliner.tsx": ["label"],
    "src/components/sheetTemplates.ts": ["*array"],
    "src/components/binderTree.ts": ["*record"],
    "src/components/EditorPane.tsx": ["*record"],
    "src/dialogs/PreferencesDialog.tsx": ["label"],
    "src/dialogs/CompileDialog.tsx": ["label"],
    "src/dialogs/SpellingDialog.tsx": ["label"],
    "src/dialogs/FindReplaceDialog.tsx": ["*record"],
    "src/components/ParagraphFormatDialog.tsx": ["label", "*tuple"],
};

/** Rust sources whose display strings the interface translates. */
const RUST_FILES = [
    { file: "src-tauri/src/templates/catalog.rs", fields: ["label", "name", "description", "preview"] },
    { file: "src-tauri/src/compile/mod.rs", fields: ["label", "description"] },
    { file: "src-tauri/src/format_profiles.rs", entries: true },
];

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name) && !p.endsWith(`${path.sep}i18n${path.sep}es.ts`)) out.push(p);
    }
    return out;
}

function isText(s) {
    return /[A-Za-z]{2,}/.test(s) && !/^[a-z0-9_:\-./]+$/.test(s) && !/^#[0-9a-f]+$/i.test(s);
}

const keys = new Map(); // key -> first location
function add(key, where) {
    if (!keys.has(key)) keys.set(key, where);
}

for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const data = DATA_FILES[rel] ?? [];
    const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const fn = node.expression.text;
            const args = node.arguments;
            const lit = (a) => a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
            const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
            if (fn === "t" && lit(args[0]) !== null) add(lit(args[0]), where);
            if (fn === "tn") {
                if (lit(args[1]) !== null) add(lit(args[1]), where);
                if (lit(args[2]) !== null) add(lit(args[2]), where);
            }
        }
        if (data.length && ts.isStringLiteral(node) && isText(node.text)) {
            const p = node.parent;
            const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
            if (ts.isPropertyAssignment(p) && p.initializer === node && data.includes(p.name.getText())) add(node.text, where);
            if (ts.isConditionalExpression(p) && ts.isPropertyAssignment(p.parent) && data.includes(p.parent.name.getText())) add(node.text, where);
            if (ts.isArrayLiteralExpression(p) && data.includes("*array")) add(node.text, where);
            if (ts.isPropertyAssignment(p) && data.includes("*record")) add(node.text, where);
            if (ts.isArrayLiteralExpression(p) && data.includes("*tuple") && p.elements[0] === node) add(node.text, where);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}

function rustString(raw) {
    // Join "a \<newline> b" continuations and unescape.
    return raw.replace(/\\\r?\n\s*/g, "").replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

for (const { file, fields, entries } of RUST_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (fields) {
        const re = new RegExp(`\\b(${fields.join("|")}):\\s*"((?:[^"\\\\]|\\\\.|\\\\\\r?\\n)*)"`, "g");
        for (const m of src.matchAll(re)) {
            const s = rustString(m[2]);
            if (isText(s)) add(s, file);
        }
    }
    if (entries) {
        // entry("id", "Name", "Description", ...)
        const re = /entry\(\s*"[^"]*",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g;
        for (const m of src.matchAll(re)) {
            add(rustString(m[1]), file);
            add(rustString(m[2]), file);
        }
    }
}
// Built by the Rust command around the active profile's name.
add("Writing Format: {name}", "src/dialogs/CompileDialog.tsx");

if (process.argv.includes("--keys")) {
    for (const k of [...keys.keys()].sort()) console.log(JSON.stringify(k));
    process.exit(0);
}

const esSrc = fs.readFileSync(path.join(SRC, "i18n", "es.ts"), "utf8");
const esFile = ts.createSourceFile("es.ts", esSrc, ts.ScriptTarget.Latest, true);
const translated = new Set();
const visitEs = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name))) translated.add(node.name.text);
    ts.forEachChild(node, visitEs);
};
visitEs(esFile);

const missing = [...keys.keys()].filter((k) => !translated.has(k)).sort();
const unused = [...translated].filter((k) => !keys.has(k)).sort();
for (const k of missing) console.log(`missing  ${JSON.stringify(k)}  (${keys.get(k)})`);
for (const k of unused) console.log(`unused   ${JSON.stringify(k)}`);
console.log(`${keys.size} keys, ${translated.size} translated, ${missing.length} missing, ${unused.length} unused`);
process.exit(missing.length ? 1 : 0);
