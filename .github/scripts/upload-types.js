import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

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
const TYPES_DIR = "types";

/**
 * Upload a file to R2 storage
 */
async function uploadToR2(key, content, contentType) {
  console.log(`Uploading: ${key}`);

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
 * Upload all .d.ts files from types/ directory to R2
 */
async function uploadAllTypes() {
  console.log(`Reading type files from ${TYPES_DIR}/\n`);

  // Get all .d.ts files from types directory
  const files = readdirSync(TYPES_DIR).filter((file) => file.endsWith(".d.ts"));

  console.log(`Found ${files.length} type file(s) to upload\n`);

  // Upload each file to types/ path in R2
  for (const file of files) {
    const filePath = join(TYPES_DIR, file);
    const content = readFileSync(filePath, "utf8");
    const r2Key = `types/${file}`;

    await uploadToR2(r2Key, content, "application/typescript");
  }

  return files.length;
}

/**
 * Validate required environment variables
 */
function validateEnv() {
  const required = [
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

  console.log(`Uploading types to R2 bucket: ${BUCKET_NAME}\n`);

  try {
    const count = await uploadAllTypes();
    console.log(`\n✓ Successfully uploaded ${count} type file(s) to R2`);
  } catch (error) {
    console.error("Failed to upload types:", error);
    process.exit(1);
  }
}

main();
