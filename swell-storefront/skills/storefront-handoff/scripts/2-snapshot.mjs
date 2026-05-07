#!/usr/bin/env node
/**
 * Stage 2 — Prototype snapshot.
 *
 * For each page declared in <sprite>/app/swell.json.storefront.theme.pages,
 * render the matching HTML file in headless Chromium at lg (1280×900) and
 * capture:
 *   - full-page screenshot (light and, if a dark-mode toggle is detected, dark)
 *   - cleaned full-page outerHTML (no scripts/styles, no on*-handlers, no
 *     data-* attrs except `data-theme`)
 * Plus a meta.json with the dark-mode probe result, root CSS-variable tokens,
 * viewport, and page ids.
 *
 * Outputs (under <sprite>/app/analysis/):
 *   meta.json
 *   pages/<id>.html
 *   screenshots/<id>.<theme>.png
 *
 * Usage:
 *   node 2-snapshot.mjs --sprite <sprite-path>
 */

import { chromium } from "playwright";
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

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
    console.error("Usage: 2-snapshot.mjs --sprite <sprite-path>");
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
      if (e.isFile() && e.name.endsWith(".html") && !shouldSkipHtml(e.name)) {
        htmlCount++;
      }
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

// ── Settle (animations off, scroll-triggered reveals, networkidle) ─────────

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

// ── Dark mode probe-based detection ────────────────────────────────────────

async function detectDarkMode(handoffDir, browser, samplePagePath) {
  const candidates = [
    {
      label: '[data-theme="dark"]',
      apply: `() => { document.documentElement.dataset.theme = 'dark'; }`,
      reset: `() => { delete document.documentElement.dataset.theme; }`,
    },
    {
      label: '[data-color-scheme="dark"]',
      apply: `() => { document.documentElement.dataset.colorScheme = 'dark'; }`,
      reset: `() => { delete document.documentElement.dataset.colorScheme; }`,
    },
    {
      label: 'class="dark"',
      apply: `() => { document.documentElement.classList.add('dark'); }`,
      reset: `() => { document.documentElement.classList.remove('dark'); }`,
    },
    {
      label: 'class="dark-mode"',
      apply: `() => { document.documentElement.classList.add('dark-mode'); }`,
      reset: `() => { document.documentElement.classList.remove('dark-mode'); }`,
    },
  ];

  const seen = new Set(candidates.map((c) => c.label));
  async function* walkFiles(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && !SKIP_DIR_NAMES.has(e.name)) yield* walkFiles(full);
      else if (
        e.isFile() &&
        (e.name.endsWith(".css") || e.name.endsWith(".html") || e.name.endsWith(".js"))
      ) {
        yield full;
      }
    }
  }
  for await (const file of walkFiles(handoffDir)) {
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const dataAttrRe =
      /\[data-([\w-]+)\s*[=~|^$*]?\s*"?([\w-]*(?:dark|night|noir|midnight)[\w-]*)"?\]/gi;
    let m;
    while ((m = dataAttrRe.exec(content)) !== null) {
      const attr = m[1];
      const val = m[2];
      const key = `[data-${attr}="${val}"]`;
      if (seen.has(key)) continue;
      seen.add(key);
      const camel = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      candidates.push({
        label: key,
        apply: `() => { document.documentElement.dataset['${camel}'] = '${val}'; }`,
        reset: `() => { delete document.documentElement.dataset['${camel}']; }`,
      });
    }
    const classRe = /\.([\w-]*(?:dark|night|noir|midnight)[\w-]*)\b/gi;
    while ((m = classRe.exec(content)) !== null) {
      const cls = m[1];
      const key = `class="${cls}"`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        label: key,
        apply: `() => { document.documentElement.classList.add('${cls}'); }`,
        reset: `() => { document.documentElement.classList.remove('${cls}'); }`,
      });
    }
  }

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(`file://${samplePagePath}`, { waitUntil: "networkidle" });

  async function fingerprint(p) {
    return await p.evaluate(() => {
      const all = [...document.querySelectorAll("*")];
      const sized = all
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width * rect.height > 1000)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
        .slice(0, 12);
      return sized
        .map(({ el }) => {
          const cs = getComputedStyle(el);
          return (
            cs.getPropertyValue("background-color").trim() +
            "|" +
            cs.getPropertyValue("color").trim()
          );
        })
        .join("||");
    });
  }

  const baseline = await fingerprint(page);
  let winner = null;
  for (const cand of candidates) {
    try {
      await page.evaluate(`(${cand.apply})()`);
      await page.waitForTimeout(80);
      const after = await fingerprint(page);
      await page.evaluate(`(${cand.reset})()`);
      await page.waitForTimeout(40);
      if (after !== baseline) {
        winner = cand;
        break;
      }
    } catch {}
  }
  await ctx.close();

  if (winner) {
    return { selector: winner.label, type: "manual", apply: winner.apply, reset: winner.reset };
  }

  const lightCtx = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light" });
  const lightPage = await lightCtx.newPage();
  await lightPage.goto(`file://${samplePagePath}`, { waitUntil: "networkidle" });
  const lightFp = await fingerprint(lightPage);
  await lightCtx.close();

  const darkCtx = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark" });
  const darkPage = await darkCtx.newPage();
  await darkPage.goto(`file://${samplePagePath}`, { waitUntil: "networkidle" });
  const darkFp = await fingerprint(darkPage);
  await darkCtx.close();

  if (lightFp !== darkFp) {
    return {
      selector: "@media (prefers-color-scheme: dark)",
      type: "media_query",
      apply: null,
      reset: null,
    };
  }
  return null;
}

