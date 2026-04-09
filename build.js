const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["src/extension.js"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  external: ["vscode"], // only vscode is provided by the host, everything else is bundled
  format: "cjs",
  minify: false,
}).then(() => console.log("Extension built → dist/extension.js"))
  .catch((e) => { console.error(e); process.exit(1); });
