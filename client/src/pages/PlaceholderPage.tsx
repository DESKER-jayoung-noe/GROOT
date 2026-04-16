export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-slate-900 mb-2">{title}</h1>
      <p className="text-slate-600 text-sm">이 탭은 PRD 단계에 따라 순차 구현 예정입니다.</p>
    </div>
  );
}
