import { forwardRef, useImperativeHandle, useMemo, useState } from "react";

export type SetTabHandle = {
  saveDraft: () => Promise<void>;
  save: () => Promise<void>;
  loadFromVault: (id: string) => Promise<void>;
};

type Status = "done" | "progress" | "wait";
type Item = {
  id: string;
  name: string;
  spec: string;
  vendor: string;
  status: Status;
  memo: string;
  mat: number;
  edge: number;
  hotmelt: number;
  proc_cut: number;
  proc_edge: number;
  proc_bore: number;
  wash: number;
  hw: number;
  bag: number;
  nk: number;
  tape: number;
  sticker: number;
};

type Extra = { id: string; name: string; vendor: string; price: string; memo: string };

const INITIAL_ITEMS: Item[] = [
  {
    id: "item-0",
    name: "뒷판 A",
    spec: "1169×550×15T · PB",
    vendor: "가나목재",
    status: "done",
    memo: "",
    mat: 6830,
    edge: 492,
    hotmelt: 292,
    proc_cut: 800,
    proc_edge: 784,
    proc_bore: 0,
    wash: 320,
    hw: 252,
    bag: 1000,
    nk: 1000,
    tape: 43,
    sticker: 6,
  },
  {
    id: "item-1",
    name: "측판 L",
    spec: "550×720×18T · PB",
    vendor: "가나목재",
    status: "done",
    memo: "",
    mat: 7200,
    edge: 540,
    hotmelt: 310,
    proc_cut: 900,
    proc_edge: 820,
    proc_bore: 62,
    wash: 198,
    hw: 0,
    bag: 0,
    nk: 1000,
    tape: 43,
    sticker: 6,
  },
  {
    id: "item-2",
    name: "측판 R",
    spec: "550×720×18T · PB",
    vendor: "가나목재",
    status: "done",
    memo: "",
    mat: 7200,
    edge: 540,
    hotmelt: 310,
    proc_cut: 900,
    proc_edge: 820,
    proc_bore: 62,
    wash: 198,
    hw: 0,
    bag: 0,
    nk: 1000,
    tape: 43,
    sticker: 6,
  },
  {
    id: "item-3",
    name: "상판",
    spec: "1200×600×18T · PB",
    vendor: "가나목재",
    status: "progress",
    memo: "6/30 납기 예정",
    mat: 9600,
    edge: 680,
    hotmelt: 380,
    proc_cut: 1100,
    proc_edge: 900,
    proc_bore: 0,
    wash: 360,
    hw: 0,
    bag: 0,
    nk: 1000,
    tape: 43,
    sticker: 6,
  },
  {
    id: "item-4",
    name: "하판",
    spec: "1163×550×18T · PB",
    vendor: "가나목재",
    status: "wait",
    memo: "",
    mat: 6500,
    edge: 480,
    hotmelt: 280,
    proc_cut: 780,
    proc_edge: 760,
    proc_bore: 0,
    wash: 320,
    hw: 0,
    bag: 0,
    nk: 1000,
    tape: 43,
    sticker: 6,
  },
];

function calc(d: Item) {
  const mat = d.mat + d.edge + d.hotmelt;
  const proc = d.proc_cut + d.proc_edge + d.proc_bore;
  const pack = d.wash + d.hw + d.bag + d.nk + d.tape + d.sticker;
  const base = mat + proc + pack;
  const ov = Math.ceil((base * 0.05) / 100) * 100;
  return { mat, proc, pack, ov, total: base + ov };
}


export const SetTab = forwardRef<
  SetTabHandle,
  {
    active?: boolean;
    quoteBindEntityId?: string | null;
    onQuoteMeta?: (meta: { name: string; grandTotalWon: number }) => void;
    onQuoteEntityRebind?: (entityId: string) => void;
    stripRenameEpoch?: number;
  }
