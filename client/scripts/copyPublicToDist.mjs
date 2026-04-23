import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const out = join(root, "dist");
const pub = join(root, "public");

if (!existsSync(out) || !existsSync(pub)) {
  process.exit(0);
}
for (const name of readdirSync(pub)) {
  if (name.startsWith(".")) continue;
  const from = join(pub, name);
  if (statSync(from).isDirectory()) continue;
  copyFileSync(from, join(out, name));
}
