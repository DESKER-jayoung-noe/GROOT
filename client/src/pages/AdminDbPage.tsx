import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

export function AdminDbPage() {
  const { token, user } = useAuth();
  const [sheet, setSheet] = useState("{}");
  const [edge, setEdge] = useState("{}");
  const [proc, setProc] = useState("{}");
  const [ver, setVer] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api<{ pricingVersion: number; sheetPricesJson: string; edgePricesJson: string; processPricesJson: string }>(
        "/admin/pricing",
        { token }
      );
      setVer(r.pricingVersion);
      setSheet(r.sheetPricesJson);
      setEdge(r.edgePricesJson);
      setProc(r.processPricesJson);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "불러오기 실패");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(bump: boolean) {
    setMsg(null);
    if (!token) return;
    try {
      const r = await api<{ pricingVersion: number }>("/admin/pricing", {
        method: "PUT",
        body: JSON.stringify({
          sheetPricesJson: sheet,
          edgePricesJson: edge,
          processPricesJson: proc,
          bumpVersion: bump,
        }),
        token,
      });
      setVer(r.pricingVersion);
      setMsg(bump ? `저장되었습니다. 단가 버전: ${r.pricingVersion}` : "저장되었습니다.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "저장 실패");
    }
  }

  async function uploadExcel(file: File) {
    setMsg(null);
    if (!token) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/admin/upload-excel", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      setMsg(typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : "업로드 실패");
      return;
    }
    setMsg(`엑셀 반영 완료. 버전 ${(data as { pricingVersion: number }).pricingVersion}`);
    void load();
  }

  async function recalc() {
    setMsg(null);
    if (!token) return;
    try {
      const r = await api<{ materialsUpdated: number }>("/admin/recalculate-all", { method: "POST", token });
      setMsg(`자재 ${r.materialsUpdated}건 재계산 완료. 저장 견적에 업데이트 알림이 표시됩니다.`);
      void load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "재계산 실패");
    }
  }

  if (user?.role !== "ADMIN") return <Navigate to="/home" replace />;

  return (
    <div className="min-h-full bg-[#f8f9fa] p-6 pb-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-[#111]">데이터베이스 (관리자)</h1>
          <span className="text-sm font-semibold text-[#1e6fff]">단가 버전 v{ver}</span>
        </div>
        {msg && <p className="text-sm text-slate-700 bg-white border border-[#e0e0e0] rounded-xl px-4 py-2">{msg}</p>}

        <section className="rounded-2xl border border-[#e0e0e0] bg-white p-5 space-y-3">
          <h2 className="font-bold text-[#111]">원자재 단가표 (JSON)</h2>
          <p className="text-xs text-slate-500">PB E0 / 두께·색상·원장별 키 구조는 추후 엑셀 매핑으로 확장합니다.</p>
          <textarea
            className="w-full min-h-[140px] font-mono text-xs rounded-xl border border-[#e0e0e0] p-3"
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
          />
        </section>

        <section className="rounded-2xl border border-[#e0e0e0] bg-white p-5 space-y-3">
          <h2 className="font-bold text-[#111]">엣지 단가표 (JSON)</h2>
          <textarea
            className="w-full min-h-[120px] font-mono text-xs rounded-xl border border-[#e0e0e0] p-3"
            value={edge}
            onChange={(e) => setEdge(e.target.value)}
          />
        </section>

        <section className="rounded-2xl border border-[#e0e0e0] bg-white p-5 space-y-3">
          <h2 className="font-bold text-[#111]">가공비 단가표 (JSON)</h2>
          <p className="text-xs text-slate-500">재단·루타·보링 등 공정별 단가 키.</p>
          <textarea
            className="w-full min-h-[140px] font-mono text-xs rounded-xl border border-[#e0e0e0] p-3"
            value={proc}
            onChange={(e) => setProc(e.target.value)}
          />
        </section>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-[#1e6fff] text-white px-5 py-2 text-sm font-semibold"
            onClick={() => void save(true)}
          >
            저장 + 버전 증가
          </button>
          <button
            type="button"
            className="rounded-xl border border-[#e0e0e0] bg-white px-5 py-2 text-sm font-semibold"
            onClick={() => void save(false)}
          >
            저장만 (버전 유지)
          </button>
        </div>

        <section className="rounded-2xl border border-dashed border-[#93c5fd] bg-[#f8fbff] p-5 space-y-3">
          <h2 className="font-bold text-[#111]">엑셀 업로드</h2>
          <p className="text-xs text-slate-600">.xlsx 첫 시트를 행 배열로 파싱해 원자재 JSON에 병합·버전 증가합니다.</p>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadExcel(f);
              e.target.value = "";
            }}
          />
        </section>

        <section className="rounded-2xl border border-[#fecaca] bg-[#fff7f7] p-5 space-y-2">
          <h2 className="font-bold text-[#111]">저장 견적 재계산</h2>
          <p className="text-xs text-slate-600">저장된 자재 견적을 현재 공식으로 다시 계산하고, 금액이 바뀌면 payload에 알림 정보를 남깁니다.</p>
          <button
            type="button"
            className="rounded-xl bg-slate-900 text-white px-5 py-2 text-sm font-semibold"
            onClick={() => void recalc()}
          >
            자재 전체 재계산
          </button>
        </section>
      </div>
    </div>
  );
}
