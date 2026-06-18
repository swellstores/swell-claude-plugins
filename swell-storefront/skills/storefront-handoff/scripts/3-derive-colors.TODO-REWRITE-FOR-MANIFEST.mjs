#!/usr/bin/env node
/**
 * Stage 3 / derive-colors.
 *
 * Reads:
 *   <sprite>/app/analysis/extraction/pages/<id>.json    — section_candidates with colored_elements
 *   <sprite>/app/analysis/extraction/meta.json          — dark_mode flag
 *   <sprite>/app/analysis/colors-roles/<id>.json        — agent kind mapping (per candidate)
 *
 * Algorithm:
 *   1. Group sections into schemes by primary signature (reserved kinds).
 *      Reserved kinds: section / text / primary_button / secondary_button.
 *   2. Promote `secondary_button` (background) to a standard role if filled
 *      secondary buttons exist in ≥50% of secondary-bearing sections.
 *   3. Detect cross-cutting roles per prop (border-color, box-shadow):
 *      A prop becomes a role iff its dominant value covers ≥50% of non-reserved
 *      uses AND spans ≥3 distinct kinds AND ≥3 distinct sections.
 *   4. Per-scheme value for a cross-cutting role = dominant value within that
 *      scheme's sections.
 *   5. Everything else → decorations (per-section, for future block-schema work).
 *
 * Outputs:
 *   <sprite>/app/frontend/src/settings/schema.json
 *   <sprite>/app/frontend/theme/settings/settings.json
 *   <sprite>/app/frontend/tailwind.config.js
 *   <sprite>/app/analysis/colors/decorations.json
 *
 * Usage:
 *   node 3-derive-colors.mjs --sprite <sprite-path>
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

const STANDARD_BASE_ROLES = [
  { id: "background", label: "Background" },
  { id: "text", label: "Text" },
  { id: "button", label: "Primary button background" },
  { id: "button_label", label: "Primary button label" },
  { id: "secondary_button_label", label: "Secondary button label" },
];

const SECONDARY_BUTTON_BG_ROLE = {
  id: "secondary_button",
  label: "Secondary button background",
};

const CROSS_CUTTING_PROPS = {
  "border-color": { id: "border", label: "Border" },
  "box-shadow": { id: "shadow", label: "Shadow" },
};

const RESERVED_KINDS = new Set(["section", "text", "primary_button", "secondary_button"]);

const CROSS_CUTTING_THRESHOLDS = {
  dominantShare: 0.5,
  minDistinctKinds: 3,
  minDistinctSections: 3,
};

// Composite paint props carry a color + non-color tokens (offsets, blur, gradient
// stops). For role detection we look at the color part only; for storage in the
// scheme the value is the bare hex so block CSS can recompose: e.g.
// `box-shadow: 6px 6px 0 var(--shadow)`.
const COMPOSITE_COLOR_PROPS = new Set(["box-shadow", "text-shadow"]);

function extractColor(prop, value) {
  if (!value) return null;
  if (!COMPOSITE_COLOR_PROPS.has(prop)) return value;
  const m = value.match(/#[0-9a-fA-F]{6,8}\b/);
  return m ? m[0] : null;
}

const COLOR_PROPS = new Set([
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "background-image",
]);

const STANDARD_TAILWIND_IDS = new Set([
  "background",
  "text",
  "button",
  "button_label",
  "secondary_button_label",
]);

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let sprite = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sprite") sprite = args[++i];
  }
  if (!sprite) {
    console.error("Usage: 3-derive-colors.mjs --sprite <sprite-path>");
    process.exit(1);
  }
  return { sprite: resolve(sprite) };
}

// ── Inventory loading ───────────────────────────────────────────────────────

async function loadInventory(sprite) {
  const extractionDir = join(sprite, "app", "analysis", "extraction");
  const pagesDir = join(extractionDir, "pages");
  const rolesDir = join(sprite, "app", "analysis", "colors-roles");

  if (!existsSync(extractionDir)) {
    throw new Error(`Missing ${extractionDir}. Run Stage 2 first.`);
  }
  if (!existsSync(rolesDir)) {
    throw new Error(
      `Missing ${rolesDir}. The Stage 3 agent must classify elements before this script runs.`,
    );
  }

  const meta = JSON.parse(await readFile(join(extractionDir, "meta.json"), "utf8"));
  const darkMode = !!meta.dark_mode;

  const sections = [];
  const pageFiles = (await readdir(pagesDir)).filter((f) => f.endsWith(".json")).sort();
  for (const file of pageFiles) {
    const pageId = file.replace(/\.json$/, "");
    const pageData = JSON.parse(await readFile(join(pagesDir, file), "utf8"));
    const rolesPath = join(rolesDir, `${pageId}.json`);
    if (!existsSync(rolesPath)) {
      console.warn(`WARN: missing colors-roles/${pageId}.json — skipping page`);
      continue;
    }
    const rolesData = JSON.parse(await readFile(rolesPath, "utf8"));

    for (const candidate of pageData.section_candidates ?? []) {
      const candidateMap = rolesData[candidate.candidate_id] ?? {};
      const taggedElements = [];
      for (let i = 0; i < (candidate.colored_elements ?? []).length; i++) {
        const n = i + 1;
        const kind = candidateMap[String(n)];
        if (!kind || kind === "skip") continue;
        taggedElements.push({ n, kind, element: candidate.colored_elements[i] });
      }
      sections.push({
        pageId,
        sectionKey: `${pageId}/${candidate.candidate_id}`,
        candidate,
        taggedElements,
      });
    }
  }
  return { darkMode, sections };
}

function findFirstByKind(section, targetKind) {
  return section.taggedElements.find((t) => t.kind === targetKind) ?? null;
}

// ── Scheme grouping (primary signature on reserved kinds) ──────────────────

function detectFilledSecondary(sections) {
  let withBg = 0;
  let total = 0;
  for (const s of sections) {
    const sec = findFirstByKind(s, "secondary_button");
    if (!sec) continue;
    total++;
    if (sec.element.properties["background-color"]) withBg++;
  }
  return total > 0 && withBg / total >= 0.5;
}

function primarySignature(section, hasFilledSecondary) {
  const sectionEl = findFirstByKind(section, "section");
  const textEl = findFirstByKind(section, "text");
  const primEl = findFirstByKind(section, "primary_button");
  const secEl = findFirstByKind(section, "secondary_button");
  const surface = section.candidate.themes ?? { light: {}, dark: {} };

  const sig = {
    background:
      sectionEl?.element.properties["background-color"] ??
      surface.light?.background_color ??
      null,
    background_dark:
      sectionEl?.element.properties["background-color-dark"] ??
      surface.dark?.background_color ??
      null,
    text:
      textEl?.element.properties.color ??
      sectionEl?.element.properties.color ??
      surface.light?.color ??
      null,
    text_dark:
      textEl?.element.properties["color-dark"] ??
      sectionEl?.element.properties["color-dark"] ??
      surface.dark?.color ??
      null,
    button: primEl?.element.properties["background-color"] ?? null,
    button_dark: primEl?.element.properties["background-color-dark"] ?? null,
    button_label: primEl?.element.properties.color ?? null,
    button_label_dark: primEl?.element.properties["color-dark"] ?? null,
    secondary_button_label: secEl?.element.properties.color ?? null,
    secondary_button_label_dark: secEl?.element.properties["color-dark"] ?? null,
  };
  if (hasFilledSecondary) {
    sig.secondary_button = secEl?.element.properties["background-color"] ?? null;
    sig.secondary_button_dark = secEl?.element.properties["background-color-dark"] ?? null;
  }
  return sig;
}

function compatibleSig(a, b, keys) {
  for (const k of keys) {
    if (a[k] != null && b[k] != null && a[k] !== b[k]) return false;
  }
  return true;
}

function mergeSig(target, src, keys) {
  for (const k of keys) {
    if (target[k] == null && src[k] != null) target[k] = src[k];
  }
}

function groupSchemes(sections, darkMode, hasFilledSecondary) {
  const baseKeys = ["background", "text", "button", "button_label", "secondary_button_label"];
  if (hasFilledSecondary) baseKeys.push("secondary_button");
  const sigKeys = darkMode ? baseKeys.flatMap((k) => [k, `${k}_dark`]) : baseKeys;

  const sigs = sections.map((s) => primarySignature(s, hasFilledSecondary));
  const schemes = [];
  for (let i = 0; i < sections.length; i++) {
    const sig = sigs[i];
    const target = schemes.find((s) => compatibleSig(s.values, sig, sigKeys));
    if (target) {
      target.sections.push(sections[i].sectionKey);
      target.sectionRefs.push(sections[i]);
      mergeSig(target.values, sig, sigKeys);
    } else {
      schemes.push({
        values: { ...sig },
        sections: [sections[i].sectionKey],
        sectionRefs: [sections[i]],
      });
    }
  }

  // Second pass: collapse schemes that share (background, text).
  const merged = [];
  for (const s of schemes) {
    const target = merged.find(
      (m) =>
        m.values.background === s.values.background &&
        m.values.text === s.values.text,
    );
    if (target) {
      target.sections.push(...s.sections);
      target.sectionRefs.push(...s.sectionRefs);
      mergeSig(target.values, s.values, sigKeys);
    } else {
      merged.push(s);
    }
  }

  merged.forEach((s, i) => (s.name = `scheme-${i + 1}`));
  return merged;
}

function schemeNameForSection(schemes, sectionKey) {
  const s = schemes.find((s) => s.sections.includes(sectionKey));
  return s?.name ?? null;
}

// ── Cross-cutting detection ─────────────────────────────────────────────────

function detectCrossCutting(sections, schemes) {
  const result = {};
  // Marks (sectionKey|kind|n|prop) used by a cross-cutting role; everything
  // else flows to decorations.
  const claimedKeys = new Set();

  for (const [prop, info] of Object.entries(CROSS_CUTTING_PROPS)) {
    const usages = [];
    for (const s of sections) {
      for (const tagged of s.taggedElements) {
        if (RESERVED_KINDS.has(tagged.kind)) continue;
        const rawLight = tagged.element.properties[prop];
        if (!rawLight) continue;
        const rawDark = tagged.element.properties[`${prop}-dark`] ?? null;
        const lightColor = extractColor(prop, rawLight);
        const darkColor = extractColor(prop, rawDark);
        if (!lightColor) continue;
        usages.push({
          sectionKey: s.sectionKey,
          schemeName: schemeNameForSection(schemes, s.sectionKey),
          kind: tagged.kind,
          n: tagged.n,
          light: lightColor,
          dark: darkColor,
        });
      }
    }
    if (usages.length === 0) continue;

    const valueCounts = new Map();
    const valueKinds = new Map();
    const valueSections = new Map();
    for (const u of usages) {
      valueCounts.set(u.light, (valueCounts.get(u.light) ?? 0) + 1);
      if (!valueKinds.has(u.light)) valueKinds.set(u.light, new Set());
      valueKinds.get(u.light).add(u.kind);
      if (!valueSections.has(u.light)) valueSections.set(u.light, new Set());
      valueSections.get(u.light).add(u.sectionKey);
    }
    let bestVal = null;
    let bestCount = 0;
    for (const [v, c] of valueCounts) {
      if (c > bestCount) {
        bestVal = v;
        bestCount = c;
      }
    }
    const share = bestCount / usages.length;
    const distinctKinds = valueKinds.get(bestVal).size;
    const distinctSections = valueSections.get(bestVal).size;
    if (
      share < CROSS_CUTTING_THRESHOLDS.dominantShare ||
      distinctKinds < CROSS_CUTTING_THRESHOLDS.minDistinctKinds ||
      distinctSections < CROSS_CUTTING_THRESHOLDS.minDistinctSections
    ) {
      continue;
    }

    const schemeValues = {};
    for (const scheme of schemes) {
      const schemeUsages = usages.filter((u) => u.schemeName === scheme.name);
      if (schemeUsages.length === 0) {
        schemeValues[scheme.name] = { light: null, dark: null };
        continue;
      }
      const counts = new Map();
      for (const u of schemeUsages) {
        const k = `${u.light}|${u.dark ?? ""}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let domKey = null;
      let domCnt = 0;
      for (const [k, c] of counts) {
        if (c > domCnt) {
          domKey = k;
          domCnt = c;
        }
      }
      const [light, dark] = domKey.split("|");
      schemeValues[scheme.name] = { light, dark: dark || null };
    }

    result[info.id] = { ...info, prop, schemeValues };

    for (const u of usages) {
      if (u.light === bestVal) {
        claimedKeys.add(`${u.sectionKey}|${u.kind}|${u.n}|${prop}`);
      }
    }
  }

  return { roles: result, claimedKeys };
}

// ── Build outputs ───────────────────────────────────────────────────────────

function buildAllRoles(hasFilledSecondary, crossCuttingRoles) {
  const roles = [...STANDARD_BASE_ROLES];
  if (hasFilledSecondary) roles.splice(4, 0, SECONDARY_BUTTON_BG_ROLE);
  for (const r of Object.values(crossCuttingRoles)) {
    roles.push({ id: r.id, label: r.label });
  }
  return roles;
}

function buildSchemeSettings(schemes, allRoles, crossCuttingRoles, darkMode) {
  const out = {};
  for (const s of schemes) {
    const settings = {};
    for (const r of allRoles) {
      const cc = crossCuttingRoles[r.id];
      const lightVal = cc
        ? cc.schemeValues[s.name]?.light ?? null
        : s.values[r.id] ?? null;
      const darkVal = cc
        ? cc.schemeValues[s.name]?.dark ?? null
        : s.values[`${r.id}_dark`] ?? null;
      settings[r.id] = lightVal;
      if (darkMode) settings[`${r.id}_dark`] = darkVal;
    }
    out[s.name] = { settings };
  }
  return out;
}

function fillNullsWithFallbacks(schemeSettings) {
  const schemeNames = Object.keys(schemeSettings);
  if (schemeNames.length === 0) return [];
  const allKeys = new Set(
    schemeNames.flatMap((n) => Object.keys(schemeSettings[n].settings)),
  );
  const warnings = [];
  for (const name of schemeNames) {
    const s = schemeSettings[name].settings;
    for (const k of allKeys) {
      if (s[k] != null) continue;
      const counts = new Map();
      for (const otherName of schemeNames) {
        if (otherName === name) continue;
        const v = schemeSettings[otherName].settings[k];
        if (v == null) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      let best = null;
      let bestCount = -1;
      for (const [v, c] of counts) {
        if (c > bestCount) {
          best = v;
          bestCount = c;
        }
      }
      if (best != null) {
        s[k] = best;
        continue;
      }
      const isDark = k.endsWith("_dark");
      const fb =
        s[isDark ? "text_dark" : "text"] ??
        s[isDark ? "background_dark" : "background"] ??
        "#000000";
      s[k] = fb;
      warnings.push(`${name}.${k} → fallback ${fb}`);
    }
  }
  return warnings;
}

function buildDefinition(allRoles, darkMode, schemeOneSettings) {
  const def = [];
  const writeRole = (id, label) => {
    const entry = { type: "color", id, label };
    const defaultVal = schemeOneSettings[id];
    if (defaultVal != null) entry.default = defaultVal;
    def.push(entry);
  };
  if (darkMode) def.push({ type: "header", content: "Light Theme" });
  for (const r of allRoles) writeRole(r.id, r.label);
  if (darkMode) {
    def.push({ type: "header", content: "Dark Theme" });
    for (const r of allRoles) writeRole(`${r.id}_dark`, r.label);
  }
  return def;
}

async function writeSchemaJson(schemaPath, definition) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  for (const sec of schema) {
    for (const setting of sec.settings ?? []) {
      if (setting.type === "color_scheme_group" && setting.id === "color_schemes") {
        setting.definition = definition;
      }
    }
  }
  await writeFile(schemaPath, JSON.stringify(schema, null, 2) + "\n");
}

async function writeSettingsJson(settingsPath, schemeSettings, cartScheme) {
  let settings = { current: {} };
  if (existsSync(settingsPath)) {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
    if (!settings.current) settings.current = {};
  }
  settings.current.color_schemes = schemeSettings;
  settings.current.cart_color_scheme = cartScheme;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

async function writeTailwindConfig(tailwindPath, allRoles) {
  if (!existsSync(tailwindPath)) {
    console.warn(`WARN: ${tailwindPath} not found — skipping tailwind update`);
    return;
  }
  const cssName = (id) => id.replace(/_/g, "-");
  const lines = [];
  for (const r of allRoles) {
    if (STANDARD_TAILWIND_IDS.has(r.id)) continue;
    lines.push(`        "${cssName(r.id)}": "var(--${cssName(r.id)})",`);
  }
  const newEntries = lines.join("\n");
  const tw = await readFile(tailwindPath, "utf8");
  const marker = "// Map each to its CSS variable: <role>: 'var(--<role>)'";
  const pattern = new RegExp(
    `(${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\n(?:\\s*['"][\\w-]+['"]\\s*:\\s*['"][^'"]+['"],\\s*\\n)*(\\s*},\\n)`,
  );
  if (!pattern.test(tw)) {
    console.warn(`WARN: tailwind.config.js marker not found — skipping`);
    return;
  }
  const insert = newEntries ? newEntries + "\n" : "";
  const replaced = tw.replace(pattern, `$1\n${insert}$2`);
  await writeFile(tailwindPath, replaced);
}

async function writeDecorationsJson(path, sections, claimedKeys) {
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  const bySection = new Map();
  for (const s of sections) {
    for (const tagged of s.taggedElements) {
      if (RESERVED_KINDS.has(tagged.kind)) continue;
      const props = tagged.element.properties;
      for (const prop of Object.keys(props)) {
        if (prop.endsWith("-dark")) continue;
        if (!COLOR_PROPS.has(prop)) continue;
        const claimKey = `${s.sectionKey}|${tagged.kind}|${tagged.n}|${prop}`;
        if (claimedKeys.has(claimKey)) continue;
        const arr = bySection.get(s.sectionKey) ?? [];
        arr.push({
          kind: tagged.kind,
          n: tagged.n,
          tag: tagged.element.tag,
          classes: tagged.element.classes,
          text_excerpt: tagged.element.text_excerpt,
          prop,
          light: props[prop],
          dark: props[`${prop}-dark`] ?? null,
        });
        bySection.set(s.sectionKey, arr);
      }
    }
  }
  const out = {
    generated_at: new Date().toISOString(),
    sections: Object.fromEntries(bySection),
  };
  await writeFile(path, JSON.stringify(out, null, 2) + "\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { sprite } = parseArgs();
  console.log(`── deriving color schemes ──`);

  const { darkMode, sections } = await loadInventory(sprite);
  if (sections.length === 0) {
    console.warn("No sections found, nothing to do.");
    return;
  }

  const hasFilledSecondary = detectFilledSecondary(sections);
  const schemes = groupSchemes(sections, darkMode, hasFilledSecondary);
  const { roles: crossCuttingRoles, claimedKeys } = detectCrossCutting(
    sections,
    schemes,
  );
  const allRoles = buildAllRoles(hasFilledSecondary, crossCuttingRoles);

  const schemeSettings = buildSchemeSettings(
    schemes,
    allRoles,
    crossCuttingRoles,
    darkMode,
  );
  const fallbackWarnings = fillNullsWithFallbacks(schemeSettings);

  const definition = buildDefinition(
    allRoles,
    darkMode,
    schemeSettings["scheme-1"]?.settings ?? {},
  );

  const schemaPath = join(sprite, "app", "frontend", "src", "settings", "schema.json");
  const settingsPath = join(
    sprite,
    "app",
    "frontend",
    "theme",
    "settings",
    "settings.json",
  );
  const tailwindPath = join(sprite, "app", "frontend", "tailwind.config.js");
  const decorationsPath = join(
    sprite,
    "app",
    "analysis",
    "colors",
    "decorations.json",
  );

  if (!existsSync(schemaPath)) {
    throw new Error(`Missing ${schemaPath}`);
  }

  await writeSchemaJson(schemaPath, definition);
  await writeSettingsJson(settingsPath, schemeSettings, "scheme-1");
  await writeTailwindConfig(tailwindPath, allRoles);
  await writeDecorationsJson(decorationsPath, sections, claimedKeys);

  for (const w of fallbackWarnings) console.warn(`WARN: ${w}`);
  console.log(
    `Filled secondary: ${hasFilledSecondary ? "yes" : "no"} | Cross-cutting: ${Object.keys(crossCuttingRoles).join(", ") || "none"}`,
  );
  console.log(
    `Schemes: ${schemes.length} | Roles per theme: ${allRoles.length} | Total entries: ${allRoles.length * (darkMode ? 2 : 1)}`,
  );
  for (const s of schemes) console.log(`  ${s.name}: ${s.sections.length} sections`);
  console.log(`\n✅ Stage 3 complete`);
}

main().catch((err) => {
  console.error("Stage 3 failed:", err);
  process.exit(1);
});
