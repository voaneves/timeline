// Gzip-size gate for the committed bundles and the shell (caps from the plan, section 3).
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + " KB";

// [file, warn (KB gz), fail (KB gz)]
const checks = [
  ["index.html", 30, 30],
  ["assets/js/boot.min.js", 8, 8],
  ["assets/js/world/world.min.js", 260, 280],
];

let failed = false;
for (const [file, warn, fail] of checks) {
  let size;
  try {
    size = gz(file);
  } catch {
    console.log(`MISS ${file}`);
    continue;
  }
  const kbs = size / 1024;
  const state = kbs > fail ? "FAIL" : kbs > warn ? "WARN" : "ok  ";
  if (kbs > fail) failed = true;
  console.log(`${state} ${file}: ${kb(size)} gz (warn > ${warn}, fail > ${fail})`);
}

const fonts = ["schibsted-grotesk.woff2", "jetbrains-mono.woff2"];
const fontTotal = fonts.reduce((sum, f) => sum + statSync(`assets/fonts/${f}`).size, 0);
const fontState = fontTotal / 1024 > 60 ? "FAIL" : "ok  ";
if (fontTotal / 1024 > 60) failed = true;
console.log(`${fontState} fonts: ${kb(fontTotal)} (fail > 60 KB)`);

process.exit(failed ? 1 : 0);
