FROM python:3.12-slim

# System deps:
#   - Tesseract OCR (rus+eng) + poppler for pdf rendering (text extraction).
#   - LibreOffice (headless) + fonts for DOCX/DOC → PDF conversion (unified preview).
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-rus \
      tesseract-ocr-eng \
      poppler-utils \
      libgl1 \
      libreoffice-writer \
      fonts-dejavu \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Warm the LibreOffice user profile once at build time so the first request
# doesn't pay the profile-init cost.
ENV HOME=/tmp

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8000

# Single worker is enough; extraction is CPU-bound and requests are short.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
