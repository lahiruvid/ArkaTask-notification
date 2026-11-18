import { existsSync, rmSync, readdirSync, statSync, createWriteStream } from "fs";
import { join, relative, sep } from "path";
import { spawnSync } from "child_process";
import { cwd } from "process";

const outDir = join(cwd(), "out");
const zipPath = join(cwd(), "dclean-cloudflare.zip");

if (!existsSync(outDir)) {
  console.error("Missing out/ folder. Run: npm run build");
  process.exit(1);
}

if (existsSync(zipPath)) rmSync(zipPath);

/**
 * Windows Compress-Archive / Explorer ZIP often breaks Cloudflare Pages
 * subdirectory extraction (_next 404s). Prefer `tar` which writes Linux-friendly zips.
 */
const tar = spawnSync(
  "tar",
  ["-a", "-c", "-f", zipPath, "-C", outDir, "."],
  { encoding: "utf8" }
);

if (tar.status !== 0 || !existsSync(zipPath)) {
  console.error(tar.stderr || tar.stdout || "tar zip failed");
  console.error("Fallback: upload the out/ FOLDER (not zip) via drag-and-drop.");
  process.exit(1);
}

// Sanity: zip must contain _next assets with forward-slash style paths when listed via tar
const list = spawnSync("tar", ["-tf", zipPath], { encoding: "utf8" });
const names = (list.stdout || "").split(/\r?\n/).filter(Boolean);
const hasNext = names.some((n) => n.includes("_next/static") || n.includes("_next\\static"));
const hasCss = names.some((n) => n.includes(".css"));

console.log(`Created: ${zipPath}`);
console.log(`Files in zip: ${names.length}`);
console.log(`Contains _next: ${hasNext}, css: ${hasCss}`);
if (!hasNext) {
  console.error("WARNING: zip may be missing _next — upload the out/ folder instead.");
  process.exit(1);
}
console.log("");
console.log("Cloudflare Pages → Upload assets:");
console.log("  1) Prefer drag-and-drop the out/ FOLDER (most reliable)");
console.log("  2) Or upload this zip");