// ── Cleaned HTML dump ──────────────────────────────────────────────────────

async function dumpCleanedHTML(page) {
  return await page.evaluate(() => {
    const SAFE_DATA_ATTRS = new Set(["data-theme"]);
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

    const clone = document.body.cloneNode(true);
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
    return clone.outerHTML;
  });
}

// ── CSS variable tokens ────────────────────────────────────────────────────

async function extractTokens(page) {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const tokens = {};
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name.startsWith("--")) tokens[name] = cs.getPropertyValue(name).trim();
    }
    return tokens;
  });
}

// ── rgb()/rgba() → hex normalization (for token map) ──────────────────────

function rgbToHex(match) {
  const m = match.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)/,
  );
  if (!m) return match;
  const toHex = (n) =>
    Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, "0");
  const r = toHex(m[1]);
  const g = toHex(m[2]);
  const b = toHex(m[3]);
  if (m[4] === undefined) return `#${r}${g}${b}`;
  const a = Math.max(0, Math.min(255, Math.round(parseFloat(m[4]) * 255)))
    .toString(16)
    .padStart(2, "0");
  return a === "ff" ? `#${r}${g}${b}` : `#${r}${g}${b}${a}`;
}

function normalizeColors(value) {
  if (typeof value === "string") {
    return value.replace(/rgba?\(\s*[\d.\s,]+\s*\)/g, (m) => rgbToHex(m));
  }
  if (Array.isArray(value)) return value.map(normalizeColors);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeColors(v);
    return out;
  }
  return value;
}

// ── Per-page render ────────────────────────────────────────────────────────

