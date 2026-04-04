from fastapi import APIRouter, File, HTTPException, UploadFile

from services.pdfParser import extract_references_from_pdf_bytes

router = APIRouter()


@router.post("/extract-references")
async def extract_references(file: UploadFile = File(...)) -> dict[str, str | None]:
    if file.content_type not in {"application/pdf"}:
        raise HTTPException(status_code=400, detail="File must be a PDF.")

    pdf_bytes = await file.read()

    try:
        references = extract_references_from_pdf_bytes(pdf_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"references": references}
