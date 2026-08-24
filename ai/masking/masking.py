# ============================================================
# PII Masking from Screenshot using docTR OCR (Local / Non-Colab)
# ============================================================
#
# Install dependencies once:
#   pip install python-doctr[torch] python-dotenv
#
# (If you have a GPU + CUDA installed, torch will use it automatically.)
#
# What gets masked
#   1. PII PATTERNS  - emails, phones, cards, national IDs, keys, tokens ...
#      Every pattern is matched CASE-INSENSITIVELY and is run both on each
#      OCR word and on the whole OCR line, so a value that OCR split into
#      several word boxes ("4111 1111 1111 1111", "john @ acme.com") is still
#      caught. Per-type validators stop the false positives that pure
#      case-insensitive matching would otherwise create (e.g. every 8-letter
#      word looking like a SWIFT code).
#   2. CREDENTIAL LABELS - "Password:", "API key", "Account Number" ... in any
#      casing / punctuation, whether the value sits in the same OCR token
#      ("api_key=abc", "PIN1234"), in the next word, or - for phrase-style
#      secrets such as seed phrases - in the rest of the line.
#   3. .env SCREENSHOTS - if the image shows a .env file (the file name is
#      visible, or the page contains several KEY=VALUE lines) EVERY env
#      variable value is masked. Outside env mode, values of sensitive-looking
#      keys (DB_PASSWORD=..., STRIPE_API_KEY=...) are still masked.
#
# The detection logic (analyze_lines) is pure text and has no OCR / torch
# dependency, so it can be unit-tested without a model.

import math
import os
import re
import sys

# Optional: load config (e.g. output folder, max dimension) from a local .env file
try:
    from dotenv import load_dotenv
    load_dotenv(".env")  # looks for a .env file in the current directory
except ImportError:
    pass  # dotenv is optional locally; skip if not installed

def _say(message=""):
    """print() that survives consoles which cannot encode emoji (Windows cp1252 pipes)."""
    try:
        print(message)
    except UnicodeEncodeError:
        print(str(message).encode("ascii", "replace").decode("ascii"))


# ============================================================
# CONFIG
# ============================================================
def _env_int(name, default, minimum=None):
    """Read an integer setting from the environment, falling back safely."""
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        _say(f"⚠️  {name}={raw!r} is not an integer; using default {default}")
        return default
    if minimum is not None and value < minimum:
        _say(f"⚠️  {name}={value} is below the minimum {minimum}; using {minimum}")
        return minimum
    return value


# Where masked images get saved. Defaults to a local "masked_output" folder,
# but can be overridden via a .env file: OUTPUT_DIR=/some/path
OUTPUT_DIR = (os.getenv("OUTPUT_DIR") or "").strip() or "./masked_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# OCR runs on a copy downscaled to this max side length (0 = never downscale).
MAX_DIMENSION = _env_int("MAX_DIMENSION", 1600, minimum=0)

# Number of KEY=VALUE lines that, even without a visible ".env" file name,
# makes us treat the screenshot as an env file and mask every value.
ENV_LINE_THRESHOLD = _env_int("ENV_LINE_THRESHOLD", 3, minimum=1)

# Image formats we can safely write to. Anything else is saved as PNG.
_WRITABLE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff", ".gif"}
_NO_ALPHA_EXTS = {".jpg", ".jpeg", ".bmp"}