async function renderPage(browser, htmlPath, themeMode, darkProbe, screenshotsDir, pageId) {
  const ctxOpts = { viewport: VIEWPORT };
  ctxOpts.colorScheme =
    themeMode === "dark" && darkProbe?.type === "media_query" ? "dark" : "light";

  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });

  if (themeMode === "dark" && darkProbe?.type === "manual") {
    await page.evaluate(`(${darkProbe.apply})()`);
    await page.waitForTimeout(150);
  }

  await settlePage(page);

  const screenshotAbs = join(screenshotsDir, `${pageId}.${themeMode}.png`);
  await page.screenshot({ path: screenshotAbs, fullPage: true });

  let html = null;
  let tokens = null;
  if (themeMode === "light") {
    html = await dumpCleanedHTML(page);
    tokens = await extractTokens(page);
  }

  await ctx.close();
  return { screenshotAbs, html, tokens };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { sprite } = parseArgs();

  const swellJsonPath = join(sprite, "app", "swell.json");
  if (!existsSync(swellJsonPath)) {
    throw new Error(`Missing ${swellJsonPath}. Run Stage 0 first.`);
  }
  const swellJson = JSON.parse(await readFile(swellJsonPath, "utf8"));
  const pagesList = swellJson?.storefront?.theme?.pages ?? [];
  if (pagesList.length === 0) {
    throw new Error("No pages in app/swell.json. Run Stage 1 first.");
  }

  const handoffDir = join(sprite, "app", "handoff");
  if (!existsSync(handoffDir)) {
    throw new Error(`Missing ${handoffDir}. Run Stage 0 first.`);
  }
  const protoRoot = await findPrototypeRoot(handoffDir);
  if (!protoRoot) {
    throw new Error(`No HTML files under ${handoffDir}.`);
  }
  console.log(`Prototype root: ${relative(sprite, protoRoot)}`);

  const htmlFilenames = await listHtmlFiles(protoRoot);
  const idToFile = {};
  const unmapped = [];
  for (const page of pagesList) {
    const file = findHtmlForPageId(page.id, htmlFilenames);
    if (file) idToFile[page.id] = join(protoRoot, file);
    else unmapped.push(page.id);
  }
  if (Object.keys(idToFile).length === 0) {
    throw new Error("Could not map any swell.json page id to an HTML file.");
  }
  if (unmapped.length > 0) {
    console.warn(`Skipping pages without HTML source: ${unmapped.join(", ")}`);
  }

  const analysisDir = join(sprite, "app", "analysis");
  const pagesOutDir = join(analysisDir, "pages");
  const screenshotsDir = join(analysisDir, "screenshots");
  await mkdir(pagesOutDir, { recursive: true });
  await mkdir(screenshotsDir, { recursive: true });

  const browser = await chromium.launch();

  try {
    const samplePagePath = Object.values(idToFile)[0];
    const darkProbe = await detectDarkMode(handoffDir, browser, samplePagePath);
    console.log(
      `Dark mode: ${darkProbe ? `YES (${darkProbe.selector}, ${darkProbe.type})` : "no"}`,
    );

    let tokens = null;

    for (const [pageId, htmlPath] of Object.entries(idToFile)) {
      console.log(`\n── ${pageId} ──`);

      const lightResult = await renderPage(
        browser,
        htmlPath,
        "light",
        darkProbe,
        screenshotsDir,
        pageId,
      );
      if (!tokens && lightResult.tokens) {
        tokens = lightResult.tokens;
        console.log(`  tokens: ${Object.keys(tokens).length} cssvars`);
      }

      if (darkProbe) {
        await renderPage(browser, htmlPath, "dark", darkProbe, screenshotsDir, pageId);
      }

      if (lightResult.html) {
        const htmlOutPath = join(pagesOutDir, `${pageId}.html`);
        await writeFile(htmlOutPath, lightResult.html);
        const htmlKb = ((await stat(htmlOutPath)).size / 1024).toFixed(1);
        console.log(`  → wrote pages/${pageId}.html (${htmlKb} KB) + screenshots`);
      }
    }

    const meta = {
      extracted_at: new Date().toISOString(),
      viewport: VIEWPORT,
      dark_mode: darkProbe
        ? { selector: darkProbe.selector, type: darkProbe.type }
        : null,
      tokens: normalizeColors(tokens ?? {}),
      pages: Object.keys(idToFile),
    };
    await writeFile(join(analysisDir, "meta.json"), JSON.stringify(meta, null, 2));
    console.log(
      `\nWrote meta.json (${Object.keys(idToFile).length} pages, ${Object.keys(tokens ?? {}).length} tokens, dark_mode: ${darkProbe ? "yes" : "no"})`,
    );
  } finally {
    await browser.close();
  }

  console.log(`\n✅ Stage 2 complete`);
}

main().catch((err) => {
  console.error("Stage 2 failed:", err);
  process.exit(1);
});
