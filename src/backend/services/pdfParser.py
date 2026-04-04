from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

REFERENCE_HEADING_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*references\s*$", re.IGNORECASE),
    re.compile(r"^\s*bibliography\s*$", re.IGNORECASE),
    re.compile(r"^\s*works cited\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d+[\.\)]?\s*references\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d+[\.\)]?\s*bibliography\s*$", re.IGNORECASE),
)

NEXT_SECTION_HEADING_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*appendix\s*$", re.IGNORECASE),
    re.compile(r"^\s*appendices\s*$", re.IGNORECASE),
    re.compile(r"^\s*acknowledg(?:e)?ments?\s*$", re.IGNORECASE),
    re.compile(
        r"^\s*supplement(?:ary|al)?\s+(?:material|materials|information)?\s*$", re.IGNORECASE),
    re.compile(r"^\s*author contributions?\s*$", re.IGNORECASE),
    re.compile(r"^\s*funding\s*$", re.IGNORECASE),
    re.compile(r"^\s*conflicts?\s+of\s+interest\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d+[\.\)]?\s*appendix\s*$", re.IGNORECASE),
)

REFERENCE_SIGNAL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(?:19|20)\d{2}\b"),                   # year
    re.compile(r"\bdoi\b", re.IGNORECASE),
    re.compile(r"\barxiv\b", re.IGNORECASE),
    re.compile(r"https?://", re.IGNORECASE),
    re.compile(r"\bet al\.\b", re.IGNORECASE),
    re.compile(r"^[A-Z][A-Za-z'`-]+,\s*[A-Z]\.", re.IGNORECASE),
    re.compile(r"\bpp?\.\s*\d+", re.IGNORECASE),
    re.compile(r"\bvol\.\s*\d+", re.IGNORECASE),
    re.compile(r"\bno\.\s*\d+", re.IGNORECASE),
    re.compile(r"\bproceedings\b", re.IGNORECASE),
    re.compile(r"\bjournal\b", re.IGNORECASE),
    re.compile(r"\bconference\b", re.IGNORECASE),
)


def extract_references_from_pdf_bytes(pdf_bytes: bytes) -> str | None:
    text = _pdf_bytes_to_text(pdf_bytes)

    print("\n" + "=" * 80)
    print("EXTRACTED PDF TEXT PREVIEW:")
    print(text[:5000])
    print("=" * 80 + "\n")

    return extract_references_from_text(text)


def _pdf_bytes_to_text(pdf_bytes: bytes) -> str:
    pdftotext_path = shutil.which("pdftotext")
    with tempfile.TemporaryDirectory() as tmp_dir:
        pdf_path = Path(tmp_dir) / "input.pdf"
        pdf_path.write_bytes(pdf_bytes)
        cmd = [pdftotext_path, "-layout", str(pdf_path), "-"]

        try:
            result = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.strip() if exc.stderr else "Unknown pdftotext error"
            raise RuntimeError(f"pdftotext failed: {stderr}") from exc

    return result.stdout


def extract_references_from_text(text: str) -> str | None:
    normalized = _normalize_text(text)
    lines = _to_lines(normalized)

    if not lines:
        return None

    start_index = _find_references_heading_bottom_up(lines)
    if start_index == -1:
        return None

    end_index = _find_references_end(lines, start_index)
    references = _clean_references_block(
        "\n".join(lines[start_index + 1: end_index]))

    return references or None


def _normalize_text(text: str) -> str:
    return (
        text.replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\u00A0", " ")
        .replace("\x0c", "\n")
    )


def _to_lines(text: str) -> list[str]:
    raw_lines = [line.strip() for line in text.split("\n")]
    lines: list[str] = []

    previous_blank = False
    for line in raw_lines:
        is_blank = line == ""
        if is_blank and previous_blank:
            continue
        lines.append(line)
        previous_blank = is_blank

    return lines


def _find_references_heading_bottom_up(lines: list[str]) -> int:
    """
    Search from the end because the real references section is usually near the end,
    while the word 'references' may appear earlier in the body text.
    """
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]

        if not _is_reference_heading(line):
            continue

        if _looks_like_references_block(lines, i):
            return i

    return -1


def _is_reference_heading(line: str) -> bool:
    if not line:
        return False

    if len(line) > 50:
        return False

    return any(pattern.fullmatch(line) for pattern in REFERENCE_HEADING_PATTERNS)


def _looks_like_references_block(lines: list[str], heading_index: int) -> bool:
    sample_lines = [
        line for line in lines[heading_index + 1: heading_index + 18] if line]
    if not sample_lines:
        return False

    signals = 0
    for line in sample_lines:
        if any(pattern.search(line) for pattern in REFERENCE_SIGNAL_PATTERNS):
            signals += 1

    return signals >= 2


def _find_references_end(lines: list[str], start_index: int) -> int:
    for i in range(start_index + 1, len(lines)):
        line = lines[i]
        if not line:
            continue

        if any(pattern.fullmatch(line) for pattern in NEXT_SECTION_HEADING_PATTERNS):
            return i

    return len(lines)


def _clean_references_block(text: str) -> str:
    cleaned_lines = [line.rstrip() for line in text.split("\n")]

    collapsed: list[str] = []
    previous_blank = False

    for line in cleaned_lines:
        is_blank = line.strip() == ""
        if is_blank and previous_blank:
            continue
        collapsed.append(line.strip())
        previous_blank = is_blank

    return "\n".join(collapsed).strip()
