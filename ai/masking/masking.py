# ============================================================
# PII Masking from Screenshot using docTR OCR
# ============================================================
#
# Scope: PASSWORDS, CREDENTIALS and genuinely SENSITIVE data - NOT ordinary
# contact info. Email addresses and bare unlabeled numbers are deliberately left
# visible so a work screenshot stays useful.
#
# What gets masked
#   1. SENSITIVE PATTERNS - cards, national IDs (PAN/Aadhaar/SSN/passport/...),
#      API keys, JWTs, AWS keys, IFSC/SWIFT/GST, credential-bearing URLs ...
#      matched case-insensitively with per-type validators to stop false positives.
#   2. CREDENTIAL LABELS - "Password:", "API key", "Enter your password", "CVV",
#      "OTP" ... and the value that follows: inline, the next word, the rest of
#      the line for phrase-style secrets, or - via the GEOMETRY pass - a value on
#      a DIFFERENT OCR line (a floating label above an input box, or a "Show
#      password" toggle below a revealed value).
#   3. SECRETS / CREDENTIALS FILES - a visible .env / credentials / secrets /
#      id_rsa / *.pem file name, a PEM private-key header, or several config
#      assignments turns on "secrets mode": EVERY value is masked (KEY=VALUE,
#      key: value JSON/YAML, and raw PEM/token key-material). Outside that mode,
#      only values whose KEY is sensitive (password/secret/token/...) are masked.
#
# Geometry awareness (window/region separation):
#   A desktop screenshot can contain several app windows. Before any cross-line
#   label->value linking, lines are partitioned into spatial regions - via
#   union-find gap clustering plus (best-effort) CV window-boundary detection -
#   and a label may only link to a value in the SAME region.
#
# The pure-text analysis (analyze_lines) has no OCR/torch dependency and the
# geometry linking (link_cross_line_labels) needs only boxes, so both are
# unit-testable without a model.

import os
import re
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# Optional: load config (e.g. output folder, max dimension) from a local .env file
try:
    from dotenv import load_dotenv
    load_dotenv(".env")
except ImportError:
    pass  # dotenv is optional; skip if not installed


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
        _say(f"WARNING: {name}={raw!r} is not an integer; using default {default}")
        return default
    if minimum is not None and value < minimum:
        _say(f"WARNING: {name}={value} is below the minimum {minimum}; using {minimum}")
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

# --- Cross-line (geometry) label -> value linking ---
# How many candidate lines around a bare label we're willing to scan for its value.
CROSS_LINE_LOOKAHEAD = _env_int("CROSS_LINE_LOOKAHEAD", 4, minimum=1)
# Max vertical gap between label and candidate value, as a multiple of the
# page's median line height. Beyond this we assume we've left the field's
# UI group (e.g. moved on to an unrelated section of the page).
CROSS_LINE_MAX_GAP_MULT = float(os.getenv("CROSS_LINE_MAX_GAP_MULT", "3.0"))
# Minimum horizontal overlap ratio (0-1) between label and candidate line
# for the candidate to be considered "aligned enough" to be this field's value.
CROSS_LINE_MIN_OVERLAP = float(os.getenv("CROSS_LINE_MIN_OVERLAP", "0.15"))

# Image formats we can safely write to. Anything else is saved as PNG.
_WRITABLE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff", ".gif"}
_NO_ALPHA_EXTS = {".jpg", ".jpeg", ".bmp"}


