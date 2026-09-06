FROM python:3.12-slim

# System deps: Tesseract OCR (rus+eng) + poppler for pdf rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-rus \
      tesseract-ocr-eng \
      poppler-utils \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8000

# Single worker is enough; extraction is CPU-bound and requests are short.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