>(function SetTab({ active = true, onQuoteMeta }, ref) {
  const [items] = useState<Item[]>(INITIAL_ITEMS);
  const [extras] = useState<Extra[]>([]);
  const [drawerItem, setDrawerItem] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [extraRows, setExtraRows] = useState<{ id: string; name: string; vendor: string; price: string; memo: string }[]>([]);

  const extraTotal = useMemo(() => extras.reduce((s, e) => s + (Number.parseInt(e.price, 10) || 0), 0), [extras]);
  const woodTotal = useMemo(() => items.reduce((s, it) => s + calc(it).total, 0), [items]);
  const total = woodTotal + extraTotal;

  useMemo(() => {
    onQuoteMeta?.({ name: "세트 견적 대시보드", grandTotalWon: total });
  }, [onQuoteMeta, total]);

  useImperativeHandle(
    ref,
    () => ({
      saveDraft: async () => undefined,
      save: async () => undefined,
      loadFromVault: async () => undefined,
    }),
    []
  );

  if (!active) return null;

  const calcItem = (d: Item) => {
    const base = d.mat+d.edge+d.hotmelt+d.proc_cut+d.proc_edge+d.proc_bore+d.wash+d.hw+d.bag+d.nk+d.tape+d.sticker;
    const ov = Math.ceil(base*0.05/100)*100;
    return {mat:d.mat+d.edge+d.hotmelt, proc:d.proc_cut+d.proc_edge+d.proc_bore, pack:d.wash+d.hw+d.bag+d.nk+d.tape+d.sticker, ov, total:base+ov};
  };
  const STATUS_LABEL: Record<string,string> = {done:'완료',progress:'진행중',wait:'대기'};
  const STATUS_CLS: Record<string,string> = {done:'bd-done',progress:'bd-prog',wait:'bd-wait'};
  const extraRowsTotal = extraRows.reduce((s,e)=>s+(parseInt(e.price)||0),0);
  const itemsTotal = items.reduce((s,d)=>s+calcItem(d).total,0);
  const woodItemsTotal = items.reduce((s,d)=>s+(calcItem(d).mat+calcItem(d).proc),0);
  const packTotal = items.reduce((s,d)=>s+calcItem(d).pack,0);
  const grandTotal = itemsTotal + extraRowsTotal;

  return (
    <>
      <div className="page active" style={{display:'flex'}}>
        <div className="set-body">
          {/* Summary cards */}
          <div className="dash-grid">
            <div className="dash-card">
              <div className="dc-label">공장판매가 합계</div>
              <div className="dc-value">{grandTotal.toLocaleString()}원</div>
              <div className="dc-sub">단품 {items.length}개 + 기타 {extraRows.length}개</div>
            </div>
            <div className="dash-card">
              <div className="dc-label">목재 단품 소계</div>
              <div className="dc-value">{woodItemsTotal.toLocaleString()}원</div>
              <div className="dc-sub">자재비 + 가공비 {grandTotal?`· ${Math.round(woodItemsTotal/grandTotal*100)}%`:''}</div>
            </div>
            <div className="dash-card">
              <div className="dc-label">포장비 소계</div>
              <div className="dc-value">{packTotal.toLocaleString()}원</div>
              <div className="dc-sub">세척·철물·박스 {grandTotal?`· ${Math.round(packTotal/grandTotal*100)}%`:''}</div>
            </div>
            <div className="dash-card">
              <div className="dc-label">기타 항목 소계</div>
              <div className="dc-value">{extraRowsTotal.toLocaleString()}원</div>
              <div className="dc-sub">{extraRows.length?extraRows.length+'개 항목':'아직 없음'}</div>
            </div>
          </div>

          {/* Items table */}
          <div className="sc">
            <div className="sc-head">
              <div className="sc-title">목재 단품<span className="sc-count">{items.length}개</span></div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width:3,padding:0}} />
                  <th>항목명</th><th>업체</th><th>납기 상태</th><th>메모</th><th className="r">공장판매가</th>
                </tr>
              </thead>
              <tbody>
                {items.map(d=>{
                  const c = calcItem(d);
                  return (
                    <tr key={d.id} onClick={()=>{setDrawerItem(d.id);setDrawerOpen(true);}}>
                      <td className={`td-status-bar td-status-bar--${d.status}`} />
                      <td><div className="td-name">{d.name}</div><div className="td-sub">{d.spec}</div></td>
                      <td><span className="td-vtag">{d.vendor}</span></td>
                      <td style={{textAlign:'center'}}><span className={`bd ${STATUS_CLS[d.status]}`}>{STATUS_LABEL[d.status]}</span></td>
                      <td style={{fontSize:'10px',color:'#aaa'}}>{d.memo||'—'}</td>
                      <td className="td-price">{c.total.toLocaleString()}원</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Extra items */}
          <div className="sc">
            <div className="sc-head">
              <div className="sc-title">기타 항목<span className="sc-count">{extraRows.length}개</span></div>
              <button className="sc-add" onClick={()=>setExtraRows(r=>[...r,{id:String(Date.now()),name:'',vendor:'',price:'',memo:''}])}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                항목 추가
              </button>
            </div>
            {extraRows.length>0 && (
              <div style={{display:'flex',gap:'8px',padding:'6px 16px',background:'#fafafa',borderBottom:'1px solid #f0f0f0',fontSize:'10px',color:'#aaa',fontWeight:'600'}}>
                <div style={{flex:2}}>항목명</div><div style={{flex:1.2}}>업체</div><div style={{flex:1,textAlign:'right'}}>금액</div><div style={{flex:1.5}}>메모</div><div style={{width:'24px'}} />
              </div>
            )}
            {extraRows.map(e=>(
              <div key={e.id} className="ex-row">
                <input className="ei ei-name" placeholder="항목명" value={e.name} onChange={ev=>setExtraRows(r=>r.map(x=>x.id===e.id?{...x,name:ev.target.value}:x))} />
                <input className="ei ei-vendor" placeholder="업체" value={e.vendor} onChange={ev=>setExtraRows(r=>r.map(x=>x.id===e.id?{...x,vendor:ev.target.value}:x))} />
                <input className="ei ei-price" placeholder="0" type="number" value={e.price} onChange={ev=>setExtraRows(r=>r.map(x=>x.id===e.id?{...x,price:ev.target.value}:x))} />
                <input className="ei ei-memo" placeholder="메모" value={e.memo} onChange={ev=>setExtraRows(r=>r.map(x=>x.id===e.id?{...x,memo:ev.target.value}:x))} />
                <button className="ei-del" onClick={()=>setExtraRows(r=>r.filter(x=>x.id!==e.id))}>×</button>
              </div>
            ))}
            {extraRows.length===0 && <div className="ex-empty">+ 항목 추가 버튼으로 멀티탭, 경첩 등 기타 항목을 추가하세요</div>}
          </div>
        </div>
      </div>

      {/* Drawer overlay */}
      <div className={`desker-overlay${drawerOpen?' open':''}`} onClick={()=>setDrawerOpen(false)} />
      <div className={`desker-drawer${drawerOpen?' open':''}`}>
        {drawerOpen && drawerItem && (() => {
          const d = items.find(x=>x.id===drawerItem);
          if(!d) return null;
          const c = calcItem(d);
          return (
            <>
              <div className="dr-head">
                <div className="dr-title">{d.name}</div>
                <button className="dr-close" onClick={()=>setDrawerOpen(false)}>×</button>
              </div>
              <div className="dr-body">
                <div className="dr-meta">
                  <div className="dr-mi"><div className="dr-mi-lbl">규격</div><div className="dr-mi-val">{d.spec}</div></div>
                  <div className="dr-mi"><div className="dr-mi-lbl">업체</div><div className="dr-mi-val">{d.vendor}</div></div>
                  <div className="dr-mi"><div className="dr-mi-lbl">납기 상태</div><div className="dr-mi-val">{STATUS_LABEL[d.status]}</div></div>
                  <div className="dr-mi"><div className="dr-mi-lbl">메모</div><div className="dr-mi-val">{d.memo||'—'}</div></div>
                </div>
                <div className="dr-sec">원재료비</div>
                <div className="dr-row"><span className="l">목재 원재료비</span><span className="r">{d.mat.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">엣지 원재료비</span><span className="r">{d.edge.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">핫멜트</span><span className="r">{d.hotmelt.toLocaleString()}원</span></div>
                <div className="dr-sub"><span>자재비 소계</span><span>{c.mat.toLocaleString()}원</span></div>
                <div className="dr-sec">가공비</div>
                <div className="dr-row"><span className="l">재단</span><span className="r">{d.proc_cut.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">엣지 접착</span><span className="r">{d.proc_edge.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">보링류</span><span className="r">{d.proc_bore.toLocaleString()}원</span></div>
                <div className="dr-sub"><span>가공비 소계</span><span>{c.proc.toLocaleString()}원</span></div>
                <div className="dr-sec">포장비</div>
                <div className="dr-row"><span className="l">세척비</span><span className="r">{d.wash.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">철물 포장비</span><span className="r">{d.hw.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">비닐 묶음</span><span className="r">{d.bag.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">뽁뽁이 포장</span><span className="r">{d.nk.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">테이프</span><span className="r">{d.tape.toLocaleString()}원</span></div>
                <div className="dr-row"><span className="l">스티커</span><span className="r">{d.sticker.toLocaleString()}원</span></div>
                <div className="dr-sub"><span>포장비 소계</span><span>{c.pack.toLocaleString()}원</span></div>
                <div className="dr-sec">일반관리비</div>
                <div className="dr-row"><span className="l">관리비 (×5%)</span><span className="r">{c.ov.toLocaleString()}원</span></div>
                <div className="dr-sub"><span>관리비</span><span>{c.ov.toLocaleString()}원</span></div>
                <div className="dr-div" />
                <div className="dr-total"><span>공장판매가</span><span>{c.total.toLocaleString()}원</span></div>
              </div>
            </>
          );
        })()}
      </div>
    </>
  );
});