# ============================================================
# PII PATTERNS  (all compiled case-insensitively)
# ============================================================
# We mask PASSWORDS, CREDENTIALS and genuinely SENSITIVE data - NOT ordinary
# contact info. Deliberately NOT masked (they're everywhere in work screenshots
# and masking them makes the capture useless):
#   * email addresses  * bare numbers with no sensitive label (a 4-8 digit "OTP"
#     or 3-4 digit "CVV" is only masked when it sits next to its label - handled
#     by the credential-label pass, not by a blanket digit pattern).
# Structured secrets/IDs below have distinctive shapes, so masking them almost
# never touches innocent text.
_PII_PATTERN_SOURCES = {
    "phone": r"(\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{3,4}\b",
    "credit_card": r"\b(?:\d[ -]?){13,16}\b",
    "aadhaar": r"\b\d{4}\s?\d{4}\s?\d{4}\b",
    "pan_card": r"\b[A-Z]{5}\d{4}[A-Z]\b",
    "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    "date_of_birth": r"\b(0[1-9]|[12]\d|3[01])[/\-.](0[1-9]|1[0-2])[/\-.]\d{2,4}\b",
    "ifsc_code": r"\b[A-Z]{4}0[A-Z0-9]{6}\b",
    "passport_number": r"\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b",
    "voter_id": r"\b[A-Z]{3}\d{7}\b",
    "gst_number": r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b",
    "swift_code": r"\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b",
    "jwt_token": r"\bey[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b",
    "aws_access_key": r"\b(AKIA|ASIA)[A-Z0-9]{16}\b",
    "api_key_generic": r"\b[A-Z0-9_\-]{24,}\b",
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
    "swift_code": lambda t: any(c.isdigit() for c in t) or _is_upper(t),
    "api_key_generic": lambda t: any(c.isdigit() for c in t)
    or (any(c.islower() for c in t) and any(c.isupper() for c in t)),
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
    # extra login-form phrasing that isn't a bare "Password" label
    "enter-your-password", "enter-password", "your-password", "confirm-password",
    "new-password", "current-password", "create-password",
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

# Rows that are UI chrome, not a value, and must never be mistaken for one
# during cross-line linking. Extend this as you meet new form templates.
_UI_NOISE_LINE_RE = re.compile(
    r"^(show password|hide password|forgot password\??|remember me|"
    r"next|continue|sign in|log in|submit|cancel|back|"
    r"terms(?: of (?:use|service))?|privacy(?: policy)?|help|"
    r"[a-z]+ \([a-z ]+\))$",  # e.g. "English (United Kingdom)"
    re.IGNORECASE,
)


def _has_content(text):
    """True if the text contains at least one letter or digit."""
    return bool(text) and re.search(r"[^\W_]", text) is not None


def _looks_like_secret_value(text):
    """
    True if a word plausibly IS a typed secret rather than UI chrome: contains a
    digit, an embedded symbol, or is long. Used to guard UPWARD cross-line
    matches so headings above a label don't get blacked out.
    """
    core = re.sub(r"^[\W_]+|[\W_]+$", "", text or "")
    if not core:
        return False
    if any(c.isdigit() for c in core):
        return True
    if re.search(r"[^0-9A-Za-z]", core):
        return True
    return len(core) >= 8


# ============================================================
# .env DETECTION
# ============================================================
# A visible env / credentials / secrets file name anywhere in the OCR text:
# ".env", ".env.local", "backend/.env", "env.example", "credentials.json",
# "secrets.yaml", "id_rsa", "server.pem", ".npmrc", "~/.aws/credentials" ...
_SECRETS_FILE_HINT = re.compile(
    r"(?<![\w-])\.env(?:\.[\w-]+)*(?![\w-])"
    r"|(?<![\w.-])env\.(?:local|dev|development|prod|production|staging|stage"
    r"|test|testing|example|sample|template)\b"
    r"|(?<![\w-])(?:credentials?|secrets?|id_rsa|id_ed25519|id_dsa|id_ecdsa"
    r"|service[-_]?account|client[-_]?secret)(?![\w-])"
    r"|\.(?:pem|key|p12|pfx|jks|keystore|npmrc|netrc|pgpass|htpasswd)(?![\w])",
    re.IGNORECASE,
)
# A PEM / OpenSSH private-key header: an unambiguous "this is a secret file" flag.
_PEM_MARKER = re.compile(r"-{2,}\s*BEGIN\s+[A-Z0-9 ]*PRIVATE KEY\s*-{2,}", re.IGNORECASE)
# Base64/hex/token alphabet, for spotting PEM body lines and raw tokens.
_B64_CHARS = re.compile(r"[A-Za-z0-9+/=_\-]")

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
# key: value  /  "key": "value"  (JSON / YAML / INI). Excludes "http://…" and
# bare "12:34" times: the key must start with a letter and hold no slash.
_COLON_ASSIGNMENT = re.compile(
    r'^\s*(?:[-*•]\s*)?"?(?P<key>[A-Za-z_][\w.\- ]*?)"?\s*:\s*'
    r'(?P<value>"[^"]*"|\'[^\']*\'|[^\s].*?)\s*,?$',
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
    """Return the match if the line is a KEY=VALUE assignment with a value."""
    m = _ENV_ASSIGNMENT.match(line_text)
    if m and _has_content(m.group("value")):
        return m
    return None


def _colon_assignment(line_text):
    """Return the match if the line is a `key: value` assignment with a value.
    Skips URLs so "url: http://x" doesn't treat "//x" as the value's start."""
    if re.match(r'^\s*"?[A-Za-z_][\w.\- ]*"?\s*:\s*https?://', line_text):
        return None
    m = _COLON_ASSIGNMENT.match(line_text)
    if m and _has_content(m.group("value")):
        return m
    return None


def _is_key_material(line_text):
    """
    A long, unbroken, mostly-base64 blob - a PEM body line or a raw token.
    Tolerant of a few OCR misreads (real PEM bodies never OCR perfectly), so it
    matches when >=80% of a >=24-char run of non-space characters is base64.
    """
    s = "".join(line_text.split())  # PEM/token bodies carry no spaces
    if len(s) < 24:
        return False
    b64 = sum(1 for c in s if _B64_CHARS.match(c))
    return b64 / len(s) >= 0.8


def detect_secrets_mode(line_texts):
    """
    Decide whether the OCR'd page is a secrets file (.env, credentials.json,
    id_rsa, secrets.yaml, ...). In that mode EVERY value is masked, not just the
    ones with an obviously-sensitive key.

    Returns (mode, info). mode is True if a secrets-file name is visible, a PEM
    private-key header is present, OR at least ENV_LINE_THRESHOLD lines look
    like config assignments (KEY=VALUE or a sensitive `key: value`).
    """
    hint = any(_SECRETS_FILE_HINT.search(t) for t in line_texts)
    pem = any(_PEM_MARKER.search(t) for t in line_texts)
    assignments = 0
    for text in line_texts:
        m = _env_assignment(text)
        if m and _UPPER_ENV_KEY.match(m.group("key").replace(" ", "_")):
            assignments += 1
            continue
        cm = _colon_assignment(text)
        if cm and _key_is_sensitive(cm.group("key")):
            assignments += 1
    mode = hint or pem or assignments >= ENV_LINE_THRESHOLD
    return mode, {"hint": hint, "pem": pem, "assignments": assignments}


# Back-compat alias (the pre-broadening public name).
detect_env_mode = detect_secrets_mode


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


def _apply_secret_masks(line_text, spans, masked, secrets_mode):
    """
    Mask the VALUE of a config/credentials line. In secrets_mode (the whole page
    is a .env / credentials / key file) EVERY value is masked; otherwise only
    values whose KEY is sensitive (password/secret/token/...). Covers KEY=VALUE,
    `key: value` (JSON/YAML/INI), and raw PEM/token key-material lines.
    """
    m = _env_assignment(line_text)
    if m and (secrets_mode or _key_is_sensitive(m.group("key"))):
        for idx in _words_in_span(spans, m.start("value"), m.end("value")):
            masked.setdefault(idx, "secret_value")
        return

    cm = _colon_assignment(line_text)
    if cm and (secrets_mode or _key_is_sensitive(cm.group("key"))):
        for idx in _words_in_span(spans, cm.start("value"), cm.end("value")):
            masked.setdefault(idx, "secret_value")
        return

    # Raw key material (PEM body line, a lone token) - only inside a secrets file.
    if secrets_mode and _is_key_material(line_text):
        for idx in range(len(spans)):
            masked.setdefault(idx, "secret_value")


def analyze_lines(lines, env_mode=None):
    """
    Same-line-only analysis (the pure-text pass).

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
            _apply_secret_masks(line_text, spans, masked, env_mode)
            _apply_pattern_masks(words, line_text, spans, masked)
        masks.append(masked)
    return masks, env_mode, env_info


# ============================================================
# GEOMETRY-AWARE CROSS-LINE LABEL -> VALUE LINKING
# ============================================================
@dataclass
class LineBox:
    """A single OCR line with its words and bounding box (relative 0-1 coords)."""
    words: List[str]
    bbox: Tuple[float, float, float, float]  # (x0, y0, x1, y1)


def _line_text_of(words):
    return " ".join(words).strip()


def _is_noise_line(words):
    text = _line_text_of(words)
    return bool(text) and bool(_UI_NOISE_LINE_RE.match(text))


def _median_line_height(line_boxes: List[LineBox]) -> float:
    heights = [lb.bbox[3] - lb.bbox[1] for lb in line_boxes if lb.words]
    if not heights:
        return 0.02  # sane fallback for a typical screenshot
    heights.sort()
    mid = len(heights) // 2
    if len(heights) % 2:
        return heights[mid]
    return (heights[mid - 1] + heights[mid]) / 2


def _horizontal_overlap_ratio(label_box, cand_box):
    lx0, _, lx1, _ = label_box
    cx0, _, cx1, _ = cand_box
    overlap = min(lx1, cx1) - max(lx0, cx0)
    label_width = max(1e-6, lx1 - lx0)
    return max(0.0, overlap) / label_width


# ------------------------------------------------------------
# WINDOW / REGION SEGMENTATION
# ------------------------------------------------------------
# A screenshot is often NOT one document - it can contain several
# overlapping app windows (browser + terminal, browser + a dialog, two
# monitors captured together, etc). Reading order alone doesn't know when
# it has crossed from one window into an unrelated one, and two windows
# can easily sit close enough in x/y for the gap/overlap heuristics above
# to wrongly treat them as one field group. So before any cross-line
# linking happens, we partition all lines into disjoint spatial clusters
# ("regions") using union-find over expanded-bbox proximity, and a label
# is only ever allowed to link to a value in the SAME region.
#
# MUST be >= CROSS_LINE_MAX_GAP_MULT: the clusterer feeds the linker, so if it
# splits at a smaller gap than the linker is allowed to bridge, legitimate
# label->value pairs land in different regions and can never link (seen live:
# a revealed password 2.6 line-heights above its "Show password" toggle).
CLUSTER_GAP_MULTIPLIER = float(os.getenv("CLUSTER_GAP_MULTIPLIER", "3.5"))


def _bbox_expand(bbox, dx, dy):
    x0, y0, x1, y1 = bbox
    return (x0 - dx, y0 - dy, x1 + dx, y1 + dy)


def _boxes_close(b1, b2, dx, dy):
    e1 = _bbox_expand(b1, dx, dy)
    # True if the expanded box b1 overlaps b2 at all (i.e. the real gap
    # between b1 and b2 is smaller than the expansion amount).
    return not (e1[2] < b2[0] or b2[2] < e1[0] or e1[3] < b2[1] or b2[3] < e1[1])


def cluster_line_boxes_into_regions(
    line_boxes: List[LineBox], gap_multiplier: float = CLUSTER_GAP_MULTIPLIER
) -> List[int]:
    """
    Union-Find clustering of OCR lines into disjoint spatial regions
    (typically: separate app windows / dialogs). Two lines merge into the
    same region if their boxes, expanded by gap_multiplier * median line
    size, overlap - i.e. they're close enough to plausibly belong to the
    same UI surface. A real gap between windows (window borders, desktop
    background, drop shadows) is normally much larger than the gap between
    a label and its own value, so this separates windows cleanly without
    needing real window-chrome / computer-vision detection.

    Returns region_ids where region_ids[i] is line_boxes[i]'s cluster id.
    """
    n = len(line_boxes)
    if n == 0:
        return []

    heights = sorted(lb.bbox[3] - lb.bbox[1] for lb in line_boxes if lb.words)
    widths = sorted(lb.bbox[2] - lb.bbox[0] for lb in line_boxes if lb.words)
    med_h = heights[len(heights) // 2] if heights else 0.02
    med_w = widths[len(widths) // 2] if widths else 0.05
    dy = med_h * gap_multiplier
    dx = med_w * gap_multiplier * 0.4  # tighter horizontally than vertically

    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # O(n^2) pairwise check - fine for the line counts a single screenshot
    # produces (typically well under a few hundred).
    for i in range(n):
        for j in range(i + 1, n):
            if _boxes_close(line_boxes[i].bbox, line_boxes[j].bbox, dx, dy):
                union(i, j)

    remap: Dict[int, int] = {}
    region_ids = []
    for i in range(n):
        root = find(i)
        if root not in remap:
            remap[root] = len(remap)
        region_ids.append(remap[root])
    return region_ids


def _find_geometric_value_line(
    label_idx: int,
    line_boxes: List[LineBox],
    line_masks: List[Dict[int, str]],
    median_h: float,
    region_ids: List[int],
    max_lookahead: int = CROSS_LINE_LOOKAHEAD,
) -> Optional[int]:
    """
    Given a line index that resolved to a bare credential_label with no
    value on its own line, search for the best-matching value line --
    restricted to lines in the SAME spatial region (window) as the label.

    Searches DOWNWARD first (label above its input box - the common form
    layout), then UPWARD (a "Show password" toggle sits BELOW the revealed
    value; and OCR often misses the tiny grey field label entirely, leaving
    the toggle as the only anchor). Upward candidates must additionally
    contain a secret-looking word, so headings above a label never get
    blacked out.

    Returns the index of the matched line, or None if nothing qualifies.
    """
    label_box = line_boxes[label_idx].bbox
    label_region = region_ids[label_idx]
    best_idx, best_score = None, None

    # ---- downward ----
    scanned = 0
    for j in range(label_idx + 1, len(line_boxes)):
        if scanned >= max_lookahead:
            break
        cand = line_boxes[j]
        if not cand.words:
            continue

        # Hard boundary: never link across a window/region boundary, even
        # if gap+overlap would otherwise look plausible. Don't count these
        # against the lookahead budget - they're not "candidates we
        # considered and rejected", they're a different document entirely.
        if region_ids[j] != label_region:
            continue

        scanned += 1

        # Stop entirely if we hit ANOTHER label line first - don't let
        # this field's search swallow the next field's value.
        if any(v == "credential_label" for v in line_masks[j].values()):
            break

        v_gap = cand.bbox[1] - label_box[3]
        if v_gap < -median_h * 0.6:
            # candidate starts noticeably above where the label ended -> not
            # "below" (a small negative gap is normal: input-box text can sit
            # close to, or slightly overlapping, a label's baseline/descender)
            continue
        if v_gap > median_h * CROSS_LINE_MAX_GAP_MULT:
            # left the field's UI group -> stop searching further down
            break

        if _is_noise_line(cand.words):
            continue  # e.g. "Show password" - skip, keep looking

        overlap_ratio = _horizontal_overlap_ratio(label_box, cand.bbox)
        if overlap_ratio < CROSS_LINE_MIN_OVERLAP:
            continue  # not aligned under/near the label at all

        # Lower score = better: prefer close + well-aligned candidates.
        score = max(0.0, v_gap) - overlap_ratio * median_h
        if best_score is None or score < best_score:
            best_idx, best_score = j, score

    # ---- upward ----
    scanned = 0
    for j in range(label_idx - 1, -1, -1):
        if scanned >= max_lookahead:
            break
        cand = line_boxes[j]
        if not cand.words:
            continue
        if region_ids[j] != label_region:
            continue

        scanned += 1

        if any(v == "credential_label" for v in line_masks[j].values()):
            break

        v_gap = label_box[1] - cand.bbox[3]  # label top - candidate bottom
        if v_gap < -median_h * 0.6:
            continue
        if v_gap > median_h * CROSS_LINE_MAX_GAP_MULT:
            break

        if _is_noise_line(cand.words):
            continue
        # Upward guard: only lines that actually contain a secret-looking word.
        if not any(_looks_like_secret_value(w) for w in cand.words):
            continue

        overlap_ratio = _horizontal_overlap_ratio(label_box, cand.bbox)
        if overlap_ratio < CROSS_LINE_MIN_OVERLAP:
            continue

        # Slight penalty so an equally-close downward match wins ties.
        score = max(0.0, v_gap) - overlap_ratio * median_h + median_h * 0.25
        if best_score is None or score < best_score:
            best_idx, best_score = j, score

    return best_idx


def link_cross_line_labels(
    line_boxes: List[LineBox],
    line_masks: List[Dict[int, str]],
    region_ids: Optional[List[int]] = None,
):
    """
    Mutates line_masks in place: for every line that resolved to a bare
    'credential_label' (no value found on its own line by analyze_lines),
    search nearby lines geometrically - within the same window/region only
    - and mask the best-matching value line.
    """
    if not line_boxes:
        return
    median_h = _median_line_height(line_boxes)
    if region_ids is None:
        region_ids = cluster_line_boxes_into_regions(line_boxes)

    for i, masked in enumerate(line_masks):
        has_bare_label = any(v == "credential_label" for v in masked.values())
        has_value_here = any(v == "credential_value" for v in masked.values())
        if not has_bare_label or has_value_here:
            continue

        match_idx = _find_geometric_value_line(
            i, line_boxes, line_masks, median_h, region_ids
        )
        if match_idx is None:
            continue

        for k in range(len(line_boxes[match_idx].words)):
            line_masks[match_idx].setdefault(k, "credential_value")


# ------------------------------------------------------------
# CV WINDOW-BOUNDARY DETECTION (handles ADJACENT/overlapping windows that
# text-gap clustering alone cannot separate, e.g. a terminal sitting
# directly against a browser dialog with ~zero pixel gap between them)
# ------------------------------------------------------------
# Why this exists: cluster_line_boxes_into_regions() above only sees text
# density. Two windows that are simply placed next to each other with no
# real gap (very common - people don't leave breathing room between
# windows) look, to a gap-based clusterer, like one continuous surface.
# The reliable signal is the window's actual rendered boundary, which on
# macOS is anchored by its traffic-light control dots. Detecting those and
# tracing the window's edge (NOT flood-filling by background color - dark
# themed apps next to each other can share near-identical background
# colors, which makes flood fill leak straight across the window seam)
# gives a real rectangle we can trust as a hard region boundary.
def _traffic_light_anchors(img_bgr) -> List[Tuple[float, float]]:
    """
    Find macOS-style traffic-light dot triples (red, yellow, green - left
    to right, evenly spaced, similar y) anywhere in the image. Returns the
    horizontal midpoint of each confident triple, in pixel coords. Only
    the focused window's dots are in color on macOS (background windows'
    dots render grey), so this typically finds ONE anchor per screenshot
    even when several windows are visible - that's expected, not a bug;
    see detect_window_regions_cv() for how the rest is handled.
    """
    import cv2
    import numpy as np

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    ranges = {
        "red": [((0, 100, 100), (10, 255, 255)), ((170, 100, 100), (180, 255, 255))],
        "yellow": [((20, 120, 150), (35, 255, 255))],
        "green": [((45, 80, 100), (85, 255, 255))],
    }

    def centroids(name):
        mask = None
        for lo, hi in ranges[name]:
            m = cv2.inRange(hsv, lo, hi)
            mask = m if mask is None else (mask | m)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        for c in contours:
            area = cv2.contourArea(c)
            if area < 15 or area > 600:
                continue
            (x, y), r = cv2.minEnclosingCircle(c)
            circ_area = np.pi * r * r
            if circ_area == 0 or area / circ_area < 0.55:
                continue
            out.append((x, y, r))
        return out

    reds, yellows, greens = centroids("red"), centroids("yellow"), centroids("green")
    anchors = []
    for rx, ry, rr in reds:
        for yx, yy, yr in yellows:
            if abs(yy - ry) > max(rr, yr) * 1.5:
                continue
            gap1 = yx - rx
            if not (5 < gap1 < 80):
                continue
            for gx, gy, gr in greens:
                if abs(gy - ry) > max(rr, gr) * 1.5:
                    continue
                gap2 = gx - yx
                if not (5 < gap2 < 80) or abs(gap1 - gap2) > max(gap1, gap2) * 0.5:
                    continue
                anchors.append(((rx + gx) / 2, (ry + gy) / 2))
    return anchors


def _window_bbox_from_anchor(img_bgr, anchor_xy, min_w=150, min_h=80):
    """
    Trace a window's true rectangular boundary from a traffic-light anchor
    using edge detection + contours (robust to adjacent windows sharing a
    similar background color, unlike flood fill). Returns pixel (x0,y0,x1,y1)
    or None if nothing confident is found.
    """
    import cv2
    import numpy as np

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 30, 90)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    ax, ay = anchor_xy
    best = None
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w < min_w or h < min_h:
            continue
        if not (x <= ax <= x + w):
            continue
        if not (y - 60 <= ay <= y + h):
            continue
        area = w * h
        if best is None or area < best[0]:
            best = (area, (x, y, w, h))
    if best is None:
        return None
    _, (x, y, w, h) = best
    y = max(0, min(y, int(ay - 20)))  # extend up slightly to include title bar
    return (x, y, x + w, y + h)


def _iou(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    area_a = max(0, ax1 - ax0) * max(0, ay1 - ay0)
    area_b = max(0, bx1 - bx0) * max(0, by1 - by0)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def detect_window_regions_cv(image_source) -> List[Tuple[float, float, float, float]]:
    """
    Best-effort detection of confidently-boundaried application windows in
    a full-desktop screenshot (currently: macOS traffic-light anchored
    windows), returned as RELATIVE (0-1) boxes to match docTR's coordinate
    space. `image_source` may be a file path or raw image bytes. Returns []
    if cv2 is unavailable or nothing confident is found - callers should
    treat that as "fall back to text-gap clustering", not as an error;
    plenty of legitimate screenshots are a single window and don't need
    this at all.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        _say("opencv-python not installed - skipping CV window detection "
             "(pip install opencv-python-headless to enable it)")
        return []

    if isinstance(image_source, (bytes, bytearray)):
        img = cv2.imdecode(np.frombuffer(image_source, np.uint8), cv2.IMREAD_COLOR)
    else:
        img = cv2.imread(os.fspath(image_source))
    if img is None:
        return []
    h, w = img.shape[:2]

    boxes = []
    for anchor in _traffic_light_anchors(img):
        bbox = _window_bbox_from_anchor(img, anchor)
        if bbox:
            boxes.append(bbox)

    unique = []
    for b in boxes:
        if not any(_iou(b, u) > 0.8 for u in unique):
            unique.append(b)

    return [(x0 / w, y0 / h, x1 / w, y1 / h) for x0, y0, x1, y1 in unique]


def _word_region_id(word_box, window_boxes) -> Optional[int]:
    cx = (word_box[0] + word_box[2]) / 2
    cy = (word_box[1] + word_box[3]) / 2
    for idx, (x0, y0, x1, y1) in enumerate(window_boxes):
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            return idx
    return None  # outside every detected window


def split_lines_by_window(
    line_boxes: List[LineBox],
    line_word_boxes: List[List[Tuple[float, float, float, float]]],
    window_boxes: List[Tuple[float, float, float, float]],
):
    """
    Defends against docTR (or any OCR engine) merging two visually
    ADJACENT windows' text into ONE line - this happens whenever two
    windows sit at close to the same y-coordinate with only a small x-gap
    between them, which is extremely common (e.g. a terminal placed next
    to a dialog, two side-by-side panes). A per-LINE region check can't fix
    this: the split has to happen *inside* the line, using each individual
    WORD's own bounding box, BEFORE any label/value logic runs on that line
    - otherwise a bare label can pick up an unrelated word from the other
    window as its "inline value" and stop searching for the real one.

    Splits every input line into maximal contiguous runs of words that
    fall in the same window (or in "no window", grouped separately).
    Lines that don't cross a boundary come back as a single unchanged
    run. Returns new parallel (line_boxes, line_word_boxes, window_ids)
    - all three the same new length, possibly longer than the input.
    window_ids[i] is the window id for line i, or None if it's outside
    every detected window (caller should gap-cluster those separately).
    """
    if not window_boxes:
        return line_boxes, line_word_boxes, [None] * len(line_boxes)

    new_line_boxes, new_word_boxes, new_window_ids = [], [], []

    for lb, wboxes in zip(line_boxes, line_word_boxes):
        if len(lb.words) != len(wboxes) or not wboxes:
            # can't safely split without a 1:1 word<->box alignment
            new_line_boxes.append(lb)
            new_word_boxes.append(wboxes)
            new_window_ids.append(None)
            continue

        word_regions = [_word_region_id(wb, window_boxes) for wb in wboxes]

        start = 0
        for i in range(1, len(word_regions) + 1):
            if i == len(word_regions) or word_regions[i] != word_regions[start]:
                sub_words = lb.words[start:i]
                sub_boxes = wboxes[start:i]
                new_line_boxes.append(LineBox(words=sub_words, bbox=_union_box(sub_boxes)))
                new_word_boxes.append(sub_boxes)
                new_window_ids.append(word_regions[start])
                start = i

    return new_line_boxes, new_word_boxes, new_window_ids


def prepare_lines_and_regions(
    line_boxes: List[LineBox],
    line_word_boxes: List[List[Tuple[float, float, float, float]]],
    image_source=None,
):
    """
    One-stop preprocessing before label/value analysis:
      1. Detect CV window boundaries (if an image path/bytes is given).
      2. Split any line that straddles a window boundary into per-window
         sub-lines at the WORD level (fixes OCR merging two adjacent
         windows' text into one line).
      3. Assign every resulting line a region id: the CV window id where
         applicable, else a gap-clustered id for whatever's left over.

    Returns (line_boxes, line_word_boxes, region_ids) - all parallel, and
    possibly longer than the input if any line was split. Callers MUST use
    the returned line_boxes/line_word_boxes (not their originals) for
    every later step, since indices shift when a split happens.
    """
    window_boxes = detect_window_regions_cv(image_source) if image_source is not None else []
    line_boxes, line_word_boxes, window_ids = split_lines_by_window(
        line_boxes, line_word_boxes, window_boxes
    )

    region_ids: List[int] = [-1] * len(line_boxes)
    leftover_idx = []
    for i, wid in enumerate(window_ids):
        if wid is None:
            leftover_idx.append(i)
        else:
            region_ids[i] = wid

    if leftover_idx:
        leftover_boxes = [line_boxes[i] for i in leftover_idx]
        leftover_regions = cluster_line_boxes_into_regions(leftover_boxes)
        offset = len(window_boxes)
        for local_i, global_i in enumerate(leftover_idx):
            region_ids[global_i] = offset + leftover_regions[local_i]

    return line_boxes, line_word_boxes, region_ids


def analyze_page(
    line_boxes: List[LineBox],
    region_ids: List[int],
    env_mode=None,
):
    """
    Full analysis for one OCR page, given lines that have ALREADY been
    through prepare_lines_and_regions() (so a line never straddles a
    window boundary, and every line has a region id): same-line pass +
    geometric cross-line pass restricted to same-region candidates.
    """
    lines = [lb.words for lb in line_boxes]
    line_masks, env_mode, env_info = analyze_lines(lines, env_mode=env_mode)
    link_cross_line_labels(line_boxes, line_masks, region_ids=region_ids)
    return line_masks, env_mode, env_info


# ============================================================
# LOAD MODEL (lazily, once - reused across calls)
# ============================================================
_OCR_MODEL = None
DEVICE = None


def get_ocr_model():
    """
    Load the docTR model on first use (keeps importing this module cheap).

    DOCTR_DET_ARCH / DOCTR_RECO_ARCH select the architectures. Unset = docTR's
    accuracy-first defaults (db_resnet50 + crnn_vgg16_bn) — but on CPU those
    take minutes on a dense screenshot, so the service container pins the
    mobilenet pair, which is ~an order of magnitude faster.
    """
    global _OCR_MODEL, DEVICE
    if _OCR_MODEL is None:
        import torch
        from doctr.models import ocr_predictor

        DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
        det = (os.getenv("DOCTR_DET_ARCH") or "").strip()
        reco = (os.getenv("DOCTR_RECO_ARCH") or "").strip()
        _say(f"Using device: {DEVICE}")
        _say(f"Loading docTR OCR model ({det or 'default'} + {reco or 'default'})...")
        kwargs = {}
        if det:
            kwargs["det_arch"] = det
        if reco:
            kwargs["reco_arch"] = reco
        _OCR_MODEL = ocr_predictor(pretrained=True, **kwargs).to(DEVICE)
        _say("Model loaded.")
    return _OCR_MODEL


# ============================================================
# IMAGE HELPERS
# ============================================================
def _open_image(image_path):
    """Open an image, honouring EXIF rotation. Raises ValueError if unreadable."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(image_path) as opened:
            opened.load()
            img = opened
    except UnidentifiedImageError:
        raise ValueError(f"Not a readable image file: {image_path}")
    except OSError as exc:
        raise ValueError(f"Could not read image {image_path}: {exc}")
    transposed = ImageOps.exif_transpose(img)
    return transposed if transposed is not None else img


def _open_image_bytes(data):
    """Open an in-memory image, honouring EXIF rotation. Raises ValueError if unreadable."""
    from io import BytesIO
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(BytesIO(data)) as opened:
            opened.load()
            img = opened
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError(f"Not a readable image: {exc}")
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
    exceeds max_dimension. docTR returns RELATIVE (0-1) coordinates, so the
    boxes still map onto the original full-resolution image.
    Returns (png_bytes, (ocr_w, ocr_h)).
    """
    from io import BytesIO

    W, H = img.size
    if W == 0 or H == 0:
        raise ValueError("Image has zero size")

    if max_dimension and max_dimension > 0 and max(W, H) > max_dimension:
        scale = max_dimension / max(W, H)
        new_size = (max(1, int(round(W * scale))), max(1, int(round(H * scale))))
        work = img.convert("RGB").resize(new_size, _resample_filter())
        _say(f"Resized image {W}x{H} -> {new_size[0]}x{new_size[1]} for faster OCR")
    else:
        work = img.convert("RGB")

    buf = BytesIO()
    work.save(buf, format="PNG")
    return buf.getvalue(), work.size


def _rel_box_from_geometry(geometry) -> Tuple[float, float, float, float]:
    """A word/line geometry as a relative (x0, y0, x1, y1) box (0-1 coords)."""
    points = list(geometry)
    if len(points) == 2 and all(len(p) == 2 for p in points):
        xs = [points[0][0], points[1][0]]
        ys = [points[0][1], points[1][1]]
    else:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def _union_box(boxes: List[Tuple[float, float, float, float]]):
    xs0 = [b[0] for b in boxes]
    ys0 = [b[1] for b in boxes]
    xs1 = [b[2] for b in boxes]
    ys1 = [b[3] for b in boxes]
    return (min(xs0), min(ys0), max(xs1), max(ys1))


def _walk_ocr_lines(doctr_result):
    """Yield (words, word_boxes) per OCR line, with EMPTY words filtered out of
    BOTH lists so indices always align 1:1."""
    export = doctr_result.export() if hasattr(doctr_result, "export") else doctr_result
    pages = export.get("pages", [export])
    for page in pages:
        for block in page.get("blocks", []):
            for line in block.get("lines", []):
                ws = [
                    w for w in line.get("words", [])
                    if isinstance(w.get("value"), str) and w["value"].strip()
                ]
                if not ws:
                    continue
                words = [w["value"] for w in ws]
                boxes = [_rel_box_from_geometry(w["geometry"]) for w in ws]
                yield words, boxes


def extract_lines_with_boxes(doctr_result):
    """
    Flatten a docTR OCR result into parallel (line_boxes, line_word_boxes),
    in top-to-bottom / left-to-right reading order. One walk, one sort, so
    the two lists can never fall out of alignment.
    """
    rows = []
    for words, boxes in _walk_ocr_lines(doctr_result):
        bbox = _union_box(boxes)
        rows.append((LineBox(words=words, bbox=bbox), boxes))
    rows.sort(key=lambda r: (round(r[0].bbox[1], 3), r[0].bbox[0]))
    line_boxes = [r[0] for r in rows]
    line_word_boxes = [r[1] for r in rows]
    return line_boxes, line_word_boxes


# ============================================================
# DRAWING / SAVING THE MASKED IMAGE
# ============================================================
def _output_path_for(image_path):
    base = os.path.basename(image_path)
    stem, ext = os.path.splitext(base)
    ext = ext.lower()
    if ext not in _WRITABLE_EXTS:
        ext = ".png"
    return os.path.join(OUTPUT_DIR, f"{stem}_masked{ext}")


def draw_masks(img, line_word_boxes, line_masks, fill=(0, 0, 0)):
    """
    img: PIL.Image (full resolution, RGB/RGBA)
    line_word_boxes: List[List[(x0,y0,x1,y1)]] relative coords, per line/word
    line_masks: List[Dict[word_idx -> pii_type]] matching line_word_boxes
    """
    from PIL import ImageDraw

    draw = ImageDraw.Draw(img)
    W, H = img.size
    boxes_masked = 0

    for word_boxes, masked in zip(line_word_boxes, line_masks):
        for idx in masked:
            if idx >= len(word_boxes):
                continue
            x0, y0, x1, y1 = word_boxes[idx]
            # small padding so anti-aliased glyph edges are fully covered
            pad_x = (x1 - x0) * 0.06
            pad_y = (y1 - y0) * 0.20
            px0 = max(0, (x0 - pad_x) * W)
            py0 = max(0, (y0 - pad_y) * H)
            px1 = min(W, (x1 + pad_x) * W)
            py1 = min(H, (y1 + pad_y) * H)
            draw.rectangle([px0, py0, px1, py1], fill=fill)
            boxes_masked += 1

    return img, boxes_masked


def _save_image(img, out_path):
    ext = os.path.splitext(out_path)[1].lower()
    if ext in _NO_ALPHA_EXTS and _has_alpha(img):
        img = img.convert("RGB")
    img.save(out_path)


# ============================================================
# MAIN PIPELINE ENTRY POINTS
# ============================================================
def _run_pipeline(img, image_source=None, env_mode=None):
    """
    Shared core: OCR a PIL image, region-segment, analyze, and draw masks
    on it IN PLACE. `image_source` (path or raw bytes) enables CV window
    detection. Returns (line_boxes, line_masks, env_mode, env_info).
    """
    from doctr.io import DocumentFile

    png_bytes, _ocr_size = _encode_for_ocr(img)
    model = get_ocr_model()
    doc = DocumentFile.from_images(png_bytes)
    result = model(doc)

    line_boxes, line_word_boxes = extract_lines_with_boxes(result)
    line_boxes, line_word_boxes, region_ids = prepare_lines_and_regions(
        line_boxes, line_word_boxes, image_source=image_source
    )
    line_masks, env_mode, env_info = analyze_page(line_boxes, region_ids, env_mode=env_mode)

    _, boxes_masked = draw_masks(img, line_word_boxes, line_masks)
    _say(
        f"{sum(len(m) for m in line_masks)} word(s) flagged across "
        f"{len(line_boxes)} line(s); {boxes_masked} boxes drawn"
    )
    return line_boxes, line_masks, env_mode, env_info


def _collect_detected(line_boxes, line_masks):
    """Flatten masks into a [(pii_type, word_text), ...] report list."""
    detected = []
    for lb, masked in zip(line_boxes, line_masks):
        for idx, pii_type in sorted(masked.items()):
            if idx < len(lb.words):
                detected.append((pii_type, lb.words[idx]))
    return detected


def mask_image(image_path, env_mode=None, verbose=True):
    """
    Full pipeline for a LOCAL file: load -> OCR -> geometry-aware masking ->
    save to OUTPUT_DIR. Returns (out_path, detected).
    """
    image_path = os.fspath(image_path)
    if not os.path.isfile(image_path):
        raise FileNotFoundError(f"No such file: {image_path}")

    img = _open_image(image_path)
    img = img.convert("RGBA" if _has_alpha(img) else "RGB")

    line_boxes, line_masks, env_mode, env_info = _run_pipeline(
        img, image_source=image_path, env_mode=env_mode
    )
    detected = _collect_detected(line_boxes, line_masks)

    out_path = _output_path_for(image_path)
    _save_image(img, out_path)

    if verbose:
        _say(f"Masked image saved to: {out_path}")
        if env_mode:
            _say(f"env mode ON (hint={env_info['hint']}, assignments={env_info['assignments']})")
        _say(f"Detected {len(detected)} PII item(s):")
        for pii_type, text in detected:
            _say(f"   - {pii_type}: {text}")
    return out_path, detected


# Back-compat alias (the pre-rewrite public name).
mask_pii_in_image = mask_image


def mask_image_bytes(data, out_format="PNG", env_mode=None):
    """
    Mask PII in an IN-MEMORY image (the service entry point). The raw bytes
    are never written to disk - only the masked result is returned.

    Returns (masked_bytes, [(pii_type, word_text), ...]).
    """
    from io import BytesIO

    img = _open_image_bytes(data)
    img = img.convert("RGBA" if _has_alpha(img) else "RGB")

    line_boxes, line_masks, _env_mode, _env_info = _run_pipeline(
        img, image_source=bytes(data), env_mode=env_mode
    )
    detected = _collect_detected(line_boxes, line_masks)

    fmt = (out_format or "PNG").upper()
    if fmt == "JPG":
        fmt = "JPEG"
    if fmt == "JPEG" and img.mode != "RGB":
        img = img.convert("RGB")
    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue(), detected


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        _say("Usage: python masking.py <image1> [image2 ...]")
        return 1
    for path in argv:
        try:
            mask_image(path)
        except Exception as exc:
            _say(f"FAILED on {path}: {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
