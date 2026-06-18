#!/usr/bin/env node
//
// Stage 3 / decompose-sections — produces app/analysis/section-trees.json
// from sections.json + the handoff prototype's HTML.
//
// The algorithm runs entirely inside the headless browser; Node only
// orchestrates page navigation and writes the result.
//

import { chromium } from "playwright";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const PAGE_ALIASES = {
  index: ["index", "home"],
  products: ["products", "shop", "store", "catalog"],
  product: ["product"],
};

const args = process.argv.slice(2);
const spriteIdx = args.indexOf("--sprite");
if (spriteIdx < 0 || !args[spriteIdx + 1]) {
  console.error("Usage: 3-decompose-sections.mjs --sprite <sprite-path>");
  process.exit(1);
}
const sprite = resolve(args[spriteIdx + 1]);

async function locateHtml(handoffDir, pageId) {
  const aliases = PAGE_ALIASES[pageId] ?? [pageId];
  const wanted = new Set(aliases.map((a) => `${a.toLowerCase()}.html`));
  async function* walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "uploads") continue;
        yield* walk(p);
      } else if (e.isFile() && wanted.has(e.name.toLowerCase())) {
        yield p;
      }
    }
  }
  for await (const p of walk(handoffDir)) return p;
  return null;
}

async function quietPage(page) {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;}`,
  });
  try { await page.evaluate(() => document.fonts?.ready); } catch {}
  try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}
}

// Everything below runs inside the browser. The function is serialized as a
// string and re-evaluated in the page context.
const RUN_IN_BROWSER = (sectionSelector, opts) => {
  const { containerBudget, collectionMin } = opts;
  const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  const counters = { block: 0, container: 0, collection: 0, overlay: 0 };
  const newId = (k) => `${k}_${++counters[k]}`;

  const sectionEl = document.querySelector(sectionSelector);
  if (!sectionEl) return null;
  const sectionRect = sectionEl.getBoundingClientRect();
  const overlays = [];

  // ── helpers ────────────────────────────────────────────────────────────

  const tagOf = (el) => el.tagName.toLowerCase();
  const classesOf = (el) =>
    (el.className?.toString?.() || "").match(/\S+/g) || [];

  const relativeSelector = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== sectionEl) {
      const parent = cur.parentElement;
      if (!parent) break;
      const idx = Array.from(parent.children).indexOf(cur) + 1;
      parts.unshift(`${tagOf(cur)}:nth-child(${idx})`);
      cur = parent;
    }
    return parts.length ? "> " + parts.join(" > ") : "";
  };

  const sectionRelativeBbox = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x - sectionRect.x),
      y: Math.round(r.y - sectionRect.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };

  const isVisible = (el, cs) => {
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isOverlay = (cs) =>
    cs.position === "absolute" || cs.position === "fixed";

  const hasOwnPaint = (cs) => {
    if (cs.backgroundColor && !TRANSPARENT.has(cs.backgroundColor)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    for (const side of ["top", "right", "bottom", "left"]) {
      const w = parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0;
      const st = cs.getPropertyValue(`border-${side}-style`);
      if (w > 0 && st !== "none" && st !== "hidden") return true;
    }
    return false;
  };

  const hasDirectText = (el) => {
    for (const n of el.childNodes)
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) return true;
    return false;
  };

  // Categorize each element child once: keep only renderable ones, split
  // flow vs overlay.
  const categorize = (el) => {
    const flow = [];
    const ovs = [];
    for (const c of el.children) {
      if (SKIP_TAGS.has(c.tagName)) continue;
      const cs = window.getComputedStyle(c);
      if (!isVisible(c, cs)) continue;
      (isOverlay(cs) ? ovs : flow).push(c);
    }
    return { flow, ovs };
  };

  const flowDirection = (cs, width) => {
    const d = cs.display;
    if (d.includes("grid")) {
      const v = cs.gridTemplateColumns;
      const tracks = v && v !== "none" ? v.split(/\s+/).filter(Boolean).length : 1;
      return tracks > 1 ? "row" : "col";
    }
    if (d.includes("flex"))
      return cs.flexDirection.startsWith("column") ? "col" : "row";
    return "col";
  };

  const ALIGN = {
    "flex-start": "start", start: "start", center: "center",
    "flex-end": "end", end: "end", stretch: "stretch", baseline: "baseline",
  };
  const JUSTIFY = {
    "flex-start": "start", start: "start", center: "center",
    "flex-end": "end", end: "end",
    "space-between": "between", "space-around": "around", "space-evenly": "evenly",
  };

  // Containers expose only their flow direction (row|col) plus spacing.
  // Grid columns are NEVER on a container — they belong to section_layout
  // alone, since the section is the only place where an explicit grid is
  // honored. Anywhere else, the script collapses grid into row/col.
  const layoutOf = (el, { withColumns = false } = {}) => {
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const out = { direction: flowDirection(cs, r.width) };

    if (
      withColumns &&
      cs.display.includes("grid") &&
      cs.gridTemplateColumns !== "none"
    ) {
      const tokens = cs.gridTemplateColumns.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        const fr = tokens
          .filter((t) => t.endsWith("fr"))
          .reduce((s, t) => s + parseFloat(t), 0);
        out.columns = tokens.map((t) => {
          if (t.endsWith("%")) return Math.round(parseFloat(t));
          if (t.endsWith("fr"))
            return fr > 0 ? Math.round((parseFloat(t) / fr) * 100) : 0;
          if (t.endsWith("px"))
            return r.width > 0 ? Math.round((parseFloat(t) / r.width) * 100) : 0;
          return 0;
        });
      }
    }

    const gap = parseFloat(cs.rowGap || cs.gap) || 0;
    if (gap > 0) out.gap = Math.round(gap);
    if (ALIGN[cs.alignItems]) out.align = ALIGN[cs.alignItems];
    if (JUSTIFY[cs.justifyContent]) out.justify = JUSTIFY[cs.justifyContent];

    const padding = {};
    const sides = ["Top", "Right", "Bottom", "Left"];
    for (const s of sides) {
      const v = Math.round(parseFloat(cs[`padding${s}`]) || 0);
      if (v) padding[s.toLowerCase()] = v;
    }
    if (Object.keys(padding).length) out.padding = padding;
    return out;
  };

  // ── emit-side ─────────────────────────────────────────────────────────

  const meta = (el) => {
    const cls = classesOf(el);
    const txt = (el.textContent || "").trim().slice(0, 100);
    const r = {
      selector: relativeSelector(el),
      tag: tagOf(el),
      bbox: sectionRelativeBbox(el),
    };
    if (cls.length) r.classes = cls;
    if (txt) r.text_excerpt = txt;
    return r;
  };

  const recordOverlays = (els) => {
    for (const el of els) {
      overlays.push({ id: newId("overlay"), kind: "overlay", ...meta(el) });
    }
  };

  const block = (el, kind) => ({ id: newId("block"), kind, ...meta(el) });

  const collection = (group) => {
    const head = group[0];
    const cls = classesOf(head);
    const itemSel = `${tagOf(head)}${cls.length ? "." + cls.join(".") : ""}`;
    const boxes = group.map(sectionRelativeBbox);
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return {
      id: newId("collection"),
      kind: "collection",
      item_selector: itemSel,
      item_count: group.length,
      bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    };
  };

  const container = (el, children) => ({
    id: newId("container"),
    kind: "container",
    ...meta(el),
    layout: layoutOf(el),
    children,
  });

  // ── collection grouping ───────────────────────────────────────────────

  const namedClasses = (el) => new Set(classesOf(el).filter((c) => c));
  const canGroup = (a, b) => {
    if (a.tagName !== b.tagName) return false;
    if (tagOf(a) !== "div") return true;
    const ac = namedClasses(a);
    if (ac.size === 0) return false;
    for (const c of namedClasses(b)) if (ac.has(c)) return true;
    return false;
  };
  const partition = (siblings) => {
    const out = [];
    let i = 0;
    while (i < siblings.length) {
      const head = siblings[i];
      const run = [head];
      let j = i + 1;
      while (j < siblings.length && canGroup(head, siblings[j])) {
        run.push(siblings[j]);
        j++;
      }
      out.push(run.length >= collectionMin ? { run } : { single: head });
      i = j;
    }
    return out;
  };

  // ── walker ────────────────────────────────────────────────────────────

  const walkSiblings = (siblings, parentDir, depth) => {
    const out = [];
    for (const item of partition(siblings)) {
      if (item.run) { out.push(collection(item.run)); continue; }
      const r = walkNode(item.single, parentDir, depth);
      if (r === null || r === undefined) continue;
      Array.isArray(r) ? out.push(...r) : out.push(r);
    }
    return out;
  };

  const walkNode = (el, parentDir, depth) => {
    const { flow, ovs } = categorize(el);
    recordOverlays(ovs);

    if (tagOf(el) !== "div") return block(el, "atomic");

    const cs = window.getComputedStyle(el);
    if (hasOwnPaint(cs)) return block(el, "composite");

    if (flow.length === 0)
      return hasDirectText(el) ? block(el, "atomic") : null;

    if (flow.length === 1) return walkNode(flow[0], parentDir, depth);

    const r = el.getBoundingClientRect();
    const myDir = flowDirection(cs, r.width);
    if (myDir === parentDir) return walkSiblings(flow, parentDir, depth);
    if (depth >= containerBudget) return block(el, "composite");
    const kids = walkSiblings(flow, myDir, depth + 1);
    return kids.length ? container(el, kids) : null;
  };

  // ── Step A: descend single-child wrappers (any tag) ──────────────────
  let layoutRoot = sectionEl;
  while (true) {
    const { flow, ovs } = categorize(layoutRoot);
    recordOverlays(ovs);
    if (flow.length !== 1) {
      // Stop at a multi-child element (or a leaf). Section_layout is the
      // only place a grid `columns` array is allowed.
      const layout = layoutOf(layoutRoot, { withColumns: true });
      const tree = flow.length
        ? walkSiblings(flow, layout.direction, 0)
        : [];
      return {
        selector: sectionSelector,
        section_layout: layout,
        tree,
        overlays,
        _counts: counters,
      };
    }
    layoutRoot = flow[0];
  }
};

async function decomposeOne(page, sectionSelector) {
  return await page.evaluate(
    ({ fnSrc, sectionSelector, opts }) => {
      const fn = new Function(`return (${fnSrc})`)();
      return fn(sectionSelector, opts);
    },
    {
      fnSrc: RUN_IN_BROWSER.toString(),
      sectionSelector,
      opts: { containerBudget: 2, collectionMin: 2 },
    },
  );
}

async function main() {
  const sectionsPath = join(sprite, "app", "analysis", "sections.json");
  if (!existsSync(sectionsPath))
    throw new Error(`Missing ${sectionsPath} (run Stage 2 first)`);
  const sections = JSON.parse(await readFile(sectionsPath, "utf8"));
  const handoffDir = join(sprite, "app", "handoff");

  // First page that mentions a section type wins; we decompose each type once.
  const seen = new Set();
  const byPage = new Map();
  for (const [pageId, page] of Object.entries(sections.pages ?? {})) {
    for (const s of page.sections ?? []) {
      if (seen.has(s.type)) continue;
      seen.add(s.type);
      if (!byPage.has(pageId)) byPage.set(pageId, []);
      byPage.get(pageId).push(s);
    }
  }

  const browser = await chromium.launch();
  const out = {};
  let warnings = 0;

  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    for (const [pageId, list] of byPage) {
      const htmlPath = await locateHtml(handoffDir, pageId);
      if (!htmlPath) {
        console.warn(`WARN: no html for page ${pageId} — skipping ${list.length} sections`);
        warnings++;
        continue;
      }
      const page = await ctx.newPage();
      await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
      await quietPage(page);

      for (const s of list) {
        const result = await decomposeOne(page, s.selector);
        if (!result) {
          console.warn(`  WARN: ${s.type}: selector ${s.selector} did not match`);
          warnings++;
          continue;
        }
        const { _counts, ...rest } = result;
        out[s.type] = rest;
        console.log(
          `  ✓ ${s.type}: ${_counts.block} blocks, ${_counts.container} containers, ${_counts.collection} collections, ${_counts.overlay} overlays`,
        );
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  const outPath = join(sprite, "app", "analysis", "section-trees.json");
  await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${outPath} (${warnings} warnings)`);
}

main().catch((e) => {
  console.error("Stage 3 failed:", e);
  process.exit(1);
});