# ============================================================
# PII PATTERNS  (all compiled case-insensitively)
# ============================================================
_PII_PATTERN_SOURCES = {
    "email": r"[\w.\-+]+@[\w\-]+\.[\w.\-]+",
    "phone": r"(\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{3,4}\b",
    "credit_card": r"\b(?:\d[ -]?){13,16}\b",
    "aadhaar": r"\b\d{4}\s?\d{4}\s?\d{4}\b",
    "pan_card": r"\b[A-Z]{5}\d{4}[A-Z]\b",
    "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    "ip_address": r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
    "date_of_birth": r"\b(0[1-9]|[12]\d|3[01])[/\-.](0[1-9]|1[0-2])[/\-.]\d{2,4}\b",
    "ifsc_code": r"\b[A-Z]{4}0[A-Z0-9]{6}\b",

    # --- Additional standalone value patterns ---
    "otp": r"\b\d{4,8}\b",
    "cvv": r"\b\d{3,4}\b",
    "passport_number": r"\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b",
    "voter_id": r"\b[A-Z]{3}\d{7}\b",
    "gst_number": r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b",
    "upi_id": r"[\w.\-]+@[A-Z]{2,}",
    "swift_code": r"\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b",
    "mac_address": r"\b([0-9A-F]{2}[:-]){5}([0-9A-F]{2})\b",
    "bank_account_number": r"\b\d{9,18}\b",
    "vehicle_number": r"\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}\b",
    "jwt_token": r"\bey[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b",
    "aws_access_key": r"\b(AKIA|ASIA)[A-Z0-9]{16}\b",
    "api_key_generic": r"\b[A-Z0-9_\-]{24,}\b",
    "bitcoin_address": r"\b(bc1|[13])[A-HJ-NP-Z0-9]{25,39}\b",
    "url_with_credentials": r"\bhttps?://[^\s:@/]+:[^\s@]+@\S+",
}
PII_PATTERNS = {
    name: re.compile(src, re.IGNORECASE) for name, src in _PII_PATTERN_SOURCES.items()
}


def _is_upper(text):
    """True if the text has letters and none of them are lowercase."""
    return any(c.isalpha() for c in text) and text == text.upper()


def _valid_ip(text):
    try:
        return all(0 <= int(octet) <= 255 for octet in text.split("."))
    except ValueError:
        return False


# Extra checks a regex match must pass. These keep case-insensitive matching
# from flagging ordinary words (e.g. "software" as a SWIFT code, or
# "in 5 of 2024" as a vehicle registration).
PII_VALIDATORS = {
    "ip_address": _valid_ip,
    "swift_code": lambda t: any(c.isdigit() for c in t) or _is_upper(t),
    "vehicle_number": lambda t: _is_upper(t) or not re.search(r"\s", t),
    "api_key_generic": lambda t: any(c.isdigit() for c in t)
    or (any(c.islower() for c in t) and any(c.isupper() for c in t)),
    "bitcoin_address": lambda t: any(c.isdigit() for c in t),
}


def find_pii(text):
    """
    Return every validated PII match in `text` as a list of
    (pii_type, start, end) tuples, in pattern order. Case-insensitive.
    """
    found = []
    for pii_type, pattern in PII_PATTERNS.items():
        validator = PII_VALIDATORS.get(pii_type)
        for m in pattern.finditer(text):
            matched = m.group(0)
            if not matched.strip():
                continue
            if validator and not validator(matched):
                continue
            found.append((pii_type, m.start(), m.end()))
    return found


def is_pii(word_text):
    """Return the PII type name if word matches any pattern, else None."""
    if not word_text:
        return None
    matches = find_pii(word_text)
    return matches[0][0] if matches else None


# ============================================================
# CREDENTIAL LABELS
# ============================================================
# Label words: if seen (in any casing / punctuation), mask them AND the value
# that follows. Hyphens stand for "optional separator", so "api-key" matches
# "api key", "api_key", "API-KEY", "ApiKey" and is also recognised when OCR
# splits it into separate word boxes ("Account" "Number:").
SENSITIVE_KEYWORDS = {
    "password", "passwd", "pwd", "pass", "passcode", "passphrase", "pass-phrase",
    "pin", "mpin", "upi-pin", "atm-pin", "pin-code",
    "otp", "otp-code", "cvv", "cvv2", "cvc", "verification-code",
    "secret", "secret-key", "client-secret", "api-secret",
    "apikey", "api-key", "access-key", "access-key-id", "secret-access-key",
    "token", "auth-token", "access-token", "refresh-token", "bearer", "authorization",
    "ssn", "aadhaar", "aadhar", "aadhaar-number", "pan", "pan-number",
    "account-number", "account-no", "acc-no", "acct-no", "a/c-no", "iban",
    "routing-number", "sort-code", "card-number", "card-no", "credit-card",
    "license-number", "licence-number", "passport-number",
    "security-code", "recovery-code", "backup-code",
    "private-key", "seed-phrase", "mnemonic",
    "dob", "date-of-birth",
}

