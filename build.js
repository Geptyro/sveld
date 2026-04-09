const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["src/extension.js"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  external: ["vscode", "esbuild", "fsevents", "node-gyp"], // vscode provided by host; esbuild/fsevents have native binaries
  format: "cjs",
  minify: false,
}).then(() => console.log("Extension built → dist/extension.js"))
  .catch((e) => { console.error(e); process.exit(1); });
