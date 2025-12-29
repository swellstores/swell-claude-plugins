import Anthropic from "@anthropic-ai/sdk";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import prettier from "prettier";
import { registerSchema } from "@hyperjump/json-schema/draft-2020-12";
import { bundle } from "@hyperjump/json-schema/bundle";
import { SCHEMAS } from "./config.js";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize R2 client
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const CACHE_CONTROL = "public, max-age=3600";

/**
 * Detect which schema files changed in the current commit
 */
function detectChangedSchemas() {
  console.log("Detecting changed schema files...\n");

  const changedFiles = execSync("git diff --name-only HEAD^ HEAD -- schema/", {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => f && f.endsWith(".json") && !f.includes("bundle"));

  console.log("Changed files:", changedFiles);

  // Map changed files to schema configs
  const changedSchemas = SCHEMAS.filter((schema) =>
    changedFiles.includes(schema.input)
  );

  console.log(
    `\nFound ${changedSchemas.length} schema(s) to process:`,
    changedSchemas.map((s) => s.input)
  );

  return changedSchemas;
}

/**
 * Upload a file to R2 storage
 */
async function uploadToR2(key, content, contentType) {
  console.log(`  Uploading to R2: ${key}`);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: content,
    ContentType: contentType,
    CacheControl: CACHE_CONTROL,
  });

  await r2Client.send(command);
}

/**
 * Upload all raw schema files to R2 bucket root
 */
async function uploadRawSchemas() {
  console.log("\n--- Uploading raw schemas to R2 ---");

  const schemaDir = "schema";
  const files = readdirSync(schemaDir).filter(
    (file) => file.endsWith(".json") && !file.includes("bundle")
  );

  for (const file of files) {
    const filePath = join(schemaDir, file);
    const content = readFileSync(filePath, "utf8");
    await uploadToR2(file, content, "application/json");
  }

  console.log(`  ✓ Uploaded ${files.length} raw schema files`);
}

/**
 * Register all schema files for bundling
 */
function registerAllSchemas(schemaPath) {
  const schemaDir = dirname(schemaPath);
  const files = readdirSync(schemaDir).filter(
    (file) => file.endsWith(".json") && !file.includes("bundle")
  );

  for (const file of files) {
    const filePath = join(schemaDir, file);
    try {
      const content = readFileSync(filePath, "utf8");
      const schema = JSON.parse(content);
      if (schema.$id) {
        registerSchema(schema);
      }
    } catch (error) {
      // Skip files that can't be registered
    }
  }
}

/**
 * Bundle a JSON schema
 */
async function bundleSchema(schemaPath) {
  registerAllSchemas(schemaPath);

  const mainSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const schemaId = mainSchema.$id;

  if (!schemaId) {
    throw new Error(`Schema at ${schemaPath} must have an $id property`);
  }

  const bundled = await bundle(schemaId);
  return JSON.stringify(bundled, null, 2);
}

/**
 * Generate TypeScript definitions using json2ts and Claude
 */
async function generateTypes(config) {
  console.log(`  Converting to TypeScript...`);

  const schemaDir = dirname(config.input);
  const schemaFileName = config.input.split("/").pop();

  // Run json2ts
  const typescriptContent = execSync(
    `json2ts ${schemaFileName} ` +
      `--declareExternallyReferenced ` +
      `--no-enableConstEnums ` +
      `--no-additionalProperties ` +
      `--ignoreMinAndMaxItems ` +
      `--bannerComment=''`,
    {
      encoding: "utf8",
      cwd: schemaDir,
    }
  );

  console.log(`  Sending to Claude for cleanup...`);

  // Read prompt template
  const promptTemplate = readFileSync(config.promptFile, "utf8");
  const prompt = promptTemplate.replace(
    "<d.ts></d.ts>",
    `<d.ts>\n${typescriptContent}\n</d.ts>`
  );

  // Process with Claude
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 20000,
    temperature: 1,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    ],
    thinking: {
      type: "enabled",
      budget_tokens: 16000,
    },
  });

  // Extract content from <result> tags
  const responseText =
    msg.content.find((block) => block.type === "text")?.text || "";
  const resultMatch = responseText.match(/<result>([\s\S]*?)<\/result>/);

  if (!resultMatch) {
    console.error("No <result> tag found in Claude's response");
    throw new Error("Failed to extract result from Claude's response");
  }

  // Format with Prettier
  let processedContent = await prettier.format(resultMatch[1].trim(), {
    parser: "typescript",
    semi: true,
    singleQuote: false,
    trailingComma: "es5",
    tabWidth: 2,
  });

  return processedContent;
}

/**
 * Process a single schema: generate types, bundle, upload bundled schema
 */
async function processSchema(config) {
  console.log(`\n--- Processing ${config.input} ---`);

  // 1. Generate TypeScript definitions
  const typesContent = await generateTypes(config);
  writeFileSync(config.output, typesContent, "utf8");
  console.log(`  ✓ Written types to ${config.output}`);

  // 2. Bundle schema
  console.log(`  Bundling schema...`);
  const bundledSchema = await bundleSchema(config.input);

  // 3. Upload bundled schema to R2
  await uploadToR2(config.r2Keys.bundled, bundledSchema, "application/json");
  console.log(`  ✓ Uploaded bundled schema`);
}

/**
 * Validate required environment variables
 */
function validateEnv() {
  const required = [
    "ANTHROPIC_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      console.error(`Error: Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  validateEnv();

  // 1. Detect changed schemas
  const changedSchemas = detectChangedSchemas();

  if (changedSchemas.length === 0) {
    console.log("\nNo schema changes detected. Nothing to process.");
    return;
  }

  // 2. Upload all raw schemas to R2
  await uploadRawSchemas();

  // 3. Process each changed schema
  for (const schema of changedSchemas) {
    try {
      await processSchema(schema);
    } catch (error) {
      console.error(`\n❌ Failed to process ${schema.input}:`, error);
      process.exit(1);
    }
  }

  console.log("\n✓ All changed schemas processed successfully");
  console.log("  Types will be committed by the workflow");
  console.log("  Types will be uploaded to R2 by sync-types workflow");
}

main();
