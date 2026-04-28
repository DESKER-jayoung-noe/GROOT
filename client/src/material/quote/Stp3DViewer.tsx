import { useEffect, useRef, useState } from "react";
import { preloadOcct, preloadThree, preloadOrbit, preloadJszip } from "./viewerPreload";

type Props = {
  /** ZIP 또는 STP 파일. ZIP이면 stpName 으로 내부 추출 */
  uploadFile: File;
  /** ZIP 내부 STP 파일명 (대소문자 무관) */
  stpName: string;
};

type Status = "loading" | "extracting" | "parsing" | "rendering" | "ready" | "error";

export function Stp3DViewer({ uploadFile, stpName }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        setStatus("loading");
        // 라이브러리 로드 (preload 가 이미 시작했을 수도 있음)
        const [threeMod, orbitMod, jszipMod, occt] = await Promise.all([
          preloadThree(),
          preloadOrbit(),
          preloadJszip(),
          preloadOcct(),
        ]);
        if (cancelled || !mountRef.current) return;

        const THREE = threeMod as typeof import("three");
        const { OrbitControls } = orbitMod as typeof import("three/examples/jsm/controls/OrbitControls.js");
        const JSZip = (jszipMod as { default: typeof import("jszip") }).default ?? (jszipMod as typeof import("jszip"));

        // STP 바이너리 확보
        let stpBuf: ArrayBuffer;
        const lname = uploadFile.name.toLowerCase();
        if (lname.endsWith(".stp") || lname.endsWith(".step")) {
          stpBuf = await uploadFile.arrayBuffer();
        } else {
          setStatus("extracting");
          const zip = await (JSZip as unknown as { loadAsync: (f: File) => Promise<{ files: Record<string, { name: string; async: (t: string) => Promise<ArrayBuffer> }> }> }).loadAsync(uploadFile);
          const target = stpName.toLowerCase();
          const entry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(target));
          if (!entry) throw new Error(`ZIP 내부에서 '${stpName}' 을 찾지 못했습니다`);
          stpBuf = await entry.async("arraybuffer");
        }
        if (cancelled) return;

        setStatus("parsing");
        const result = (occt as unknown as { ReadStepFile: (b: Uint8Array) => { meshes: Array<{ attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } }; index?: { array: ArrayLike<number> } }> } }).ReadStepFile(new Uint8Array(stpBuf));
        if (cancelled) return;
        if (!result || !result.meshes || result.meshes.length === 0) {
          throw new Error("STP에서 메시를 추출하지 못했습니다");
        }

        setStatus("rendering");

        // three.js 씬 셋업
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xF5F5F2);

        const w = mountRef.current.clientWidth || 400;
        const h = mountRef.current.clientHeight || 400;
        const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100000);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        mountRef.current.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        // 메시 추가 — 반투명 본체 + 검은 외곽선 (홀 가장자리도 자연스럽게 강조됨)
        const group = new THREE.Group();
        result.meshes.forEach((m) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(Array.from(m.attributes.position.array), 3));
          if (m.attributes.normal) {
            g.setAttribute("normal", new THREE.Float32BufferAttribute(Array.from(m.attributes.normal.array), 3));
          } else {
            g.computeVertexNormals();
          }
          if (m.index) {
            g.setIndex(new THREE.Uint32BufferAttribute(Array.from(m.index.array), 1));
          }
          // 1) 본체: 반투명 (홀이 비쳐 보이게)
          const mat = new THREE.MeshStandardMaterial({
            color: 0xE8E4DA,
            metalness: 0.05,
            roughness: 0.85,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.55,
            depthWrite: false, // 반투명 z-fighting 완화
          });
          group.add(new THREE.Mesh(g, mat));

          // 2) 외곽선: 평면↔곡면 경계각 30° 이상인 엣지를 검정 선으로 (홀의 원형 경계 포함)
          const edges = new THREE.EdgesGeometry(g, 30);
          const lineMat = new THREE.LineBasicMaterial({
            color: 0x282828,
            transparent: true,
            opacity: 0.9,
          });
          const lines = new THREE.LineSegments(edges, lineMat);
          lines.renderOrder = 1; // 본체 위에 그려지도록
          group.add(lines);
        });
        scene.add(group);

        // 카메라 자동 fit
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 100;
        const dist = maxDim * 1.6;
        camera.position.set(center.x + dist, center.y + dist, center.z + dist);
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();

        // 조명
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const dl1 = new THREE.DirectionalLight(0xffffff, 0.7);
        dl1.position.set(maxDim, maxDim * 1.5, maxDim);
        scene.add(dl1);
        const dl2 = new THREE.DirectionalLight(0xffffff, 0.35);
        dl2.position.set(-maxDim, -maxDim * 0.5, -maxDim * 0.5);
        scene.add(dl2);

        // 렌더 루프
        let rafId = 0;
        const animate = () => {
          if (cancelled) return;
          rafId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        // 리사이즈 옵저버
        const onResize = () => {
          if (!mountRef.current) return;
          const nw = mountRef.current.clientWidth;
          const nh = mountRef.current.clientHeight;
          if (nw === 0 || nh === 0) return;
          renderer.setSize(nw, nh);
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(mountRef.current);

        setStatus("ready");

        cleanup = () => {
          cancelAnimationFrame(rafId);
          ro.disconnect();
          controls.dispose();
          if (mountRef.current?.contains(renderer.domElement)) {
            mountRef.current.removeChild(renderer.domElement);
          }
          renderer.dispose();
          group.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (Array.isArray(m)) m.forEach((x) => x.dispose());
            else if (m) m.dispose();
          });
        };
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrMsg(e instanceof Error ? e.message : "미리보기 불가");
      }
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [uploadFile, stpName]);

  const statusLabel: Record<Status, string> = {
    loading:    "3D 모델 로딩 중...",
    extracting: "ZIP 추출 중...",
    parsing:    "STP 분석 중...",
    rendering:  "메시 렌더링 중...",
    ready:      "",
    error:      "",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%", background: "#F5F5F2" }} />
      {status !== "ready" && status !== "error" && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(245,245,242,0.9)", flexDirection: "column", gap: 8,
            color: "#7E7E7E", fontSize: 12,
          }}
        >
          <div className="loading-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "#282828", animation: "pulse 1s infinite" }} />
          <div>{statusLabel[status]}</div>
        </div>
      )}
      {status === "error" && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "#F5F5F2", flexDirection: "column", gap: 6, color: "#7E7E7E", fontSize: 12, padding: 16, textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "#282828", fontWeight: 500 }}>미리보기 불가</div>
          <div style={{ fontSize: 11 }}>STP 파일은 정상 등록됩니다 — 우측에서 수치 확인/수정만 진행하세요.</div>
          {errMsg ? <div style={{ fontSize: 10, color: "#B3B3B3", marginTop: 4 }}>{errMsg}</div> : null}
        </div>
      )}
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.3 } 50% { opacity: 1 } }
      `}</style>
    </div>
  );
}
