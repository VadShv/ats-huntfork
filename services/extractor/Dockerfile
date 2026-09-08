FROM python:3.12-slim

# System deps:
#   - Tesseract OCR (rus+eng) + poppler for pdf rendering (text extraction).
#   - LibreOffice (headless) + fonts for DOCX/DOC → PDF conversion (unified preview).
#   - libglib2.0-0 + libsm6 + libxext6 + libxrender1 for Docling/PyTorch.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-rus \
      tesseract-ocr-eng \
      poppler-utils \
      libgl1 \
      libreoffice-writer \
      fonts-dejavu \
      fonts-liberation \
      libglib2.0-0 \
      libsm6 \
      libxext6 \
      libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Warm the LibreOffice user profile once at build time so the first request
# doesn't pay the profile-init cost.
ENV HOME=/tmp

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Docling models are downloaded on first runtime use and cached in
# /opt/docling-models (mounted volume in docker-compose for persistence).
# Pre-downloading at build time requires docling-parse (not in slim) + ~2 GB disk
# which doesn't fit the build layer; runtime download on first request is acceptable.

COPY app.py .

EXPOSE 8000

# Single worker is enough; extraction is CPU-bound and requests are short.
# Docling layout inference needs ~1-2 GB RAM — uvicorn single worker keeps it bounded.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
