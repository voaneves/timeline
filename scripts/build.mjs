// Builds the committed bundles: boot, world chunk and the minified service worker.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/boot.js"],
  outfile: "assets/js/boot.min.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  define: { __WORLD_VERSION__: JSON.stringify(pkg.version) },
  legalComments: "none",
});

await build({
  entryPoints: ["src/world/main.js"],
  outfile: "assets/js/world/world.min.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "linked",
});

await build({
  entryPoints: ["worker.js"],
  outfile: "worker.min.js",
  minify: true,
  target: "es2020",
  legalComments: "none",
  allowOverwrite: true,
});

console.log("build ok");
