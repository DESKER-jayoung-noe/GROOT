/**
 * +태그 팝오버 — 입력 + 자동완성 (세트의 기존 태그 리스트)
 */
import { useEffect, useRef, useState } from "react";

export function TagAddPopover({
  existingTags,
  currentPartTags,
  onAdd,
  onClose,
}: {
  /** 세트 전체에서 사용 중인 태그 (자동완성용) */
  existingTags: string[];
  /** 이 단품에 이미 있는 태그 — 중복 거부용 */
  currentPartTags: string[];
  onAdd: (tag: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // 다음 tick 부터 등록 (현재 클릭이 잡히지 않게)
    const tid = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  const cleaned = input.trim();
  const suggestions = existingTags
    .filter((t) => !currentPartTags.includes(t))
    .filter((t) => (cleaned ? t.toLowerCase().includes(cleaned.toLowerCase()) : true))
    .slice(0, 8);

  const handleAdd = (tag: string) => {
    const v = tag.trim();
    if (!v) return;
    if (currentPartTags.includes(v)) {
      // 중복 — UX: 입력 필드 깜빡임 (간단히 무시)
      return;
    }
    onAdd(v);
    setInput("");
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%", left: 0, marginTop: 4,
        minWidth: 200, maxWidth: 260,
        background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6,
        boxShadow: "0 6px 20px rgba(0,0,0,.10)",
        zIndex: 30, padding: 6,
        fontFamily: "Pretendard, system-ui",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); handleAdd(input); }
          if (e.key === "Escape") onClose();
        }}
        placeholder="태그 입력 후 Enter"
        style={{
          width: "100%", height: 26, padding: "0 8px", fontSize: 11,
          border: "1px solid #E0E0E0", borderRadius: 4, outline: "none",
          fontFamily: "inherit",
        }}
      />
      {suggestions.length > 0 ? (
        <div style={{ marginTop: 6, fontSize: 10, color: "#7E7E7E", letterSpacing: "0.04em", padding: "4px 6px" }}>
          기존 태그
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 4px" }}>
        {suggestions.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleAdd(t)}
            style={{
              padding: "3px 8px", fontSize: 10,
              background: "#F5F5F5", color: "#282828",
              border: "1px solid #E8E8E8", borderRadius: 999,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >+ {t}</button>
        ))}
      </div>
      {cleaned && !existingTags.includes(cleaned) && !currentPartTags.includes(cleaned) ? (
        <div style={{ marginTop: 6, padding: "4px 8px", fontSize: 10, color: "#7E7E7E" }}>
          Enter 로 새 태그 “{cleaned}” 추가
        </div>
      ) : null}
    </div>
  );
}
