import { useEffect, useRef, useState } from "react";
import { preloadPdfjs } from "./viewerPreload";

type Props = { uploadFile: File };
type Status = "loading" | "ready" | "error";

export function PdfViewer({ uploadFile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [zoom, setZoom] = useState(1.0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pdfDocRef = useRef<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }>; numPages: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("loading");
        const pdfjs = await preloadPdfjs();
        if (cancelled) return;
        const buf = await uploadFile.arrayBuffer();
        const doc = await ((pdfjs as unknown as { getDocument: (o: unknown) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }>; numPages: number }> } }).getDocument({ data: buf }).promise);
        if (cancelled) return;
        pdfDocRef.current = doc;
        setTotalPages(doc.numPages);
        setPage(1);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrMsg(e instanceof Error ? e.message : "PDF 로드 실패");
      }
    })();
    return () => { cancelled = true; };
  }, [uploadFile]);

  useEffect(() => {
    if (status !== "ready" || !pdfDocRef.current || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await pdfDocRef.current!.getPage(page);
      if (cancelled || !canvasRef.current) return;
      const viewport = p.getViewport({ scale: zoom * 1.4 });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await p.render({ canvasContext: ctx, viewport }).promise;
    })();
    return () => { cancelled = true; };
  }, [page, zoom, status]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#F5F5F2" }}>
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#7E7E7E", fontSize: 12, gap: 8, flexDirection: "column" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#282828", animation: "pulse 1s infinite" }} />
          PDF 로딩 중...
        </div>
      )}
      {status === "error" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, color: "#7E7E7E", fontSize: 12, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#282828", fontWeight: 500 }}>미리보기 불가</div>
          <div style={{ fontSize: 11 }}>PDF 파일은 정상 등록됩니다.</div>
          {errMsg ? <div style={{ fontSize: 10, color: "#B3B3B3", marginTop: 4 }}>{errMsg}</div> : null}
        </div>
      )}
      {status === "ready" && (
        <>
          <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "flex", justifyContent: "center", padding: 16 }}>
            <canvas ref={canvasRef} style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }} />
          </div>
          {/* 줌/페이지 컨트롤 */}
          <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 4, background: "#fff", border: "1px solid #D6D6D6", borderRadius: 4, padding: 2 }}>
            <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} style={zoomBtn}>+</button>
            <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} style={zoomBtn}>−</button>
            <button onClick={() => setZoom(1)} style={zoomBtn} title="100%">⊡</button>
          </div>
          {totalPages > 1 && (
            <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", background: "#fff", border: "1px solid #D6D6D6", borderRadius: 4, padding: "4px 10px", fontSize: 11, color: "#282828" }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={{ ...zoomBtn, width: 22, height: 22 }}>◀</button>
              <span>{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ ...zoomBtn, width: 22, height: 22 }}>▶</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  width: 28, height: 28, border: "none", background: "transparent", cursor: "pointer",
  fontSize: 13, color: "#282828", display: "flex", alignItems: "center", justifyContent: "center",
};