# Labels whose value is usually many words long -> mask the rest of the line.
MASK_REST_OF_LINE_KEYWORDS = {
    "seed-phrase", "mnemonic", "private-key", "recovery-code", "backup-code",
    "passphrase", "pass-phrase", "authorization",
}


def _keyword_key(keyword):
    """Canonical form of a keyword: lowercase alphanumerics only."""
    return re.sub(r"[^a-z0-9]", "", keyword.lower())


def _keyword_regex(keyword):
    parts = [p for p in re.split(r"[-_\s]+", keyword) if p]
    return r"[\s_\-]?".join(re.escape(p) for p in parts)


_LABEL_ALTERNATION = "|".join(
    sorted({_keyword_regex(k) for k in SENSITIVE_KEYWORDS}, key=len, reverse=True)
)
# Matches a window of 1-3 OCR words that starts with a credential label:
#   "Password"        -> bare label            (value is the next word)
#   "Password:"       -> label + separator      (value is the next word)
#   "password:hunter2"-> label + sep + value    (value inside the window)
#   "PIN1234"         -> label glued to digits  (value inside the window)
# A label must be followed by a separator, digits or nothing so that
# "passport" / "pinned" / "tokens" are NOT treated as labels.
_LABEL_RE = re.compile(
    r"^[\W_]*(?P<label>" + _LABEL_ALTERNATION + r")"
    r"(?:(?P<sep>[\W_]*[:=\-–—>|→][\W_]*)(?P<value>.*)"
    r"|(?P<digits>\d\S*)"
    r"|[\W_]*)$",
    re.IGNORECASE | re.DOTALL,
)
_MASK_REST_KEYS = {_keyword_key(k) for k in MASK_REST_OF_LINE_KEYWORDS}
# Tokens that may sit between a label and its value: ":", "=", "->", "is" ...
_FILLER_RE = re.compile(r"^(?:[\W_]+|is|was|=>)$", re.IGNORECASE)


def _has_content(text):
    """True if the text contains at least one letter or digit."""
    return bool(text) and re.search(r"[^\W_]", text) is not None


# ============================================================
# .env DETECTION
# ============================================================
# A visible env file name anywhere in the OCR text: ".env", ".env.local",
# "backend/.env", "`.env.production`", "env.example" ...
_ENV_FILE_HINT = re.compile(
    r"(?<![\w-])\.env(?:\.[\w-]+)*(?![\w-])"
    r"|(?<![\w.-])env\.(?:local|dev|development|prod|production|staging|stage"
    r"|test|testing|example|sample|template)\b",
    re.IGNORECASE,
)
# KEY=VALUE  /  export KEY=VALUE  /  - KEY=VALUE  (docker-compose style).
# The key tolerates spaces because OCR often drops underscores ("DB HOST").
# "==", "!=", "<=", ">=" are not assignments.
_ENV_ASSIGNMENT = re.compile(
    r"^\s*(?:[-*•]\s*)?(?:export\s+)?"
    r"(?P<key>[A-Za-z_][\w.\-]*(?:[ \t]+[A-Za-z_][\w.\-]*)*?)"
    r"[ \t]*(?<![=!<>])=(?!=)[ \t]*"
    r"(?P<value>.*?)\s*$",
    re.DOTALL,
)
_UPPER_ENV_KEY = re.compile(r"^[A-Z][A-Z0-9_]+$")

# Keys whose value is masked even when the screenshot is NOT an env file.
_SENSITIVE_KEY_SUBSTRINGS = (
    "secret", "password", "passwd", "pwd", "token", "key", "auth", "credential",
    "private", "salt", "dsn", "cert", "webhook", "cookie", "signing", "session",
    "database", "db_", "smtp", "license", "licence", "mongo", "redis", "postgres",
    "mysql", "connection",
)
_SENSITIVE_KEY_TOKENS = {"pin", "otp", "sid", "pass", "api", "db", "jwt", "aws"}


def _key_is_sensitive(key):
    lowered = key.lower()
    if any(fragment in lowered for fragment in _SENSITIVE_KEY_SUBSTRINGS):
        return True
    tokens = re.split(r"[^a-z0-9]+", lowered)
    return any(tok in _SENSITIVE_KEY_TOKENS for tok in tokens)


