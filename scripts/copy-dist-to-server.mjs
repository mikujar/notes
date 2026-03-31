import { cpSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const pub = join(root, "server", "public");
if (!existsSync(dist)) {
  console.error("Missing dist/. Run npm run build first.");
  process.exit(1);
}
if (existsSync(pub)) rmSync(pub, { recursive: true });
mkdirSync(join(root, "server"), { recursive: true });
cpSync(dist, pub, { recursive: true });
console.log("Copied dist -> server/public");
