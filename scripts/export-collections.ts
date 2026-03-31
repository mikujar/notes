import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collections } from "../src/data.ts";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "../server/data");
const outFile = join(outDir, "collections.json");
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(collections, null, 2)}\n`);
console.log("Wrote", outFile);
