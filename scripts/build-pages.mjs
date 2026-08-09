import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "_site");
const siteDir = path.join(projectRoot, "site");

if (path.basename(outputDir) !== "_site") {
  throw new Error(`Refusing to replace unexpected output directory: ${outputDir}`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "assets", "screenshots"), { recursive: true });

await Promise.all([
  cp(path.join(siteDir, "index.html"), path.join(outputDir, "index.html")),
  cp(path.join(siteDir, "styles.css"), path.join(outputDir, "styles.css")),
  cp(path.join(siteDir, "favicon.svg"), path.join(outputDir, "favicon.svg")),
  cp(path.join(siteDir, "favicon-32.png"), path.join(outputDir, "favicon-32.png")),
  cp(path.join(projectRoot, "docs", "screenshots", "companion-greeting.png"), path.join(outputDir, "assets", "screenshots", "companion-greeting.png")),
  cp(path.join(projectRoot, "docs", "screenshots", "care-panel.png"), path.join(outputDir, "assets", "screenshots", "care-panel.png")),
  cp(path.join(projectRoot, "docs", "screenshots", "memory-journal.png"), path.join(outputDir, "assets", "screenshots", "memory-journal.png")),
  cp(path.join(projectRoot, "docs", "screenshots", "pet-library.png"), path.join(outputDir, "assets", "screenshots", "pet-library.png")),
  writeFile(path.join(outputDir, ".nojekyll"), "", "utf8"),
]);

console.log(`GitHub Pages site built at ${outputDir}`);
