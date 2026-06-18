#!/usr/bin/env node
/**
 * Stage 4 — Generate block JSX components.
 *
 * For every unique block type listed in <sprite>/app/analysis/blocks.json,
 * locate its DOM in the cropped section HTML (via the block's selector), strip
 * unsafe / framework attributes, transform HTML to JSX (class → className,
 * void self-close, SVG attrs camelCased, inline style → object), wrap in a
 * stateless React functional component, and write to:
 *
 *   <sprite>/app/frontend/src/blocks/<PascalName>.tsx
 *
 * Settings, schemas, page templates, layout / color extraction — out of scope
 * here. Static JSX only.
 *
 * Usage:
 *   node 4-generate-blocks.mjs --sprite <sprite-path>
 */

import { chromium } from "playwright";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ── HTML → JSX transformation tables ───────────────────────────────────────

const HTML_TO_REACT_ATTR = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  enctype: "encType",
  formaction: "formAction",
  formmethod: "formMethod",
  formnovalidate: "formNoValidate",
  formtarget: "formTarget",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  spellcheck: "spellCheck",
  srcset: "srcSet",
  usemap: "useMap",
};

const SVG_ATTR_CAMEL = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-opacity": "strokeOpacity",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "clip-rule": "clipRule",
  "clip-path": "clipPath",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
  "letter-spacing": "letterSpacing",
  "text-anchor": "textAnchor",
  "text-rendering": "textRendering",
  "shape-rendering": "shapeRendering",
  "vector-effect": "vectorEffect",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "color-interpolation": "colorInterpolation",
  "xlink:href": "xlinkHref",
  "xmlns:xlink": "xmlnsXlink",
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  gradienttransform: "gradientTransform",
  gradientunits: "gradientUnits",
  textlength: "textLength",
  patternunits: "patternUnits",
  patterncontentunits: "patternContentUnits",
  spreadmethod: "spreadMethod",
  startoffset: "startOffset",
};

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function htmlToJsx(html) {
  let s = html;

  // Strip HTML comments — they're invalid JSX as-is.
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // Drop residual data-* attributes (Stage 2/3 already cleans, but be safe).
  s = s.replace(/\s+data-[\w-]+(?:="[^"]*")?/g, "");

  // Strip on*-handlers (Stage 2 already cleans, but be safe).
  s = s.replace(/\s+on[a-z]+="[^"]*"/g, "");

  // Convert attribute names inside opening tags.
  s = s.replace(/<([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g, (full, tag, attrs, slash) => {
    let newAttrs = attrs;

    for (const [from, to] of Object.entries(HTML_TO_REACT_ATTR)) {
      newAttrs = newAttrs.replace(
        new RegExp(`\\s${escapeRegex(from)}=`, "gi"),
        ` ${to}=`,
      );
    }
    for (const [from, to] of Object.entries(SVG_ATTR_CAMEL)) {
      newAttrs = newAttrs.replace(
        new RegExp(`\\s${escapeRegex(from)}=`, "gi"),
        ` ${to}=`,
      );
    }

    // Self-close void elements.
    if (VOID_ELEMENTS.has(tag.toLowerCase())) {
      const trimmed = newAttrs.replace(/\/?\s*$/, "");
      return `<${tag}${trimmed} />`;
    }
    return `<${tag}${newAttrs}${slash}>`;
  });

  // Inline style="prop: val; ..." → style={{ prop: 'val', ... }}
  s = s.replace(/style="([^"]*)"/g, (full, css) => {
    const obj = css
      .split(";")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const idx = r.indexOf(":");
        if (idx < 0) return null;
        const k = r.slice(0, idx).trim();
        const value = r.slice(idx + 1).trim();
        const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return `${camel}: '${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
      })
      .filter(Boolean)
      .join(", ");
    return `style={{ ${obj} }}`;
  });

  return s;
}

// ── Component file generation ──────────────────────────────────────────────

function pascalCase(s) {
  return s
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function componentFile(componentName, jsx) {
  return `// Auto-generated from prototype HTML.
import type { FC } from "react";

export const ${componentName}: FC = () => {
  return (
    ${jsx}
  );
};

export default ${componentName};
`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let sprite = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sprite") sprite = args[++i];
  }
  if (!sprite) {
    console.error("Usage: 4-generate-blocks.mjs --sprite <sprite-path>");
    process.exit(1);
  }
  return { sprite: resolve(sprite) };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { sprite } = parseArgs();
  const blocksJsonPath = join(sprite, "app", "analysis", "blocks.json");
  if (!existsSync(blocksJsonPath)) {
    throw new Error(`Missing ${blocksJsonPath}. Run Stage 3 first.`);
  }
  const blocksJson = JSON.parse(await readFile(blocksJsonPath, "utf8"));

  // Collect unique block types: type → { sectionType, selector }.
  const uniqueBlocks = new Map();
  for (const [sectionType, blocks] of Object.entries(blocksJson)) {
    for (const blk of blocks) {
      if (!uniqueBlocks.has(blk.type)) {
        uniqueBlocks.set(blk.type, { sectionType, selector: blk.selector });
      }
    }
  }

  // Group by section so we load each section HTML only once.
  const bySection = new Map();
  for (const [type, info] of uniqueBlocks) {
    if (!bySection.has(info.sectionType)) bySection.set(info.sectionType, []);
    bySection.get(info.sectionType).push({ type, selector: info.selector });
  }

  const outDir = join(sprite, "app", "frontend", "src", "blocks");
  if (existsSync(outDir)) await rm(outDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  let written = 0;
  const warnings = [];

  try {
    for (const [sectionType, blocks] of bySection) {
      const sectionHtmlPath = join(
        sprite,
        "app",
        "analysis",
        "sections",
        `${sectionType}.html`,
      );
      if (!existsSync(sectionHtmlPath)) {
        warnings.push(`Missing ${sectionHtmlPath}, skipping ${blocks.length} blocks`);
        continue;
      }
      const sectionHtml = await readFile(sectionHtmlPath, "utf8");

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(
        `<!DOCTYPE html><html><body>${sectionHtml}</body></html>`,
      );

      for (const { type, selector } of blocks) {
        const outerHtml = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return el ? el.outerHTML : null;
        }, selector);

        if (!outerHtml) {
          warnings.push(`${type}: selector did not match in ${sectionType}`);
          continue;
        }

        const jsx = htmlToJsx(outerHtml);
        const componentName = pascalCase(type);
        const file = componentFile(componentName, jsx);
        const outPath = join(outDir, `${componentName}.tsx`);
        await writeFile(outPath, file);
        console.log(`  ✓ ${componentName}.tsx`);
        written++;
      }

      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\nWrote ${written} block components to src/blocks/`);
  for (const w of warnings) console.warn(`WARN: ${w}`);
  console.log(`\n✅ Stage 4 complete`);
}

main().catch((err) => {
  console.error("Stage 4 failed:", err);
  process.exit(1);
});
