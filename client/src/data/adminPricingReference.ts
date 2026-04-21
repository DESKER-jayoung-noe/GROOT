/**
 * 앱 계산에 사용되는 원자재·엣지·가공 단가 요약 (읽기 전용 참고용)
 * — 자재 탭 SHEET_PRICE_BY_THICKNESS, materialCalc, pricing, productCalc 기준
 */

export const SHEET_PRICES_WON: { thicknessMm: number; sheets: { id: string; label: string; priceWon: number }[] }[] = [
  {
    thicknessMm: 12,
    sheets: [{ id: "4x8", label: "4×8", priceWon: 16720 }],
  },
  {
    thicknessMm: 15,
    sheets: [
      { id: "4x6", label: "4×6", priceWon: 14450 },
      { id: "4x8", label: "4×8", priceWon: 19060 },
      { id: "6x8", label: "6×8", priceWon: 27320 },
    ],
  },
  {
    thicknessMm: 18,
    sheets: [
      { id: "4x6", label: "4×6", priceWon: 16620 },
      { id: "4x8", label: "4×8", priceWon: 21510 },
      { id: "6x8", label: "6×8", priceWon: 30650 },
    ],
  },
  {
    thicknessMm: 22,
    sheets: [
      { id: "4x8", label: "4×8", priceWon: 24680 },
      { id: "6x8", label: "6×8", priceWon: 35610 },
    ],
  },
  {
    thicknessMm: 25,
    sheets: [{ id: "4x8", label: "4×8", priceWon: 6640 }],
  },
  {
    thicknessMm: 28,
    sheets: [
      { id: "4x8", label: "4×8", priceWon: 29620 },
      { id: "6x8", label: "6×8", priceWon: 42600 },
    ],
  },
];

/** ABS 1T WW — 두께(mm) 구간별 원/m (BI는 0원·별도) */
export const EDGE_ABS1T_WW_WON_PER_M: { maxThicknessMm: number; wonPerM: number }[] = [
  { maxThicknessMm: 12, wonPerM: 139 },
  { maxThicknessMm: 15, wonPerM: 143 },
  { maxThicknessMm: 18, wonPerM: 159 },
  { maxThicknessMm: 21, wonPerM: 224 },
  { maxThicknessMm: 999, wonPerM: 280 },
];

/** ABS 2T WW */
export const EDGE_ABS2T_WW_WON_PER_M: { maxThicknessMm: number; wonPerM: number }[] = [
  { maxThicknessMm: 15, wonPerM: 251 },
  { maxThicknessMm: 18, wonPerM: 293 },
  { maxThicknessMm: 999, wonPerM: 364 },
];

/** 45° 엣지 도장 유형별 원/m */
export const EDGE45_PAINT_RATES_WON_PER_M: { label: string; wonPerM: number }[] = [
  { label: "직각+코팅", wonPerM: 2500 },
  { label: "직각+테이핑", wonPerM: 3500 },
  { label: "코팅+스프레이", wonPerM: 3750 },
  { label: "줄눈도장(메지)", wonPerM: 4500 },
  { label: "테이퍼", wonPerM: 12000 },
  { label: "테이퍼+테이핑", wonPerM: 13000 },
];

/** 핫멜트 — 두께(mm) 구간별 ㎡당 원 (엣지 길이 환산에 사용) */
export const HOTMELT_WON_PER_M2: { maxThicknessMm: number; won: number }[] = [
  { maxThicknessMm: 12, won: 72 },
  { maxThicknessMm: 15, won: 85 },
  { maxThicknessMm: 18, won: 99 },
  { maxThicknessMm: 22, won: 116 },
  { maxThicknessMm: 999, won: 143 },
];

/** 재단비 — 배치 수량(EA) 구간별 원 */
export const CUTTING_FEE_BY_PLACEMENT_EA: { minEa: number; feeWon: number }[] = [
  { minEa: 46, feeWon: 150 },
  { minEa: 33, feeWon: 200 },
  { minEa: 21, feeWon: 250 },
  { minEa: 13, feeWon: 300 },
  { minEa: 9, feeWon: 350 },
  { minEa: 5, feeWon: 500 },
  { minEa: 3, feeWon: 800 },
  { minEa: 1, feeWon: 1000 },
];

/** 기타 가공·포장 (단품 계산 등) */
export const MISC_PROC_RATES = {
  formingWonPerM: 1000,
  rutaWonPerM: 2000,
  ruta2WonPerM: 1000,
  assemblyWonPerH: 35,
  washWonPerM2: 500,
  boring1WonPerEa: 100,
  boring2WonPerEa: 50,
  curvedMachiningWonPerM: 3000,
  curvedManualWonPerM: 2000,
  edge45TapingWonPerM: 500,
  tapeWonPerM: 15.42,
  stickerWonPerEa: 5.5,
  cleanWonPerM2: 500,
  hardwareWonPerEa: 500,
  defaultAdminRate: 0.05,
} as const;
