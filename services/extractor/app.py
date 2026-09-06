"""
Resume text extractor service.

Layout-aware text extraction for resumes that the JS pdf-parse mangles
(two-column / designer PDFs, e.g. «ЛучкинаАлла», «Пониманиепринципов»).

Pipeline:
  1. PDF → pdfplumber with column detection (reads columns in correct visual order).
  2. If a page yields little/no text (scanned image) → Tesseract OCR (rus+eng),
     with grayscale + threshold preprocessing for accuracy.
  3. DOCX → python-docx.

Returns clean text in the correct reading order. The Node app calls this over
HTTP and falls back to its own pdf-parse if the service is unavailable.
"""
import io
import logging
import re

from fastapi import FastAPI, File, HTTPException, UploadFile

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("extractor")

app = FastAPI(title="reqcore-extractor", version="1.0")

MAX_BYTES = 15 * 1024 * 1024  # 15 MB


@app.get("/health")
def health():
    return {"ok": True}


def _cluster_columns(words, page_width, gap_ratio=0.18):
    """
    Group words into columns by their x-position, then order top→bottom within
    each column, columns left→right. This restores reading order for multi-column
    layouts where a naive top-to-bottom pass interleaves columns.
    """
    if not words:
        return ""
    xs = sorted(w["x0"] for w in words)
    # Detect a big horizontal gap → column boundary.
    boundaries = []
    for i in range(1, len(xs)):
        if xs[i] - xs[i - 1] > page_width * gap_ratio:
            boundaries.append((xs[i - 1] + xs[i]) / 2)
    # Assign each word to a column bucket.
    def col_of(x):
        c = 0
        for b in boundaries:
            if x > b:
                c += 1
        return c
    from collections import defaultdict
    cols = defaultdict(list)
    for w in words:
        cols[col_of(w["x0"])].append(w)
    parts = []
    for c in sorted(cols.keys()):
        # Order by line (top), then x within line.
        rows = sorted(cols[c], key=lambda w: (round(w["top"] / 3), w["x0"]))
        line_top = None
        buf = []
        for w in rows:
            t = round(w["top"] / 3)
            if line_top is None or t == line_top:
                buf.append(w["text"])
            else:
                parts.append(" ".join(buf))
                buf = [w["text"]]
            line_top = t
        if buf:
            parts.append(" ".join(buf))
    return "\n".join(parts)


def _detect_column_boundaries(page, gap_ratio=0.06):
    """
    Find vertical whitespace gutters that separate columns. Uses word x-ranges:
    a boundary is a wide x-gap that persists (few words straddle it).
    Returns sorted list of x-cut positions (may be empty for single-column).
    """
    words = page.extract_words(use_text_flow=False)
    if len(words) < 20:
        return []
    # Build coverage of x-axis by word spans; find empty vertical bands.
    W = page.width
    bins = 100
    covered = [0] * bins
    for w in words:
        a = max(0, int(w["x0"] / W * bins))
        b = min(bins - 1, int(w["x1"] / W * bins))
        for i in range(a, b + 1):
            covered[i] += 1
    # A gutter = run of empty bins wide enough.
    cuts = []
    i = 0
    min_run = max(2, int(bins * gap_ratio))
    while i < bins:
        if covered[i] == 0:
            j = i
            while j < bins and covered[j] == 0:
                j += 1
            if (j - i) >= min_run and i > bins * 0.15 and j < bins * 0.9:
                cuts.append((i + j) / 2 / bins * W)
            i = j
        else:
            i += 1
    return cuts


def _extract_page_columns(page) -> str:
    """
    Extract page text preserving reading order for multi-column layouts using
    native extract_text() per column crop (keeps intra-word spacing correct,
    avoids the char-level gluing of manual word clustering).
    """
    cuts = _detect_column_boundaries(page)
    if not cuts:
        return page.extract_text(layout=False, x_tolerance=1.5) or ""
    xs = [0.0] + cuts + [page.width]
    parts = []
    for k in range(len(xs) - 1):
        crop = page.crop((xs[k], 0, xs[k + 1], page.height))
        t = crop.extract_text(layout=False, x_tolerance=1.5) or ""
        if t.strip():
            parts.append(t)
    return "\n".join(parts)


