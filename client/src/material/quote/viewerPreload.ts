/**
 * 검토 모달 진입 시점에 무거운 미리보기 라이브러리를 백그라운드 import.
 * three.js / occt-import-js / pdfjs-dist / jszip 모두 첫 자재 렌더 전에 캐시 워밍.
 */

let _occtPromise: Promise<unknown> | null = null;
let _occtFailed = false;

export function preloadOcct(): Promise<unknown> {
  if (_occtFailed) return Promise.reject(new Error("occt-import-js 로드 실패"));
  if (!_occtPromise) {
    _occtPromise = (async () => {
      const m = await import("occt-import-js");
      // Vite ?url import 로 WASM 파일 URL 확보
      const wasmUrl = (await import("occt-import-js/dist/occt-import-js.wasm?url")).default;
      const init = (m as { default?: (opts?: unknown) => Promise<unknown> }).default ?? (m as unknown as (opts?: unknown) => Promise<unknown>);
      return (init as (opts?: unknown) => Promise<unknown>)({
        locateFile: (file: string) => {
          if (file.endsWith(".wasm")) return wasmUrl;
          return file;
        },
      });
    })().catch((e) => {
      _occtFailed = true;
      _occtPromise = null;
      throw e;
    });
  }
  return _occtPromise;
}

export function isOcctFailed(): boolean {
  return _occtFailed;
}

let _threePromise: Promise<unknown> | null = null;
export function preloadThree(): Promise<unknown> {
  if (!_threePromise) _threePromise = import("three");
  return _threePromise;
}

let _orbitPromise: Promise<unknown> | null = null;
export function preloadOrbit(): Promise<unknown> {
  if (!_orbitPromise) _orbitPromise = import("three/examples/jsm/controls/OrbitControls.js");
  return _orbitPromise;
}

let _jszipPromise: Promise<unknown> | null = null;
export function preloadJszip(): Promise<unknown> {
  if (!_jszipPromise) _jszipPromise = import("jszip");
  return _jszipPromise;
}

let _pdfPromise: Promise<unknown> | null = null;
export function preloadPdfjs(): Promise<unknown> {
  if (!_pdfPromise) {
    _pdfPromise = (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      // 워커 URL 설정 (Vite ?url 임포트로 번들에 포함되게)
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return _pdfPromise;
}

/** 검토 모달 진입 시 한 번에 모든 lib 로딩 시작 (await 안 하고 백그라운드) */
export function preloadAllViewers(): void {
  preloadThree().catch(() => {});
  preloadOrbit().catch(() => {});
  preloadJszip().catch(() => {});
  preloadOcct().catch(() => {});
  preloadPdfjs().catch(() => {});
}
