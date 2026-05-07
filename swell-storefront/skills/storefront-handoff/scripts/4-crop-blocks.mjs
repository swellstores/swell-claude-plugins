#!/usr/bin/env node
/**
 * Stage 4 / crop-blocks.
 *
 * Reads <sprite>/app/analysis/blocks.json + sections.json, picks one host page
 * per unique block type, renders that page, locates the block via combined
 * `<section_selector> <block_selector>` query, and writes:
 *   - <sprite>/app/analysis/blocks/<block_type>.light.png
 *   - <sprite>/app/analysis/blocks/<block_type>.dark.png   (if dark probe present)
 *
 * One file per unique block type — multi-instance blocks (selector matches N
 * siblings) crop the first match.
 *
 * Usage:
 *   node 4-crop-blocks.mjs --sprite <sprite-path>
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
    console.error("Usage: 4-crop-blocks.mjs --sprite <sprite-path>");
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

// ── Settle ─────────────────────────────────────────────────────────────────

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

// ── Dark-mode toggling ─────────────────────────────────────────────────────

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

// ── Block bbox ─────────────────────────────────────────────────────────────

async function getBlockBbox(page, combinedSelector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { empty: true };
    return {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y + window.scrollY)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, combinedSelector);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { sprite } = parseArgs();
  const sectionsJsonPath = join(sprite, "app", "analysis", "sections.json");
  const blocksJsonPath = join(sprite, "app", "analysis", "blocks.json");
  const metaJsonPath = join(sprite, "app", "analysis", "meta.json");

  if (!existsSync(sectionsJsonPath)) {
    throw new Error(`Missing ${sectionsJsonPath}. Run Stage 2 first.`);
  }
  if (!existsSync(blocksJsonPath)) {
    throw new Error(`Missing ${blocksJsonPath}. Run Stage 3 first.`);
  }

  const sectionsJson = JSON.parse(await readFile(sectionsJsonPath, "utf8"));
  const blocksJson = JSON.parse(await readFile(blocksJsonPath, "utf8"));
  const meta = existsSync(metaJsonPath)
    ? JSON.parse(await readFile(metaJsonPath, "utf8"))
    : { dark_mode: null };
  const darkProbe = meta.dark_mode;

  const handoffDir = join(sprite, "app", "handoff");
  const protoRoot = await findPrototypeRoot(handoffDir);
  if (!protoRoot) throw new Error(`No HTML files under ${handoffDir}.`);
  const htmlFilenames = await listHtmlFiles(protoRoot);

  // Map: section_type → { pageId, sectionSelector } — first occurrence wins.
  const sectionHosts = new Map();
  for (const [pageId, page] of Object.entries(sectionsJson.pages ?? {})) {
    for (const s of page.sections ?? []) {
      if (!sectionHosts.has(s.type)) {
        sectionHosts.set(s.type, { pageId, sectionSelector: s.selector });
      }
    }
  }

  // Map: block_type → { pageId, sectionSelector, blockSelector } — first wins.
  const blockHosts = new Map();
  for (const [sectionType, blocks] of Object.entries(blocksJson)) {
    const host = sectionHosts.get(sectionType);
    if (!host) {
      console.warn(`WARN: section ${sectionType} has blocks but no entry in sections.json`);
      continue;
    }
    for (const blk of blocks) {
      if (!blockHosts.has(blk.type)) {
        blockHosts.set(blk.type, {
          pageId: host.pageId,
          sectionSelector: host.sectionSelector,
          blockSelector: blk.selector,
        });
      }
    }
  }

  // Group by page so we render each prototype HTML only once.
  const pageToBlocks = new Map();
  for (const [type, info] of blockHosts) {
    if (!pageToBlocks.has(info.pageId)) pageToBlocks.set(info.pageId, []);
    pageToBlocks.get(info.pageId).push({ type, ...info });
  }

  const outDir = join(sprite, "app", "analysis", "blocks");
  if (existsSync(outDir)) await rm(outDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  let written = 0;
  let warnings = 0;

  try {
    for (const [pageId, blocks] of pageToBlocks) {
      const filename = findHtmlForPageId(pageId, htmlFilenames);
      if (!filename) {
        console.warn(`WARN: no HTML file for page ${pageId}, skipping ${blocks.length} blocks`);
        warnings++;
        continue;
      }
      const htmlPath = join(protoRoot, filename);
      console.log(`\n── ${pageId} → ${blocks.length} blocks ──`);

      // Light pass.
      const lightCtx = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: "light",
      });
      const lightPage = await lightCtx.newPage();
      await lightPage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
      await settlePage(lightPage);

      for (const { type, sectionSelector, blockSelector } of blocks) {
        const combined = `${sectionSelector} ${blockSelector}`;
        const bbox = await getBlockBbox(lightPage, combined);
        if (!bbox) {
          console.warn(`  WARN: ${type}: selector did not match (${combined})`);
          warnings++;
          continue;
        }
        if (bbox.empty) {
          console.warn(`  WARN: ${type}: zero-size bbox`);
          warnings++;
          continue;
        }
        await lightPage.screenshot({
          path: join(outDir, `${type}.light.png`),
          fullPage: true,
          clip: bbox,
        });
        console.log(`  ✓ ${type}`);
        written++;
      }
      await lightCtx.close();

      // Dark pass.
      if (darkProbe) {
        const darkCtx = await browser.newContext({
          viewport: VIEWPORT,
          colorScheme: darkProbe.type === "media_query" ? "dark" : "light",
        });
        const darkPage = await darkCtx.newPage();
        await darkPage.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
        if (darkProbe.type === "manual") {
          await applyManualDark(darkPage, darkProbe);
        }
        await settlePage(darkPage);

        for (const { type, sectionSelector, blockSelector } of blocks) {
          const combined = `${sectionSelector} ${blockSelector}`;
          const bbox = await getBlockBbox(darkPage, combined);
          if (!bbox || bbox.empty) continue;
          await darkPage.screenshot({
            path: join(outDir, `${type}.dark.png`),
            fullPage: true,
            clip: bbox,
          });
        }
        await darkCtx.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\nWrote ${written} block crops to app/analysis/blocks/ (${warnings} warnings)`,
  );
  console.log(`✅ Stage 4 crop complete`);
}

main().catch((err) => {
  console.error("Stage 4 crop failed:", err);
  process.exit(1);
});