def _env_assignment(line_text):
    """Return the regex match if the line is a KEY=VALUE assignment with a value."""
    m = _ENV_ASSIGNMENT.match(line_text)
    if m and _has_content(m.group("value")):
        return m
    return None


def detect_env_mode(line_texts):
    """
    Decide whether the OCR'd page is a .env file.

    Returns (env_mode, info) where info = {"hint": bool, "assignments": int}.
    env_mode is True if an env file name is visible OR at least
    ENV_LINE_THRESHOLD lines look like UPPER_SNAKE=value assignments.
    """
    hint = any(_ENV_FILE_HINT.search(t) for t in line_texts)
    assignments = 0
    for text in line_texts:
        m = _env_assignment(text)
        if m and _UPPER_ENV_KEY.match(m.group("key").replace(" ", "_")):
            assignments += 1
    env_mode = hint or assignments >= ENV_LINE_THRESHOLD
    return env_mode, {"hint": hint, "assignments": assignments}


# ============================================================
# LINE ANALYSIS (pure text - no OCR dependency)
# ============================================================
def _line_spans(words):
    """Join words with single spaces; return (line_text, [(start, end), ...])."""
    spans, parts, pos = [], [], 0
    for text in words:
        spans.append((pos, pos + len(text)))
        parts.append(text)
        pos += len(text) + 1
    return " ".join(parts), spans


def _words_in_span(spans, start, end):
    return [i for i, (s, e) in enumerate(spans) if s < end and e > start]


def _apply_keyword_masks(words, masked):
    n = len(words)
    i = 0
    while i < n:
        hit = None
        # Longest window first so "Secret Access Key" wins over "Secret". A
        # multi-word window only counts if the LABEL itself reaches into the
        # last word - otherwise the window swallowed value words
        # ("Password: hunter2 extra" must not mask "extra").
        for size in (3, 2, 1):
            if i + size > n:
                continue
            window = " ".join(words[i:i + size])
            m = _LABEL_RE.match(window)
            if not m:
                continue
            if size > 1:
                last_word_start = len(" ".join(words[i:i + size - 1])) + 1
                if m.end("label") < last_word_start:
                    continue
            hit = (size, m)
            break
        if hit is None:
            i += 1
            continue

        size, m = hit
        label_key = _keyword_key(m.group("label"))
        inline_value = m.group("value") or m.group("digits") or ""
        has_inline_value = _has_content(inline_value)

        for j in range(i, i + size):
            masked.setdefault(j, "credential_value" if has_inline_value else "credential_label")
        j = i + size

        if label_key in _MASK_REST_KEYS:
            for k in range(j, n):
                masked.setdefault(k, "credential_value")
            j = n
        elif not has_inline_value:
            while j < n and _FILLER_RE.match(words[j]):
                j += 1
            if j < n:
                masked.setdefault(j, "credential_value")
                j += 1
        i = j


def _join_at_punctuation(text):
    """
    Drop whitespace that touches punctuation ("john @ acme.com" ->
    "john@acme.com", "123 - 45 - 6789" -> "123-45-6789") so values OCR broke
    around separators still match. Returns (joined_text, index_map) where
    index_map[j] is the original index of joined_text[j].
    """
    out, index_map = [], []
    n = len(text)

    def is_wordchar(ch):
        return ch.isalnum() or ch == "_"

    for i, ch in enumerate(text):
        if ch.isspace():
            left = i - 1
            while left >= 0 and text[left].isspace():
                left -= 1
            right = i + 1
            while right < n and text[right].isspace():
                right += 1
            touches_punct = (left >= 0 and not is_wordchar(text[left])) or (
                right < n and not is_wordchar(text[right])
            )
            if touches_punct:
                continue
        out.append(ch)
        index_map.append(i)
    return "".join(out), index_map


