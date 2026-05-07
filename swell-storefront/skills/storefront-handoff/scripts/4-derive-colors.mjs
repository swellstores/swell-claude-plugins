#!/usr/bin/env node
/**
 * Stage 4 / derive-colors.
 *
 * Reads:
 *   <sprite>/app/analysis/sections.json
 *   <sprite>/app/analysis/blocks.json
 *   <sprite>/app/analysis/color-roles.json   — agent's primary/secondary/branded buckets + cart_section
 *   <sprite>/app/analysis/meta.json          — dark_mode probe
 *
 * Renders each prototype page in headless Chromium (light + dark), pulls
 * computed paint per section root and per non-branded block, then runs the
 * scheme grouping + cross-cutting + decorations algorithm.
 *
 * Outputs:
 *   <sprite>/app/frontend/src/settings/schema.json
 *   <sprite>/app/frontend/theme/settings/settings.json
 *   <sprite>/app/frontend/tailwind.config.js
 *   <sprite>/app/analysis/colors-decorations.json
 *
 * Usage:
 *   node 4-derive-colors.mjs --sprite <sprite-path>
 */

import { chromium } from "playwright";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const VIEWPORT = { width: 1280, height: 900 };

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "uploads",
  "assets",
  "dist",
  "build",
  ".cache",
]);

const STANDARD_ID_ALIASES = {
  index: ["index", "home"],
  products: ["products", "shop", "store", "catalog", "listing"],
  product: ["product"],
};

// ── Config ─────────────────────────────────────────────────────────────────

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

const RESERVED_KINDS = new Set([
  "section",
  "text",
  "primary_button",
  "secondary_button",
]);

const CROSS_CUTTING_THRESHOLDS = {
  dominantShare: 0.5,
  minDistinctKinds: 3,
  minDistinctSections: 3,
};

const COMPOSITE_COLOR_PROPS = new Set(["box-shadow", "text-shadow"]);

const COLOR_PROPS_LIST = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "background-image",
];
const COLOR_PROPS = new Set(COLOR_PROPS_LIST);

const STANDARD_TAILWIND_IDS = new Set([
  "background",
  "text",
  "button",
  "button_label",
  "secondary_button_label",
]);

// ── Color normalization ────────────────────────────────────────────────────

function rgbToHex(s) {
  const m = s.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
  if (!m) return s;
  const r = parseInt(m[1], 10).toString(16).padStart(2, "0").toUpperCase();
  const g = parseInt(m[2], 10).toString(16).padStart(2, "0").toUpperCase();
  const b = parseInt(m[3], 10).toString(16).padStart(2, "0").toUpperCase();
  if (m[4] !== undefined && parseFloat(m[4]) < 1) {
    const a = Math.round(parseFloat(m[4]) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    return `#${r}${g}${b}${a}`;
  }
  return `#${r}${g}${b}`;
}

function normalizePropValue(prop, raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (v === "") return null;
  if (prop === "background-image") {
    if (v === "none") return null;
    return v;
  }
  if (COMPOSITE_COLOR_PROPS.has(prop)) {
    if (v === "none") return null;
    return v.replace(/rgba?\([^)]+\)/g, (m) => rgbToHex(m));
  }
  if (v === "transparent" || v === "rgba(0, 0, 0, 0)") return null;
  if (v.startsWith("#")) return v.toUpperCase();
  if (v.startsWith("rgb")) return rgbToHex(v);
  return v;
}

function extractColor(prop, value) {
  if (!value) return null;
  if (!COMPOSITE_COLOR_PROPS.has(prop)) return value;
  const m = value.match(/#[0-9a-fA-F]{6,8}\b/);
  return m ? m[0].toUpperCase() : null;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let sprite = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sprite") sprite = args[++i];
  }
  if (!sprite) {
    console.error("Usage: 4-derive-colors.mjs --sprite <sprite-path>");
    process.exit(1);
  }
  return { sprite: resolve(sprite) };
}

// ── Prototype root + page-id → file mapping ────────────────────────────────

function shouldSkipHtml(filename) {
  const lower = filename.toLowerCase();
  if (lower === "404.html" || lower === "error.html") return true;
  if (lower.endsWith("_error.html") || lower.endsWith(".error.html")) return true;
  if (lower.startsWith("_")) return true;
  return false;
}

