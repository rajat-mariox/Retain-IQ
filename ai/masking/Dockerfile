# PII screenshot-masking micro-service.
# CPU-only torch (keeps the image ~10x smaller than the CUDA build) + docTR OCR.
# The pretrained model is baked into the image at build time so the container
# starts offline and serves the first request without a download.
FROM python:3.12-slim

# docTR pulls opencv, which needs libGL + glib at runtime; curl is for the healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Survive slow/flaky PyPI links: long read timeout + many retries so a single
# stalled chunk doesn't fail the whole build (torch wheels are large).
ENV PIP_DEFAULT_TIMEOUT=300 \
    PIP_RETRIES=10 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# CPU wheels only — the default index would drag in the multi-GB CUDA build.
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install python-doctr pillow python-dotenv

# Bake the OCR weights into the image (~/.cache/doctr) so startup needs no
# network. This layer sits BEFORE the code COPY so editing masking.py/service.py
# never re-downloads the model. Both pairs are baked: the mobilenet pair the
# container runs with (CPU: seconds per screenshot instead of minutes), and the
# accuracy-first defaults in case DOCTR_*_ARCH is overridden at runtime.
RUN python -c "from doctr.models import ocr_predictor; \
    ocr_predictor(det_arch='db_mobilenet_v3_large', reco_arch='crnn_mobilenet_v3_small', pretrained=True); \
    ocr_predictor(pretrained=True)"

COPY masking.py service.py ./

ENV MASKING_HOST=0.0.0.0 \
    MASKING_PORT=8099 \
    OUTPUT_DIR=/tmp/masked_output \
    DOCTR_DET_ARCH=db_mobilenet_v3_large \
    DOCTR_RECO_ARCH=crnn_mobilenet_v3_small
EXPOSE 8099

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8099/health || exit 1

CMD ["python", "service.py"]
