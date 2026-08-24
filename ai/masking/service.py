# ============================================================
# PII masking micro-service (stdlib http.server, no extra deps)
# ============================================================
# A tiny HTTP wrapper around masking.mask_image_bytes so the RetainIQ backend can
# mask a screenshot BEFORE it is stored. Raw bytes are processed in memory and
# never written to disk.
#
#   POST /mask            body = raw image bytes
#                         query: ?format=jpeg|png (default: png), ?env_mode=1|0
#                         headers: X-Output-Format, X-Env-Mode (override query)
#     -> 200  body = masked image bytes
#             headers: Content-Type, X-PII-Count, X-PII-Types
#     -> 400  unreadable image     -> 500  masking failed  (caller should FAIL CLOSED)
#   GET  /health          -> 200 {"status":"ok","model":"loaded|lazy"}
#
# Run:  ai/.venv/Scripts/python.exe ai/masking/service.py   (PORT env, default 8099)

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import masking  # noqa: E402

HOST = os.getenv("MASKING_HOST", "0.0.0.0")
PORT = int(os.getenv("MASKING_PORT", os.getenv("PORT", "8099")))
MAX_BYTES = int(os.getenv("MASKING_MAX_BYTES", str(50 * 1024 * 1024)))  # 50 MB ceiling
_CT = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg"}


def _truthy(v):
    return str(v).strip().lower() in ("1", "true", "yes", "on")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the console quiet; we print our own lines
        pass

    def _send(self, code, body=b"", content_type="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._json(200, {"status": "ok", "model": "loaded" if masking._OCR_MODEL else "lazy"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/mask":
            self._json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        if length > MAX_BYTES:
            self._json(413, {"error": f"image too large (> {MAX_BYTES} bytes)"})
            return

        data = self.rfile.read(length)

        q = parse_qs(parsed.query)
        fmt = (self.headers.get("X-Output-Format") or (q.get("format") or ["png"])[0]).lower()
        if fmt not in _CT:
            fmt = "png"
        env_raw = self.headers.get("X-Env-Mode") or (q.get("env_mode") or [None])[0]
        env_mode = None if env_raw is None else _truthy(env_raw)

        try:
            masked, detected = masking.mask_image_bytes(data, out_format=fmt, env_mode=env_mode)
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001 — fail closed: caller must NOT store the raw
            masking._say(f"❌ masking failed: {exc}")
            self._json(500, {"error": "masking failed"})
            return

        types = ",".join(sorted({t for t, _ in detected}))
        masking._say(f"🖼️  masked {len(data)}B -> {len(masked)}B, {len(detected)} PII item(s) [{types}]")
        self._send(200, masked, _CT[fmt], {"X-PII-Count": str(len(detected)), "X-PII-Types": types})


def main():
    # Warm the OCR model up front so the first real request isn't slow.
    masking._say(f"Masking service starting on {HOST}:{PORT} …")
    try:
        masking.get_ocr_model()
    except Exception as exc:  # noqa: BLE001
        masking._say(f"⚠️  could not preload OCR model: {exc}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    masking._say(f"✅ ready — POST /mask on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
