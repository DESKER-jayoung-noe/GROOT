from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional

try:
    from .parser import parse_stp_zip as parse_stp_zip_file
    from .pdf_parser import parse_pdf
except ImportError:
    from parser import parse_stp_zip as parse_stp_zip_file
    from pdf_parser import parse_pdf

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/api/parse/stp-zip")
async def parse_stp_zip_endpoint(
    file: UploadFile = File(...),
    bom: Optional[UploadFile] = File(None),
):
    try:
        zip_bytes = await file.read()
        bom_content = None
        if bom is not None:
            bom_content = (await bom.read()).decode("utf-8-sig", errors="ignore")
        materials = parse_stp_zip_file(zip_bytes, bom_content=bom_content)
        return JSONResponse({"status": "ok", "count": len(materials), "materials": materials})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STP ZIP parse failed: {e}")


@app.post("/api/parse/pdf")
async def parse_pdf_endpoint(file: UploadFile = File(...)):
    try:
        import tempfile
        import os

        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있습니다.")
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        try:
            tmp.write(await file.read())
            tmp.close()
            parsed = parse_pdf(tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        return JSONResponse(parsed)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF parse failed: {e}")


@app.get("/api/health")
def health():
    return {"status": "ok"}
