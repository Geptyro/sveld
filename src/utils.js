const fs = require("fs");

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

module.exports = { parseSvd, injectProps, loadDotenv };