def _apply_pattern_masks(words, line_text, spans, masked):
    # Whole-line pass first: catches values OCR split across word boxes and
    # gives the more specific type (credit_card rather than 4x otp).
    for pii_type, start, end in find_pii(line_text):
        for idx in _words_in_span(spans, start, end):
            masked.setdefault(idx, pii_type)

    # Same pass on the line with whitespace-around-punctuation removed
    # ("john @ acme . com"). Validators are re-run on the ORIGINAL text so
    # spacing-sensitive guards (e.g. vehicle numbers) still apply.
    joined, index_map = _join_at_punctuation(line_text)
    if joined != line_text and joined:
        for pii_type, pattern in PII_PATTERNS.items():
            validator = PII_VALIDATORS.get(pii_type)
            for m in pattern.finditer(joined):
                if m.end() <= m.start():
                    continue
                orig_start = index_map[m.start()]
                orig_end = index_map[m.end() - 1] + 1
                if validator and not validator(line_text[orig_start:orig_end]):
                    continue
                for idx in _words_in_span(spans, orig_start, orig_end):
                    masked.setdefault(idx, pii_type)

    # Per-word pass (cheap safety net for anything the line pass missed).
    for idx, text in enumerate(words):
        if idx in masked:
            continue
        pii_type = is_pii(text)
        if pii_type:
            masked[idx] = pii_type


def _apply_env_masks(line_text, spans, masked, env_mode):
    m = _env_assignment(line_text)
    if not m:
        return
    if env_mode or _key_is_sensitive(m.group("key")):
        for idx in _words_in_span(spans, m.start("value"), m.end("value")):
            masked.setdefault(idx, "env_value")


def analyze_lines(lines, env_mode=None):
    """
    Decide which words to mask.

    Args:
        lines: list of lines, each a list of word strings (OCR order).
        env_mode: None = auto-detect, True/False = force.

    Returns:
        (masks, env_mode, env_info) where masks[line_index] is a dict mapping
        word_index -> pii_type for every word that must be masked.
    """
    prepared = []
    for words in lines:
        words = [w if isinstance(w, str) else str(w) for w in (words or [])]
        line_text, spans = _line_spans(words)
        prepared.append((words, line_text, spans))

    env_info = {"hint": False, "assignments": 0, "forced": env_mode is not None}
    if env_mode is None:
        env_mode, detected_info = detect_env_mode([p[1] for p in prepared])
        env_info.update(detected_info)
    env_mode = bool(env_mode)

    masks = []
    for words, line_text, spans in prepared:
        masked = {}
        if words:
            # Order matters only for the reported type (first assignment wins):
            # label/value context > env value > generic pattern.
            _apply_keyword_masks(words, masked)
            _apply_env_masks(line_text, spans, masked, env_mode)
            _apply_pattern_masks(words, line_text, spans, masked)
        masks.append(masked)
    return masks, env_mode, env_info


# ============================================================
# LOAD MODEL (lazily, once - reused across calls)
# ============================================================
_OCR_MODEL = None
DEVICE = None


def get_ocr_model():
    """Load the docTR model on first use (keeps importing this module cheap)."""
    global _OCR_MODEL, DEVICE
    if _OCR_MODEL is None:
        import torch
        from doctr.models import ocr_predictor

        DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
        _say(f"Using device: {DEVICE}")
        _say("Loading docTR OCR model...")
        _OCR_MODEL = ocr_predictor(pretrained=True).to(DEVICE)
        _say("Model loaded.")
    return _OCR_MODEL


