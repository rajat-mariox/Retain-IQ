// Uploads real screenshot images to MinIO/S3 and emits the ScreenshotObject
// INSERT SQL. Each row is a distinct object (key is unique) whose bytes are a
// copy of one of the images in the seed folder, attributed to a random employee.
//
// Usage: node seed-screenshots.mjs <pairsCsv> <imageDir> <outSqlFile>
//   pairsCsv: lines of "orgId,employeeId"
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const [, , pairsCsv, imageDir, outSql] = process.argv;
const BUCKET = process.env.S3_BUCKET ?? "retainiq-screenshots";
const PREFIX = "screenshots/";
const MIN_PER_EMP = 5;
const MAX_PER_EMP = 18;

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER ?? "minioadmin",
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? "minioadmin",
  },
});

const CT_BY_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function loadImages(dir) {
  const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (!files.length) throw new Error(`No images found in ${dir}`);
  return files.map((f) => {
    const buf = readFileSync(`${dir}/${f}`);
    const ext = f.split(".").pop().toLowerCase();
    return { name: f, buf, size: buf.length, contentType: CT_BY_EXT[ext] ?? "image/jpeg", ext: ext === "jpeg" ? "jpg" : ext };
  });
}

/** Remove previously-seeded objects (key contains "/seed/") so re-runs are clean. */
async function clearSeedObjects() {
  let token;
  let removed = 0;
  do {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    const keys = (list.Contents ?? []).filter((o) => o.Key?.includes("/seed/")).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys, Quiet: true } }));
      removed += keys.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

const rng = (n) => Math.floor(Math.random() * n);

const images = loadImages(imageDir);
const pairs = readFileSync(pairsCsv, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split(","));

const cleared = await clearSeedObjects();
console.error(`Cleared ${cleared} old seed objects.`);

const values = [];
for (const [orgId, employeeId] of pairs) {
  const n = MIN_PER_EMP + rng(MAX_PER_EMP - MIN_PER_EMP + 1);
  for (let i = 0; i < n; i++) {
    const img = images[rng(images.length)];
    const key = `${PREFIX}${orgId}/${employeeId}/seed/${randomUUID()}.${img.ext}`;
    const capturedAt = new Date(Date.now() - rng(30) * 86400000 - rng(86400000)).toISOString();
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: img.buf, ContentType: img.contentType }));
    values.push(
      `(gen_random_uuid(),'${orgId}'::uuid,'${employeeId}'::uuid,'${key}',${img.size},'${img.contentType}','${capturedAt}',now())`,
    );
  }
}

const sql =
  `INSERT INTO "ScreenshotObject" (id,"orgId","employeeId",key,"sizeBytes","contentType","capturedAt","createdAt") VALUES\n` +
  values.join(",\n") +
  ";\n";
writeFileSync(outSql, sql);
console.error(`Uploaded ${values.length} screenshots to MinIO across ${pairs.length} employees; SQL written to ${outSql}.`);
