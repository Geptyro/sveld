const fs = require("fs");

const BUILTINS = new Set([
  "fs", "path", "os", "http", "https", "vm", "crypto", "url", "util",
  "events", "stream", "child_process", "buffer", "assert", "net", "tls",
  "dns", "querystring", "readline", "cluster", "worker_threads", "module",
]);

function extractPackages(source) {
  const packages = new Set();
  for (const m of source.matchAll(/from\s+['"]([^'"./][^'"]*)['"]/g))
    packages.add(m[1].split("/")[0]);
  for (const m of source.matchAll(/require\(['"]([^'"./][^'"]*)['"]\)/g))
    packages.add(m[1].split("/")[0]);
  return [...packages].filter((p) => !BUILTINS.has(p));
}

function parseSvd(source) {
  const match = source.match(/<script\s+context="server">([\s\S]*?)<\/script>/);
  const serverScript = match ? match[1].trim() : null;
  const svelte = source.replace(
    /<script\s+context="server">[\s\S]*?<\/script>\n?/, ""
  );
  return { serverScript, svelte };
}

function injectProps(svelte, propNames) {
  const missing = propNames.filter(
    (n) => !new RegExp(`export\\s+let\\s+${n}[\\s=;]`).test(svelte)
  );
  if (missing.length === 0) return svelte;
  const props = missing.map((n) => `export let ${n} = [];`).join("\n  ");
  if (svelte.includes("<script>"))
    return svelte.replace("<script>", `<script>\n  ${props}`);
  return `<script>\n  ${props}\n</script>\n` + svelte;
}

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, "utf8").split("\n").reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return acc;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return acc;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    acc[key] = val;
    return acc;
  }, {});
}

module.exports = { extractPackages, parseSvd, injectProps, loadDotenv };
