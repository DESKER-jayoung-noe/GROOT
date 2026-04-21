import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "..");
const src = path.join(clientRoot, "dist", "index.html");
const destDir = path.join(clientRoot, "share");
const dest = path.join(destDir, "groot-latest.html");

if (!fs.existsSync(src)) {
  console.error("dist/index.html 이 없습니다. 먼저 npm run build 를 실행하세요.");
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
const kb = (fs.statSync(dest).size / 1024).toFixed(1);
console.log(`공유용 단일 HTML 생성: share/groot-latest.html (${kb} KB)`);
