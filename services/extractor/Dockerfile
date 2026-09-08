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

# Pre-download Docling layout models at build time (avoids ~1-2 min delay on
# first runtime request). Models cached in /opt/docling-models (mounted volume
# in docker-compose for persistence across container restarts).
RUN mkdir -p /opt/docling-models && \
    DOCLING_ARTIFACT_PATH=/opt/docling-models python -c "\
from docling.document_converter import DocumentConverter; \
from docling.datamodel.base_models import InputFormat; \
from docling.datamodel.pipeline_options import PdfPipelineOptions; \
opts = PdfPipelineOptions(do_table_structure=False, do_ocr=False); \
DocumentConverter(format_options={InputFormat.PDF: {'pipeline_options': opts}}); \
print('docling models cached')"

COPY app.py .

EXPOSE 8000

# Single worker is enough; extraction is CPU-bound and requests are short.
# Docling layout inference needs ~1-2 GB RAM — uvicorn single worker keeps it bounded.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
