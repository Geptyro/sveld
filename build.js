const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["src/extension.js"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  external: ["vscode", "esbuild", "fsevents", "@npmcli/arborist"], // vscode provided by host; others can't be bundled
  format: "cjs",
  minify: false,
}).then(() => console.log("Extension built → dist/extension.js"))
  .catch((e) => { console.error(e); process.exit(1); });
