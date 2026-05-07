#!/usr/bin/env node
/**
 * Stage 3 / crop-sections.
 *
 * Reads <sprite>/app/analysis/sections.json and, for every unique section
 * `type`, picks one page where it appears, renders that page in headless
 * Chromium, locates the section by its CSS selector, and writes:
 *   - <sprite>/app/analysis/sections/<type>.html       (cleaned outerHTML)
 *   - <sprite>/app/analysis/sections/<type>.light.png  (cropped screenshot)
 *   - <sprite>/app/analysis/sections/<type>.dark.png   (if dark-mode probe present)
 *
 * The cropped pair is what the agent reads in Stage 3 to decide what's a
 * block. One file per unique section type — header/footer dedup automatically
 * because they're listed once in sections.json.header_sections / footer_sections
 * but are referenced by name in every page's sections[] anyway.
 *
 * Usage:
 *   node 3-crop-sections.mjs --sprite <sprite-path>
 */

import { chromium } from "playwright";
import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
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

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let sprite = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sprite") sprite = args[++i];
  }
  if (!sprite) {
    console.error("Usage: 3-crop-sections.mjs --sprite <sprite-path>");
    process.exit(1);
  }
  return { sprite: resolve(sprite) };
}

// ── Prototype root + page-id → file mapping (same as Stage 2) ──────────────

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

// ── Settle (same as Stage 2) ───────────────────────────────────────────────

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
  await page.evaluate(async () => {
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    );
    const step = Math.max(window.innerHeight / 2, 200);
    for (let y = 0; y <= totalHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 100));
  });
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {}
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => {
      try {
        a.finish();
      } catch {
        try {
          a.pause();
        } catch {}
      }
    });
  });
}

// ── Per-section extraction in browser ──────────────────────────────────────

async function extractSection(page, selector) {
  return await page.evaluate((sel) => {
    const SAFE_DATA_ATTRS = new Set(["data-theme"]);
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

    const el = document.querySelector(sel);
    if (!el) return { error: `selector did not match: ${sel}` };

    const rect = el.getBoundingClientRect();
    const clip = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const clone = el.cloneNode(true);
    function clean(n) {
      if (!n || n.nodeType !== 1) return;
      if (SKIP_TAGS.has(n.tagName)) {
        n.remove();
        return;
      }
      for (const a of [...n.attributes]) {
        const name = a.name;
        if (name.startsWith("on")) n.removeAttribute(name);
        else if (name.startsWith("data-") && !SAFE_DATA_ATTRS.has(name)) {
          n.removeAttribute(name);
        }
      }
      for (const c of [...n.children]) clean(c);
    }
    clean(clone);

    return { clip, html: clone.outerHTML };
  }, selector);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { sprite } = parseArgs();
  const sectionsJsonPath = join(sprite, "app", "analysis", "sections.json");
  const metaJsonPath = join(sprite, "app", "analysis", "meta.json");
  if (!existsSync(sectionsJsonPath)) {
    throw new Error(`Missing ${sectionsJsonPath}. Run Stage 2 first.`);
  }
  const sectionsJson = JSON.parse(await readFile(sectionsJsonPath, "utf8"));
  const meta = existsSync(metaJsonPath)
    ? JSON.parse(await readFile(metaJsonPath, "utf8"))
    : { dark_mode: null };
  const darkProbe = meta.dark_mode;

  const handoffDir = join(sprite, "app", "handoff");
  const protoRoot = await findPrototypeRoot(handoffDir);
  if (!protoRoot) throw new Error(`No HTML files under ${handoffDir}.`);
  const htmlFilenames = await listHtmlFiles(protoRoot);

  // Pick one page per unique section type (first occurrence).
  const sectionToPage = new Map();
  for (const [pageId, page] of Object.entries(sectionsJson.pages ?? {})) {
    for (const s of page.sections ?? []) {
      if (!sectionToPage.has(s.type)) {
        sectionToPage.set(s.type, { pageId, selector: s.selector });
      }
    }
  }

  // Group by page so we render each page only once.
  const pageToSections = new Map();
  for (const [type, { pageId, selector }] of sectionToPage) {
    if (!pageToSections.has(pageId)) pageToSections.set(pageId, []);
    pageToSections.get(pageId).push({ type, selector });
  }

  const sectionsOutDir = join(sprite, "app", "analysis", "sections");
  if (existsSync(sectionsOutDir)) await rm(sectionsOutDir, { recursive: true });
  await mkdir(sectionsOutDir, { recursive: true });

  const browser = await chromium.launch();
  let written = 0;
  let warnings = 0;

  try {
    for (const [pageId, sectionsInPage] of pageToSections) {
      const filename = findHtmlForPageId(pageId, htmlFilenames);
      if (!filename) {
        console.warn(`WARN: no HTML file for page ${pageId}, skipping ${sectionsInPage.length} sections`);
        warnings++;
        continue;
      }
      const htmlPath = join(protoRoot, filename);
      console.log(`\n── ${pageId} → ${sectionsInPage.length} sections ──`);

      // Light pass: HTML + light screenshot per section.
      const lightCtx = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: darkProbe?.type === "media_query" ? "light" : "light",
      });
      const lightPage = await lightCtx.newPage();
      await lightPage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
      await settlePage(lightPage);

      for (const { type, selector } of sectionsInPage) {
        const result = await extractSection(lightPage, selector);
        if (result.error) {
          console.warn(`  WARN: ${type}: ${result.error}`);
          warnings++;
          continue;
        }
        await writeFile(join(sectionsOutDir, `${type}.html`), result.html);
        await lightPage.screenshot({
          path: join(sectionsOutDir, `${type}.light.png`),
          fullPage: true,
          clip: result.clip,
        });
        console.log(`  ✓ ${type}`);
        written++;
      }
      await lightCtx.close();

      // Dark pass: dark screenshot per section.
      if (darkProbe) {
        const darkCtx = await browser.newContext({
          viewport: VIEWPORT,
          colorScheme: darkProbe.type === "media_query" ? "dark" : "light",
        });
        const darkPage = await darkCtx.newPage();
        await darkPage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
        if (darkProbe.type === "manual") {
          const apply = `() => { document.documentElement.dataset.theme = 'dark'; }`;
          // Re-derive the apply function from the selector — same logic as
          // Stage 2's detectDarkMode. Here we keep it simple and assume
          // `[data-theme="dark"]` if probe.type is manual; else colorScheme.
          // For other manual probes, this would need to mirror Stage 2.
          await darkPage.evaluate(`(${apply})()`);
          await darkPage.waitForTimeout(150);
        }
        await settlePage(darkPage);

        for (const { type, selector } of sectionsInPage) {
          const r = await extractSection(darkPage, selector);
          if (r.error) continue;
          await darkPage.screenshot({
            path: join(sectionsOutDir, `${type}.dark.png`),
            fullPage: true,
            clip: r.clip,
          });
        }
        await darkCtx.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\nWrote ${written} sections to app/analysis/sections/ (${warnings} warnings)`,
  );
  console.log(`✅ Stage 3 crop complete`);
}

main().catch((err) => {
  console.error("Stage 3 crop failed:", err);
  process.exit(1);
});