# ============================================================
# IMAGE HELPERS
# ============================================================
def _open_image(image_path):
    """Open an image, honouring EXIF rotation. Raises ValueError if unreadable."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        # Load pixels inside the context so the file handle is released
        # immediately (Windows will not let us delete/overwrite open files).
        with Image.open(image_path) as opened:
            opened.load()
            img = opened
    except UnidentifiedImageError:
        raise ValueError(f"Not a readable image file: {image_path}")
    except OSError as exc:
        raise ValueError(f"Could not read image {image_path}: {exc}")
    transposed = ImageOps.exif_transpose(img)
    return transposed if transposed is not None else img


def _has_alpha(img):
    return img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)


def _resample_filter():
    from PIL import Image

    return getattr(Image, "Resampling", Image).LANCZOS


def _encode_for_ocr(img, max_dimension=MAX_DIMENSION):
    """
    Encode a PIL image to PNG bytes for docTR, downscaling IN MEMORY if it
    exceeds max_dimension. No temp files — cuts OCR time on large screenshots
    without ever writing an (unmasked) copy to disk. docTR returns RELATIVE
    (0-1) coordinates, so the boxes still map onto the original full-resolution
    image. Returns (png_bytes, (ocr_w, ocr_h)).
    """
    from io import BytesIO

    W, H = img.size
    if W == 0 or H == 0:
        raise ValueError("Image has zero size")

    if max_dimension and max_dimension > 0 and max(W, H) > max_dimension:
        scale = max_dimension / max(W, H)
        new_size = (max(1, int(round(W * scale))), max(1, int(round(H * scale))))
        # LANCZOS needs a "real" colour mode; palette / alpha images are flattened.
        work = img.convert("RGB").resize(new_size, _resample_filter())
        _say(f"📉 Resized image from {W}x{H} -> {new_size[0]}x{new_size[1]} for faster OCR")
    else:
        work = img.convert("RGB")

    buf = BytesIO()
    work.save(buf, format="PNG")
    return buf.getvalue(), work.size


def _geometry_to_box(geometry, W, H, padding, ocr_size=None):
    """
    Convert a docTR word geometry (2-point box or 4-point polygon, relative
    coordinates) into clamped absolute pixel coordinates on the full image.
    """
    points = list(geometry)
    if len(points) == 2 and all(len(p) == 2 for p in points):
        xs = [points[0][0], points[1][0]]
        ys = [points[0][1], points[1][1]]
    else:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]

    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if max(x1, y1) > 1.0 + 1e-6:
        # Absolute coordinates (non-default docTR export) - relative to the OCR input.
        ocr_w, ocr_h = ocr_size or (W, H)
        x0, x1 = x0 / ocr_w, x1 / ocr_w
        y0, y1 = y0 / ocr_h, y1 / ocr_h

    pad = max(0, int(padding or 0))
    ax0 = max(0, int(math.floor(x0 * W)) - pad)
    ay0 = max(0, int(math.floor(y0 * H)) - pad)
    ax1 = min(W, int(math.ceil(x1 * W)) + pad)
    ay1 = min(H, int(math.ceil(y1 * H)) + pad)
    if ax1 <= ax0:
        ax1 = min(W, ax0 + 1)
    if ay1 <= ay0:
        ay1 = min(H, ay0 + 1)
    return ax0, ay0, ax1, ay1


def _default_output_path(image_path):
    base = os.path.splitext(os.path.basename(image_path))[0] or "image"
    ext = os.path.splitext(image_path)[1].lower()
    if ext not in _WRITABLE_EXTS:
        ext = ".png"
    return os.path.join(OUTPUT_DIR, f"{base}_masked{ext}")


def _save_image(img, output_path):
    """Save, converting modes as the format requires; fall back to PNG."""
    ext = os.path.splitext(output_path)[1].lower()
    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)

    to_save = img.convert("RGB") if ext in _NO_ALPHA_EXTS and img.mode != "RGB" else img
    try:
        to_save.save(output_path)
        return output_path
    except (ValueError, OSError, KeyError) as exc:
        if ext == ".png":
            raise
        fallback = os.path.splitext(output_path)[0] + ".png"
        _say(f"⚠️  Could not save as {ext or 'unknown format'} ({exc}); saving as PNG instead")
        img.save(fallback, format="PNG")
        return fallback


# ============================================================
# MAIN ENTRY POINT
# ============================================================
def _ocr_and_mask(img, padding=2, max_dimension=MAX_DIMENSION, env_mode=None):
    """
    OCR a PIL image, decide what to mask, and draw black boxes on it IN PLACE.
    Pure in-memory — no temp files, so a raw (unmasked) copy never touches disk.

    Returns (detected, redacted_lines, env_mode, env_info).
    """
    from doctr.io import DocumentFile
    from PIL import ImageDraw

    # --- Downscale in memory + run OCR ---
    ocr_bytes, ocr_size = _encode_for_ocr(img, max_dimension)
    ocr_model = get_ocr_model()
    doc = DocumentFile.from_images(ocr_bytes)
    result = ocr_model(doc)
    export = result.export()

    W, H = img.size
    draw = ImageDraw.Draw(img)

    # --- Collect OCR lines (skip empty words) ---
    ocr_lines = []
    for page in export.get("pages", []):
        for block in page.get("blocks", []):
            for line in block.get("lines", []):
                words = [
                    w for w in line.get("words", [])
                    if isinstance(w.get("value"), str) and w["value"].strip()
                ]
                if words:
                    ocr_lines.append(words)

    # --- Decide what to mask ---
    masks, env_mode, env_info = analyze_lines(
        [[w["value"] for w in words] for words in ocr_lines], env_mode=env_mode
    )

    # --- Draw ---
    detected = []
    redacted_lines = []
    for words, masked in zip(ocr_lines, masks):
        line_words = []
        for idx, word in enumerate(words):
            text = word["value"]
            pii_type = masked.get(idx)
            if pii_type is None:
                line_words.append(text)
                continue
            box = _geometry_to_box(word["geometry"], W, H, padding, ocr_size=ocr_size)
            draw.rectangle(box, fill="black")
            detected.append((pii_type, text))
            line_words.append(f"[{pii_type.upper()}_MASKED]")
        redacted_lines.append(" ".join(line_words))

    return detected, redacted_lines, env_mode, env_info


def mask_pii_in_image(image_path, output_path=None, padding=2, max_dimension=MAX_DIMENSION,
                      env_mode=None, verbose=True):
    """
    Runs docTR OCR on a LOCAL image, detects PII using PII_PATTERNS +
    SENSITIVE_KEYWORDS (+ .env value masking), draws black boxes over
    matched words, and saves the masked image locally.

    Returns (output_path, list of detected PII matches (type, text)).
    """
    image_path = os.fspath(image_path)
    if not os.path.isfile(image_path):
        raise FileNotFoundError(f"No such file: {image_path}")

    img = _open_image(image_path)
    img = img.convert("RGBA" if _has_alpha(img) else "RGB")

    detected, redacted_lines, env_mode, env_info = _ocr_and_mask(img, padding, max_dimension, env_mode)

    if output_path is None:
        output_path = _default_output_path(image_path)
    output_path = _save_image(img, os.fspath(output_path))

    if verbose:
        _say(f"\n✅ Masked image saved to: {output_path}")
        if env_mode:
            reason = "forced" if env_info.get("forced") else (
                ".env file name visible" if env_info.get("hint")
                else f"{env_info.get('assignments')} KEY=VALUE lines"
            )
            _say(f"🔐 .env mode ON ({reason}) - all env variable values masked")
        _say(f"🔍 Detected {len(detected)} PII item(s):")
        for pii_type, text in detected:
            _say(f"   - {pii_type}: {text}")
        _say("\n📄 Redacted text preview:")
        _say("\n".join(redacted_lines))

    return output_path, detected


def mask_image_bytes(data, out_format="PNG", padding=2, max_dimension=MAX_DIMENSION, env_mode=None):
    """
    Mask PII in an IN-MEMORY image (the service entry point). The raw bytes are
    never written to disk — only the masked result is returned.

    Args:
        data: the raw image bytes
        out_format: output encoding ("PNG" keeps quality; "JPEG" is smaller)
        padding/max_dimension/env_mode: as in mask_pii_in_image

    Returns:
        (masked_bytes, list of detected PII matches (type, text))
    """
    from io import BytesIO
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(BytesIO(data)) as opened:
            opened.load()
            img = opened
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError(f"Not a readable image: {exc}")
    transposed = ImageOps.exif_transpose(img)
    img = transposed if transposed is not None else img
    img = img.convert("RGBA" if _has_alpha(img) else "RGB")

    detected, _redacted, _env_mode, _env_info = _ocr_and_mask(img, padding, max_dimension, env_mode)

    fmt = (out_format or "PNG").upper()
    if fmt == "JPG":
        fmt = "JPEG"
    if fmt == "JPEG" and img.mode != "RGB":
        img = img.convert("RGB")
    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue(), detected


# ============================================================
# USAGE
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
    else:
        image_path = input("Enter the LOCAL path of the screenshot: ")
    image_path = image_path.strip().strip('"').strip("'")
    if not image_path:
        _say("No image path given.")
        sys.exit(1)
    try:
        mask_pii_in_image(image_path)
    except (FileNotFoundError, ValueError) as exc:
        _say(f"❌ {exc}")
        sys.exit(1)
