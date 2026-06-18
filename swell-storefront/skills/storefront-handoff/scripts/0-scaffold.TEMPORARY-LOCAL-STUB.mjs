#!/usr/bin/env node
/* eslint-disable -- TEMPORARY-LOCAL-SCAFFOLD */
//
// ╔══════════════════════════════════════════════════════════════════╗
// ║  TEMPORARY-LOCAL-SCAFFOLD — REMOVE WHEN HANDOFF PIPELINE LANDS   ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║                                                                  ║
// ║  This script is a stand-in for `swell theme init` and exists     ║
// ║  ONLY while:                                                     ║
// ║    (a) storefront-react-ai-template is not yet pushed to github  ║
// ║    (b) @swell/storefront-app-sdk-{core,react} are not yet on npm ║
// ║                                                                  ║
// ║  When BOTH are published:                                        ║
// ║    1. Delete this file (scripts/scaffold.TEMPORARY-LOCAL-STUB)   ║
// ║    2. Remove Stage 0 invocation from SKILL.md                    ║
// ║    3. Document `swell theme init` as the prerequisite instead    ║
// ║    4. Remove the corresponding task from the tracker             ║
// ║    5. Search the codebase for `TEMPORARY-LOCAL-SCAFFOLD` to      ║
// ║       find any remaining references                              ║
// ║                                                                  ║
// ╚══════════════════════════════════════════════════════════════════╝
//
/**
 * Stage 0 — Scaffold a Swell Storefront sprite from a Claude design handoff URL.
 *
 * Sprite is scaffolded INTO the current working directory (cwd IS sprite root).
 * Subsequent stages (1, 2, ...) operate on cwd without requiring navigation.
 *
 * Pipeline:
 *   1. Verify cwd does not already contain `app/`
 *   2. Download the handoff tarball and extract into <cwd>/app/handoff/
 *      (--strip-components=1: wrapper dir flattened)
 *   3. Copy storefront-react-ai-template into <cwd>/app/frontend/
 *   4. Write placeholder <cwd>/app/swell.json + app/package.json + tsconfig + .gitignore + assets/ + settings/
 *   5. Run `bun install` at <cwd>/app/ (workspace install)
 *   6. Link local SDK packages via `bun link`
 *   7. Install Playwright Chromium (for Stage 2)
 *
 * Usage:
 *   node 0-scaffold.TEMPORARY-LOCAL-STUB.mjs --handoff-url <url>
 *
 * The skill orchestrator's Step 0b reads <cwd>/app/handoff/README.md and
 * refines the manifest's `id`/`name`/`description` from the project name.
 */

