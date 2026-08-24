# Screenshot PII masking

Masks personally identifiable information (emails, phones, cards, national IDs,
API keys/tokens, `.env` values, credential-labelled secrets, …) out of a
screenshot with docTR OCR + black boxes, so employee-monitoring captures can be
stored **already redacted**.

## Files
- `masking.py` — the masker. `mask_image_bytes(data) -> (masked_bytes, detected)`
  is the in-memory entry point (raw bytes never touch disk); `mask_pii_in_image(path)`
  is the CLI. Detection logic (`analyze_lines`) is pure text, no OCR/torch needed.
- `service.py` — a tiny stdlib HTTP wrapper. `POST /mask` (raw image body →
  masked image body), `GET /health`. No web framework.

## How it's wired into RetainIQ
The desktop-agent no longer PUTs raw screenshots to object storage. Instead:

```
agent captureAndUpload()                         desktop-agent/src/screenshot.ts
  → POST /v1/storage/screenshots/upload (base64) desktop-agent/src/api.ts uploadScreenshot()
    → StorageService.storeMaskedScreenshot()     backend .../modules/storage/storage.service.ts
        → POST {MASKING_SERVICE_URL}/mask         (this service)
        → PutObject(masked) to MinIO/S3           ← only the MASKED image is stored
        → ScreenshotObject metadata (masked size)
```

The raw bytes are processed in memory and **never persisted**. If the masking
service is unreachable the upload fails and nothing is stored (**fail closed**).

## Run the service (local dev)
The repo ships a virtualenv with docTR+torch already installed:

```powershell
# from repo root
ai\.venv\Scripts\python.exe ai\masking\service.py        # listens on :8099
```

Env: `MASKING_PORT` (default 8099), `MASKING_MAX_BYTES`, `OUTPUT_DIR`,
`MAX_DIMENSION`, `ENV_LINE_THRESHOLD`.

The backend reaches it via `MASKING_SERVICE_URL` (default
`http://host.docker.internal:8099`, set in `docker-compose.local.yml`). To run
fresh elsewhere: `pip install -r requirements.txt`.

## CLI
```powershell
ai\.venv\Scripts\python.exe ai\masking\masking.py path\to\screenshot.png
```