async function findPrototypeRoot(handoffDir) {
  const candidates = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    let htmlCount = 0;
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".html") && !shouldSkipHtml(e.name)) htmlCount++;
    }
    if (htmlCount >= 1) candidates.push({ dir: d, htmlCount });
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIR_NAMES.has(e.name)) {
        await walk(join(d, e.name));
      }
    }
  }
  await walk(handoffDir);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.htmlCount !== a.htmlCount) return b.htmlCount - a.htmlCount;
    return a.dir.length - b.dir.length;
  });
  return candidates[0].dir;
}

async function listHtmlFiles(protoRoot) {
  const entries = await readdir(protoRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".html") && !shouldSkipHtml(e.name))
    .map((e) => e.name);
}

function findHtmlForPageId(pageId, htmlFilenames) {
  const direct = `${pageId}.html`;
  if (htmlFilenames.includes(direct)) return direct;
  const aliases = STANDARD_ID_ALIASES[pageId];
  if (aliases) {
    for (const alias of aliases) {
      const candidate = `${alias}.html`;
      if (htmlFilenames.includes(candidate)) return candidate;
    }
  }
  return null;
}

// ── Settle + dark toggle ───────────────────────────────────────────────────

async function settlePage(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
    `,
  });
  try {
    await page.evaluate(() => document.fonts?.ready);
  } catch {}
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {}
}

async function applyManualDark(page, darkProbe) {
  const m = darkProbe.selector?.match(/\[([\w-]+)="([^"]+)"\]/);
  if (m) {
    const [, attr, value] = m;
    await page.evaluate(
      ([a, v]) => {
        document.documentElement.setAttribute(a, v);
      },
      [attr, value],
    );
  } else if (darkProbe.selector?.startsWith(".")) {
    const cls = darkProbe.selector.slice(1);
    await page.evaluate((c) => document.documentElement.classList.add(c), cls);
  }
  await page.waitForTimeout(150);
}

// ── Element paint extraction ───────────────────────────────────────────────

async function getElementPaint(page, selector, propsList, opts = {}) {
  return await page.evaluate(
    ([sel, props, resolveTransparentBg]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const isTransparent = (v) =>
        !v || v === "transparent" || v === "rgba(0, 0, 0, 0)";
      const cs = window.getComputedStyle(el);
      const properties = {};
      for (const p of props) {
        let v = cs.getPropertyValue(p);
        if (resolveTransparentBg && p === "background-color" && isTransparent(v)) {
          let cur = el.parentElement;
          while (cur) {
            const bg = window
              .getComputedStyle(cur)
              .getPropertyValue("background-color");
            if (!isTransparent(bg)) {
              v = bg;
              break;
            }
            cur = cur.parentElement;
          }
        }
        if (v) properties[p] = v;
      }
      return {
        tag: el.tagName.toLowerCase(),
        classes: (el.className?.toString?.() ?? "").split(/\s+/).filter(Boolean),
        text: (el.textContent ?? "").trim().slice(0, 100),
        properties,
      };
    },
    [selector, propsList, !!opts.resolveTransparentBg],
  );
}

function buildElementProperties(lightProps, darkProps) {
  const out = {};
  if (lightProps) {
    for (const [prop, raw] of Object.entries(lightProps)) {
      const v = normalizePropValue(prop, raw);
      if (v != null) out[prop] = v;
    }
  }
  if (darkProps) {
    for (const [prop, raw] of Object.entries(darkProps)) {
      const v = normalizePropValue(prop, raw);
      if (v != null) out[`${prop}-dark`] = v;
    }
  }
  return out;
}

// ── Inventory loading ──────────────────────────────────────────────────────

async function loadInventory(sprite) {
  const sectionsJsonPath = join(sprite, "app", "analysis", "sections.json");
  const blocksJsonPath = join(sprite, "app", "analysis", "blocks.json");
  const colorRolesPath = join(sprite, "app", "analysis", "color-roles.json");
  const metaJsonPath = join(sprite, "app", "analysis", "meta.json");

  if (!existsSync(sectionsJsonPath)) {
    throw new Error(`Missing ${sectionsJsonPath}. Run Stage 2 first.`);
  }
  if (!existsSync(blocksJsonPath)) {
    throw new Error(`Missing ${blocksJsonPath}. Run Stage 3 first.`);
  }
  if (!existsSync(colorRolesPath)) {
    throw new Error(
      `Missing ${colorRolesPath}. The Stage 4 agent must write color-roles.json before this script runs.`,
    );
  }

  const sectionsJson = JSON.parse(await readFile(sectionsJsonPath, "utf8"));
  const blocksJson = JSON.parse(await readFile(blocksJsonPath, "utf8"));
  const colorRoles = JSON.parse(await readFile(colorRolesPath, "utf8"));
  const meta = existsSync(metaJsonPath)
    ? JSON.parse(await readFile(metaJsonPath, "utf8"))
    : { dark_mode: null };
  const darkProbe = meta.dark_mode;
  const darkMode = !!darkProbe;

  const handoffDir = join(sprite, "app", "handoff");
  const protoRoot = await findPrototypeRoot(handoffDir);
  if (!protoRoot) throw new Error(`No HTML files under ${handoffDir}.`);
  const htmlFilenames = await listHtmlFiles(protoRoot);

  const branded = new Set(colorRoles.branded_blocks ?? []);
  const primary = new Set(colorRoles.primary_button_blocks ?? []);
  const secondary = new Set(colorRoles.secondary_button_blocks ?? []);
  const cartSection = colorRoles.cart_section ?? null;

  // Resolve the host page for each unique section_type (first occurrence wins).
  const sectionHosts = new Map();
  for (const [pageId, page] of Object.entries(sectionsJson.pages ?? {})) {
    for (const s of page.sections ?? []) {
      if (!sectionHosts.has(s.type)) {
        sectionHosts.set(s.type, { pageId, sectionSelector: s.selector });
      }
    }
  }

  // Group section_types by host page so each prototype HTML is rendered once.
  const pageToSections = new Map();
  for (const [sectionType, host] of sectionHosts) {
    if (!pageToSections.has(host.pageId)) pageToSections.set(host.pageId, []);
    pageToSections.get(host.pageId).push({
      sectionType,
      sectionSelector: host.sectionSelector,
    });
  }

  const sections = [];
  const browser = await chromium.launch();

  try {
    for (const [pageId, sectionsInPage] of pageToSections) {
      const filename = findHtmlForPageId(pageId, htmlFilenames);
      if (!filename) {
        console.warn(`WARN: no HTML file for page ${pageId}, skipping`);
        continue;
      }
      const htmlPath = join(protoRoot, filename);

      // Light pass.
      const lightCtx = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light" });
      const lightPage = await lightCtx.newPage();
      await lightPage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
      await settlePage(lightPage);

      // Dark pass (parallel context).
      let darkPage = null;
      let darkCtx = null;
      if (darkProbe) {
        darkCtx = await browser.newContext({
          viewport: VIEWPORT,
          colorScheme: darkProbe.type === "media_query" ? "dark" : "light",
        });
        darkPage = await darkCtx.newPage();
        await darkPage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
        if (darkProbe.type === "manual") {
          await applyManualDark(darkPage, darkProbe);
        }
        await settlePage(darkPage);
      }

      for (const { sectionType, sectionSelector } of sectionsInPage) {
        const sectionLight = await getElementPaint(
          lightPage,
          sectionSelector,
          COLOR_PROPS_LIST,
          { resolveTransparentBg: true },
        );
        if (!sectionLight) {
          console.warn(`WARN: section ${sectionType}: selector did not match (${sectionSelector})`);
          continue;
        }
        const sectionDark = darkPage
          ? await getElementPaint(darkPage, sectionSelector, COLOR_PROPS_LIST, {
              resolveTransparentBg: true,
            })
          : null;

        const taggedElements = [];
        let n = 1;

        // Section root → kind: "section"
        taggedElements.push({
          n: n++,
          kind: "section",
          element: {
            tag: sectionLight.tag,
            classes: sectionLight.classes,
            text_excerpt: "",
            properties: buildElementProperties(
              sectionLight.properties,
              sectionDark?.properties,
            ),
          },
        });

        // Blocks within this section.
        const blocks = blocksJson[sectionType] ?? [];
        for (const blk of blocks) {
          if (branded.has(blk.type)) continue;
          const combined = `${sectionSelector} ${blk.selector}`;
          const blockLight = await getElementPaint(lightPage, combined, COLOR_PROPS_LIST);
          if (!blockLight) continue;
          const blockDark = darkPage
            ? await getElementPaint(darkPage, combined, COLOR_PROPS_LIST)
            : null;

          let kind;
          if (primary.has(blk.type)) kind = "primary_button";
          else if (secondary.has(blk.type)) kind = "secondary_button";
          else kind = blk.type;

          taggedElements.push({
            n: n++,
            kind,
            element: {
              tag: blockLight.tag,
              classes: blockLight.classes,
              text_excerpt: blockLight.text,
              properties: buildElementProperties(
                blockLight.properties,
                blockDark?.properties,
              ),
            },
          });
        }

        const sectionEl = taggedElements[0];
        sections.push({
          pageId,
          sectionKey: `${pageId}/${sectionType}`,
          candidate: {
            themes: {
              light: {
                background_color: sectionEl.element.properties["background-color"] ?? null,
                color: sectionEl.element.properties["color"] ?? null,
              },
              dark: {
                background_color:
                  sectionEl.element.properties["background-color-dark"] ?? null,
                color: sectionEl.element.properties["color-dark"] ?? null,
              },
            },
          },
          taggedElements,
        });
      }

      await lightCtx.close();
      if (darkCtx) await darkCtx.close();
    }
  } finally {
    await browser.close();
  }

  return { darkMode, sections, cartSection };
}

// ── Algorithm (1:1 from old derive-colors) ─────────────────────────────────

function findFirstByKind(section, targetKind) {
  return section.taggedElements.find((t) => t.kind === targetKind) ?? null;
}

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
      (m) => m.values.background === s.values.background && m.values.text === s.values.text,
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

function detectCrossCutting(sections, schemes) {
  const result = {};
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

// ── Cart scheme picker ─────────────────────────────────────────────────────

function pickCartScheme(schemes, cartSection) {
  if (!cartSection) return "scheme-1";
  const target = schemes.find((s) =>
    s.sections.some((k) => k.endsWith(`/${cartSection}`)),
  );
  return target?.name ?? "scheme-1";
}

// ── Output writers ─────────────────────────────────────────────────────────

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

function buildColorSchemesCss(schemeSettings, allRoles, darkMode) {
  const cssName = (id) => id.replace(/_/g, "-");
  const blocks = [];
  const schemeNames = Object.keys(schemeSettings);

  // Light mode: :root + scheme-1, then per-scheme attribute overrides.
  for (let i = 0; i < schemeNames.length; i++) {
    const name = schemeNames[i];
    const s = schemeSettings[name].settings;
    const selectors =
      i === 0
        ? `:root,\n[data-color-scheme="${name}"]`
        : `[data-color-scheme="${name}"]`;
    const decls = allRoles.map((r) => {
      const v = s[r.id];
      return v != null ? `  --${cssName(r.id)}: ${v};` : null;
    }).filter(Boolean);
    blocks.push(`${selectors} {\n${decls.join("\n")}\n}`);
  }

  // Dark mode overrides.
  if (darkMode) {
    for (let i = 0; i < schemeNames.length; i++) {
      const name = schemeNames[i];
      const s = schemeSettings[name].settings;
      const selectors =
        i === 0
          ? `.dark,\n.dark[data-color-scheme="${name}"],\n.dark [data-color-scheme="${name}"]`
          : `.dark[data-color-scheme="${name}"],\n.dark [data-color-scheme="${name}"]`;
      const decls = allRoles.map((r) => {
        const v = s[`${r.id}_dark`];
        return v != null ? `  --${cssName(r.id)}: ${v};` : null;
      }).filter(Boolean);
      blocks.push(`${selectors} {\n${decls.join("\n")}\n}`);
    }
  }

  return blocks.join("\n\n");
}

const COLOR_SCHEMES_MARKER_START = "/* === COLOR_SCHEMES_START === */";
const COLOR_SCHEMES_MARKER_END = "/* === COLOR_SCHEMES_END === */";

async function writeIndexCss(indexCssPath, css) {
  if (!existsSync(indexCssPath)) {
    console.warn(`WARN: ${indexCssPath} not found — skipping CSS variable injection`);
    return;
  }
  const block = `${COLOR_SCHEMES_MARKER_START}\n/* Auto-generated. Do not edit between markers. */\n\n${css}\n\n${COLOR_SCHEMES_MARKER_END}`;
  let content = await readFile(indexCssPath, "utf8");
  const startIdx = content.indexOf(COLOR_SCHEMES_MARKER_START);
  const endIdx = content.indexOf(COLOR_SCHEMES_MARKER_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + COLOR_SCHEMES_MARKER_END.length);
    content = `${before}${block}${after}`;
  } else {
    // First run: insert after @tailwind utilities; if missing, prepend.
    const utilitiesMatch = content.match(/@tailwind\s+utilities\s*;/);
    if (utilitiesMatch) {
      const idx = utilitiesMatch.index + utilitiesMatch[0].length;
      content = `${content.slice(0, idx)}\n\n${block}\n${content.slice(idx)}`;
    } else {
      content = `${block}\n\n${content}`;
    }
  }
  await writeFile(indexCssPath, content);
}

async function writeDebugJson(path, sections, schemes, hasFilledSecondary) {
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  const sectionDump = sections.map((s) => ({
    sectionKey: s.sectionKey,
    scheme: schemeNameForSection(schemes, s.sectionKey),
    signature: primarySignature(s, hasFilledSecondary),
    elements: s.taggedElements.map((t) => ({
      n: t.n,
      kind: t.kind,
      tag: t.element.tag,
      classes: t.element.classes,
      text_excerpt: t.element.text_excerpt,
      properties: t.element.properties,
    })),
  }));
  const schemeDump = schemes.map((s) => ({
    name: s.name,
    section_count: s.sections.length,
    sections: s.sections,
    values: s.values,
  }));
  await writeFile(
    path,
    JSON.stringify({ schemes: schemeDump, sections: sectionDump }, null, 2) + "\n",
  );
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

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { sprite } = parseArgs();
  console.log(`── deriving color schemes ──`);

  const { darkMode, sections, cartSection } = await loadInventory(sprite);
  if (sections.length === 0) {
    console.warn("No sections found, nothing to do.");
    return;
  }

  const hasFilledSecondary = detectFilledSecondary(sections);
  const schemes = groupSchemes(sections, darkMode, hasFilledSecondary);
  const { roles: crossCuttingRoles, claimedKeys } = detectCrossCutting(sections, schemes);
  const allRoles = buildAllRoles(hasFilledSecondary, crossCuttingRoles);

  const schemeSettings = buildSchemeSettings(schemes, allRoles, crossCuttingRoles, darkMode);
  const fallbackWarnings = fillNullsWithFallbacks(schemeSettings);

  const definition = buildDefinition(
    allRoles,
    darkMode,
    schemeSettings["scheme-1"]?.settings ?? {},
  );

  const cartScheme = pickCartScheme(schemes, cartSection);

  const schemaPath = join(sprite, "app", "frontend", "src", "settings", "schema.json");
  const settingsPath = join(sprite, "app", "frontend", "theme", "settings", "settings.json");
  const tailwindPath = join(sprite, "app", "frontend", "tailwind.config.js");
  const decorationsPath = join(sprite, "app", "analysis", "colors-decorations.json");

  if (!existsSync(schemaPath)) {
    throw new Error(`Missing ${schemaPath}`);
  }

  const indexCssPath = join(sprite, "app", "frontend", "src", "index.css");
  const colorSchemesCss = buildColorSchemesCss(schemeSettings, allRoles, darkMode);

  await writeSchemaJson(schemaPath, definition);
  await writeSettingsJson(settingsPath, schemeSettings, cartScheme);
  await writeTailwindConfig(tailwindPath, allRoles);
  await writeIndexCss(indexCssPath, colorSchemesCss);
  await writeDecorationsJson(decorationsPath, sections, claimedKeys);
  await writeDebugJson(
    join(sprite, "app", "analysis", "colors-debug.json"),
    sections,
    schemes,
    hasFilledSecondary,
  );

  for (const w of fallbackWarnings) console.warn(`WARN: ${w}`);
  console.log(
    `Filled secondary: ${hasFilledSecondary ? "yes" : "no"} | Cross-cutting: ${
      Object.keys(crossCuttingRoles).join(", ") || "none"
    }`,
  );
  console.log(
    `Schemes: ${schemes.length} | Roles per theme: ${allRoles.length} | Total entries: ${
      allRoles.length * (darkMode ? 2 : 1)
    } | Cart scheme: ${cartScheme}`,
  );
  for (const s of schemes) console.log(`  ${s.name}: ${s.sections.length} sections`);
  console.log(`\n✅ Stage 4 derive complete`);
}

main().catch((err) => {
  console.error("Stage 4 derive failed:", err);
  process.exit(1);
});