import { mkdir, cp, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// Local checkout paths — replace with C3 + npm publish when released.
const TEMPLATE_DIR = "/Users/vladislav/Projects/storefront-react-ai-template";
const SDK_CORE = "/Users/vladislav/Projects/storefront-app-sdk/packages/core";
const SDK_REACT = "/Users/vladislav/Projects/storefront-app-sdk/packages/react";

const COPY_EXCLUDES = ["/node_modules", "/.git", "/dist", "/.wrangler", "/.vite", ".DS_Store"];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { handoffUrl: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--handoff-url") opts.handoffUrl = args[++i];
  }
  if (!opts.handoffUrl) {
    console.error("Usage: 0-scaffold.TEMPORARY-LOCAL-STUB.mjs --handoff-url <url>");
    console.error("Sprite is scaffolded into the current working directory.");
    process.exit(1);
  }
  return opts;
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n❌ ${cmd} ${args.join(" ")} failed in ${cwd}`);
    process.exit(result.status || 1);
  }
}

function bash(cmd, opts = {}) {
  return spawnSync("bash", ["-c", cmd], { encoding: "utf8", ...opts });
}

function downloadAndExtract(url, targetDir) {
  const tmpFile = join(tmpdir(), `handoff-${randomBytes(4).toString("hex")}.tar.gz`);
  console.log(`  → downloading handoff`);
  const dl = bash(`curl -fsSL ${JSON.stringify(url)} -o ${JSON.stringify(tmpFile)}`, {
    stdio: "inherit",
  });
  if (dl.status !== 0) {
    console.error(`\n❌ Failed to download handoff from ${url}`);
    process.exit(dl.status || 1);
  }
  console.log(`  → extracting into app/handoff/`);
  // --strip-components=1 flattens the bundle (drops the project-name wrapper dir),
  // matching the existing handoff convention.
  const ex = bash(
    `tar xz --strip-components=1 -C ${JSON.stringify(targetDir)} -f ${JSON.stringify(tmpFile)}`,
    { stdio: "inherit" },
  );
  if (ex.status !== 0) {
    console.error("Failed to extract handoff tarball");
    process.exit(ex.status || 1);
  }
  return tmpFile;
}

async function main() {
  const opts = parseArgs();

  if (!existsSync(TEMPLATE_DIR)) {
    console.error(`Template directory not found: ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  // 1. Sprite is scaffolded INTO the current working directory.
  const out = resolve(process.cwd());
  const appDir = join(out, "app");
  const frontendDir = join(appDir, "frontend");
  const handoffDir = join(appDir, "handoff");

  if (existsSync(appDir)) {
    console.error(
      `${appDir} already exists — remove it (or run from an empty directory) before scaffolding.`,
    );
    process.exit(1);
  }

  console.log(`Stage 0: Scaffolding sprite at ${out}`);
  await mkdir(appDir, { recursive: true });
  await mkdir(handoffDir, { recursive: true });

  // 2. Download + extract handoff (wrapper dir preserved).
  const tarFile = downloadAndExtract(opts.handoffUrl, handoffDir);
  await rm(tarFile).catch(() => {});

  // 3. Copy template.
  console.log(`  → copying template into app/frontend/`);
  await cp(TEMPLATE_DIR, frontendDir, {
    recursive: true,
    filter: (src) => !COPY_EXCLUDES.some((ex) => src.includes(ex)),
  });

  // 4. Write app-level files (swell.json, package.json, tsconfig.json, .gitignore)
  //    with generic placeholders. The skill orchestrator reads the handoff README
  //    in a follow-up step and refines `id`/`name`/`description` in both
  //    swell.json and package.json (they must stay in sync).
  const swellJsonPath = join(appDir, "swell.json");
  if (!existsSync(swellJsonPath)) {
    const manifest = {
      description: "",
      id: "storefront",
      name: "Storefront",
      type: "storefront",
      version: "1.0.0",
      permissions: [],
      storefront: {
        theme: {},
      },
    };
    await writeFile(swellJsonPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`  → wrote app/swell.json (placeholders; refine from handoff README)`);
  }

  const appPackageJsonPath = join(appDir, "package.json");
  if (!existsSync(appPackageJsonPath)) {
    const appPackage = {
      description: "",
      devDependencies: {
        "@swell/app-types": "^1.0.5",
        typescript: "^5.9.3",
      },
      name: "storefront",
      private: true,
      scripts: {
        typecheck:
          "([ -z \"$(find functions -name '*.ts' 2>/dev/null | head -1)\" ] || tsc --noEmit) " +
          "&& ([ ! -f test/tsconfig.json ] || tsc --build --noEmit test) " +
          "&& ([ ! -f frontend/tsconfig.json ] || tsc --build --noEmit frontend)",
      },
      version: "1.0.0",
      workspaces: ["frontend"],
    };
    await writeFile(appPackageJsonPath, JSON.stringify(appPackage, null, 2) + "\n");
    console.log(`  → wrote app/package.json (workspace root)`);
  }

  const appTsconfigPath = join(appDir, "tsconfig.json");
  if (!existsSync(appTsconfigPath)) {
    const appTsconfig = {
      compilerOptions: {
        lib: ["esnext", "webworker"],
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        types: ["@swell/app-types"],
      },
      exclude: ["node_modules", "frontend", "test", "vitest.config.ts"],
    };
    await writeFile(appTsconfigPath, JSON.stringify(appTsconfig, null, 2) + "\n");
    console.log(`  → wrote app/tsconfig.json`);
  }

  const appGitignorePath = join(appDir, ".gitignore");
  if (!existsSync(appGitignorePath)) {
    await writeFile(appGitignorePath, "node_modules\n");
    console.log(`  → wrote app/.gitignore`);
  }

  // 4a. Convention dirs.
  await mkdir(join(appDir, "assets"), { recursive: true });
  await mkdir(join(appDir, "settings"), { recursive: true });

  // 4b. Sprite-root .gitignore (so `git init` here doesn't pull in node_modules,
  //     downloaded handoff, or intermediate analysis output).
  const spriteGitignorePath = join(out, ".gitignore");
  if (!existsSync(spriteGitignorePath)) {
    const gitignore = [
      "# Build artifacts",
      "app/node_modules",
      "app/frontend/node_modules",
      "app/frontend/dist",
      "app/frontend/.wrangler",
      "app/frontend/.vite",
      "app/frontend/tsconfig.tsbuildinfo",
      "",
      "# Downloaded handoff bundle",
      "app/handoff/",
      "",
      "# Per-stage analysis artifacts",
      "app/analysis/",
      "",
      "# OS",
      ".DS_Store",
      "",
    ].join("\n");
    await writeFile(spriteGitignorePath, gitignore);
    console.log(`  → wrote .gitignore (sprite root)`);
  }

  // 5. Install (bun workspace install at app level — pulls in frontend deps too).
  console.log(`  → bun install in app/`);
  run("bun", ["install", "--silent"], appDir);

  // 6. Link local SDK into the frontend workspace via bun link.
  console.log(`  → registering local SDK packages globally (bun link)`);
  run("bun", ["link"], SDK_CORE);
  run("bun", ["link"], SDK_REACT);

  console.log(`  → linking SDK into app/frontend/ (bun link)`);
  run(
    "bun",
    ["link", "@swell/storefront-app-sdk-core", "@swell/storefront-app-sdk-react"],
    frontendDir,
  );

  // 6a. Install Playwright browsers (Chromium) — used by Stage 2 extraction.
  // Idempotent: skips if Chromium is already cached.
  console.log(`  → installing Playwright Chromium (cached if already present)`);
  run("bunx", ["playwright", "install", "chromium"], frontendDir);

  // 7. Report what landed inside app/handoff (for orchestrator awareness).
  let handoffEntries = [];
  try {
    handoffEntries = await readdir(handoffDir);
  } catch {}

  console.log(`\n✅ Scaffolded sprite at ${out}`);
  console.log(`     app/swell.json    — manifest (placeholders)`);
  console.log(`     app/package.json  — workspace root (placeholders)`);
  console.log(`     app/tsconfig.json — app-level TS config`);
  console.log(`     app/frontend/     — Swell Storefront app (SDK linked via bun link)`);
  console.log(`     app/handoff/      — extracted prototype: ${handoffEntries.join(", ")}`);
}

main().catch((err) => {
  console.error("Scaffold failed:", err);
  process.exit(1);
});