def _extract_pymupdf(data: bytes) -> tuple[str, int]:
    """
    PyMuPDF (fitz): fast, layout-aware. Extract blocks with coordinates and order
    them by column (x) then top (y), which restores reading order for multi-column
    layouts better than a naive flow on many designer PDFs.
    """
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    pages = []
    for page in doc:
        blocks = page.get_text("blocks")  # (x0,y0,x1,y1,text,block_no,block_type)
        text_blocks = [b for b in blocks if len(b) >= 5 and isinstance(b[4], str) and b[4].strip()]
        if not text_blocks:
            pages.append("")
            continue
        width = page.rect.width
        # Column split: blocks whose center-x is on left/right of the page midline,
        # only if there is a real 2-column structure (blocks on both sides).
        mid = width / 2
        left = [b for b in text_blocks if (b[0] + b[2]) / 2 < mid]
        right = [b for b in text_blocks if (b[0] + b[2]) / 2 >= mid]
        two_col = len(left) >= 3 and len(right) >= 3
        if two_col:
            ordered = sorted(left, key=lambda b: b[1]) + sorted(right, key=lambda b: b[1])
        else:
            ordered = sorted(text_blocks, key=lambda b: (b[1], b[0]))
        pages.append("\n".join(b[4].strip() for b in ordered))
    n = len(doc)
    doc.close()
    return "\n\n".join(pages), n


def _score_text(t: str) -> float:
    """
    Heuristic quality: more clean whitespace-separated Cyrillic/Latin words and
    fewer glued tokens (long alnum runs) = better. Used to pick the best engine.
    """
    if not t:
        return 0.0
    words = t.split()
    if not words:
        return 0.0
    glued = sum(1 for w in words if len(w) > 25)  # suspiciously long = glued cols
    return len(words) - glued * 5


def _extract_pdf(data: bytes) -> tuple[str, str, int]:
    """
    Returns (text, method, page_count). Runs PyMuPDF and pdfplumber, picks the
    higher-quality result; falls back to OCR for scanned pages.
    """
    import pdfplumber

    # Engine 1: PyMuPDF (fast, block-based reading order).
    mupdf_text, mupdf_pages = "", 0
    try:
        mupdf_text, mupdf_pages = _extract_pymupdf(data)
    except Exception as e:  # noqa: BLE001
        log.warning("pymupdf_failed: %s", e)

    # Engine 2: pdfplumber (column crop) + OCR fallback for scans.
    plumber_parts = []
    page_count = mupdf_pages
    ocr_used = False
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                page_text = _extract_page_columns(page)
                if len(page_text.strip()) < 30:
                    ocr_text = _ocr_page(page)
                    if len(ocr_text.strip()) > len(page_text.strip()):
                        page_text = ocr_text
                        ocr_used = True
                plumber_parts.append(page_text)
    except Exception as e:  # noqa: BLE001
        log.warning("pdfplumber_failed: %s", e)
    plumber_text = "\n\n".join(plumber_parts)

    # If a page was scanned, OCR (via pdfplumber path) wins regardless of score.
    if ocr_used:
        return plumber_text, "pdfplumber+ocr", page_count

    # Otherwise pick the higher-quality engine.
    if _score_text(mupdf_text) >= _score_text(plumber_text):
        return mupdf_text, "pymupdf", page_count or mupdf_pages
    return plumber_text, "pdfplumber", page_count


def _ocr_page(page) -> str:
    """Render a pdfplumber page to image and OCR it (grayscale + threshold)."""
    try:
        import pytesseract
        from PIL import Image

        im = page.to_image(resolution=300).original.convert("L")  # grayscale
        # Simple binarization for cleaner OCR.
        im = im.point(lambda p: 255 if p > 160 else 0)
        return pytesseract.image_to_string(im, lang="rus+eng")
    except Exception as e:  # noqa: BLE001
        log.warning("ocr_failed: %s", e)
        return ""


def _extract_docx(data: bytes) -> str:
    import docx

    d = docx.Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            parts.append("\t".join(cell.text for cell in row.cells))
    return "\n".join(parts)


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # repair syllable hyphenation across line breaks
    text = re.sub(r"([а-яёa-z])-\n([а-яёa-z])", r"\1\2", text, flags=re.I)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file too large")

    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    try:
        if name.endswith(".pdf") or "pdf" in ctype:
            text, method, pages = _extract_pdf(data)
        elif name.endswith(".docx") or "wordprocessingml" in ctype:
            text, method, pages = _extract_docx(data), "python-docx", 0
        else:
            raise HTTPException(status_code=415, detail="unsupported type")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("extract_failed")
        raise HTTPException(status_code=500, detail=f"extract failed: {e}")

    text = _normalize(text)
    return {
        "text": text,
        "method": method,
        "pageCount": pages,
        "charCount": len(text),
        "isScanned": "ocr" in method,
    }
