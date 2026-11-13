#!/usr/bin/env bash
# Demo screenshot storage. Uploads REAL images (from seed-screenshots/) to MinIO
# and records a ScreenshotObject row per object, attributed to a random employee
# — so the gallery shows actual images. Idempotent: clears prior seed rows +
# objects first. Swap the images in backend/scripts/seed-screenshots/ for your own.
#
#   bash backend/scripts/seed-storage-demo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

IMG_DIR=backend/scripts/seed-screenshots
PAIRS=/tmp/retainiq_emp_pairs.csv
INSERT_SQL=/tmp/retainiq_ss_insert.sql
ID_DB="docker exec -i retainiq-identity-db psql -U identity -d retainiq-identity -v ON_ERROR_STOP=1"

if [ -z "$(find "$IMG_DIR" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print -quit 2>/dev/null)" ]; then
  echo "No images in $IMG_DIR — add some screenshots there first." >&2
  exit 1
fi

# 1) Clear prior seed metadata (objects are cleared by the uploader).
$ID_DB -c "DELETE FROM \"ScreenshotObject\" WHERE key LIKE 'screenshots/%/seed/%';" >/dev/null

# 2) (orgId,employeeId) pairs for all live orgs' employees.
$ID_DB -tAc "SELECT o.id || ',' || e.id FROM \"Organization\" o JOIN \"Employee\" e ON e.\"orgId\" = o.id WHERE o.status <> 'DELETED';" > "$PAIRS"
echo "employees: $(wc -l < "$PAIRS")"

# 3) Upload real images to MinIO + emit INSERT SQL.
node backend/scripts/seed-screenshots.mjs "$PAIRS" "$IMG_DIR" "$INSERT_SQL"

# 4) Apply rows, then report.
$ID_DB < "$INSERT_SQL" >/dev/null
$ID_DB -c "SELECT count(*) AS screenshots, pg_size_pretty(SUM(\"sizeBytes\")) AS total, count(DISTINCT \"orgId\") AS orgs FROM \"ScreenshotObject\";"
rm -f "$PAIRS" "$INSERT_SQL"
echo "storage demo seed complete (real images in MinIO)."
