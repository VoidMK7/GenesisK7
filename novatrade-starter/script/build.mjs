import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");

await mkdir(output, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (["dist", "node_modules", ".git", "scripts", "package.json"].includes(entry.name)) continue;
  await cp(path.join(root, entry.name), path.join(output, entry.name), { recursive: true });
}

console.log("NovaTrade static frontend built successfully into dist/");
