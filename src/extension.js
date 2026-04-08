const vscode = require("vscode");
const esbuild = require("esbuild");
const sveltePlugin = require("esbuild-svelte");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const Module = require("module");

const SVD_DIR = path.join(os.homedir(), ".svd");
const SVD_MODULES = path.join(SVD_DIR, "node_modules");

// --- Ensure ~/.svd exists ---
function ensureSvdDir() {
  if (!fs.existsSync(SVD_DIR)) fs.mkdirSync(SVD_DIR, { recursive: true });
  const pkg = path.join(SVD_DIR, "package.json");
  if (!fs.existsSync(pkg))
    fs.writeFileSync(pkg, JSON.stringify({ name: "svd-packages", version: "1.0.0" }));
}

// --- Extract package names from import/require statements ---
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

// --- Auto-install missing packages into ~/.svd ---
function autoInstall(packages) {
  ensureSvdDir();
  const missing = packages.filter(
    (p) => !fs.existsSync(path.join(SVD_MODULES, p))
  );
  if (missing.length === 0) return;
  console.log(`SVD: installing ${missing.join(", ")}...`);
  execSync(`npm install ${missing.join(" ")} --prefix "${SVD_DIR}"`, { stdio: "pipe" });
  console.log(`SVD: installed ${missing.join(", ")}`);
}

// --- Parse .svd file ---
function parseSvd(source) {
  const match = source.match(/<script\s+context="server">([\s\S]*?)<\/script>/);
  const serverScript = match ? match[1].trim() : null;
  const svelte = source.replace(
    /<script\s+context="server">[\s\S]*?<\/script>\n?/, ""
  );
  return { serverScript, svelte };
}

// --- Run server script, returns { data, actions } ---
async function runServerScript(script) {
  const svdRequire = Module.createRequire(path.join(SVD_DIR, "index.js"));
  const wrapped = `(async function() {\n${script}\n})()`;
  const result = await vm.runInNewContext(wrapped, {
    require: svdRequire,
    console,
    process,
    URL,
    setTimeout,
    clearTimeout,
  }) || {};

  // Support both { data, actions } and legacy { ...data }
  if (result.data && typeof result.data === "object") {
    return { data: result.data, actions: result.actions || {} };
  }
  return { data: result, actions: {} };
}

// --- Inject missing exported props into the Svelte <script> block ---
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

// --- Compile Svelte component to self-contained IIFE ---
async function compileSvelte(source) {
  const tmpFile = path.join(os.tmpdir(), `svd-${Date.now()}.svelte`);
  fs.writeFileSync(tmpFile, source, "utf8");
  try {
    const result = await esbuild.build({
      entryPoints: [tmpFile],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "SvdComponent",
      plugins: [sveltePlugin({ compilerOptions: { compatibility: { componentApi: 4 } } })],
      nodePaths: [SVD_MODULES, path.join(__dirname, "..", "node_modules")],
      logLevel: "silent",
    });
    return result.outputFiles[0].text;
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// --- HTML shell ---
function wrapHtml(componentJs, data) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 2rem; max-width: 900px; margin: 0 auto;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.6;
    }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 8px 12px; text-align: left; }
    th { background: var(--vscode-editorGroupHeader-tabsBackground); font-weight: 600; }
    tr:hover { background: var(--vscode-list-hoverBackground); }
    h1, h2, h3 { border-bottom: 1px solid var(--vscode-panel-border, #444); padding-bottom: 0.3rem; }
    #svd-toolbar {
      position: sticky; top: 0;
      display: flex; gap: 0.5rem; align-items: center; justify-content: flex-end;
      padding: 0.5rem 0;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      font-size: 0.75rem; opacity: 0.7;
      transition: opacity 0.2s;
      z-index: 10;
    }
    #svd-toolbar:hover { opacity: 1; }
    #svd-toolbar button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 3px;
      padding: 3px 8px; cursor: pointer; font-size: 0.75rem;
    }
    #svd-toolbar button:hover { background: var(--vscode-button-hoverBackground); }
    #svd-toolbar input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px; padding: 3px 6px; font-size: 0.75rem;
    }
    #svd-toolbar input::placeholder { color: var(--vscode-input-placeholderForeground); }
  </style>
</head>
<body>
  <div id="svd-toolbar">
    <input id="svd-interval" list="svd-interval-options" placeholder="auto-refresh (s)"
      onchange="onIntervalChange(this.value)" style="width:140px" />
    <datalist id="svd-interval-options">
      <option value="5">5s</option>
      <option value="10">10s</option>
      <option value="30">30s</option>
      <option value="60">60s</option>
    </datalist>
    <button onclick="refresh()">↻ Refresh</button>
  </div>
  <div id="app"></div>
  <script>
    const vscode = acquireVsCodeApi();
    let _timer = null;

    function refresh() { vscode.postMessage({ type: 'refresh' }); }

    function onIntervalChange(val) {
      clearInterval(_timer);
      const seconds = parseInt(val);
      if (seconds > 0) _timer = setInterval(refresh, seconds * 1000);
    }

    // Global action caller — fire and forget, extension re-renders after
    function svdAction(name, payload) {
      vscode.postMessage({ type: 'action', name, payload });
    }
  </script>
  <script>const __DATA__ = ${JSON.stringify(data)};</script>
  <script>${componentJs}</script>
  <script>new SvdComponent.default({ target: document.getElementById("app"), props: __DATA__ });</script>
</body>
</html>`;
}

// --- Custom Editor Provider ---
class SvdEditorProvider {
  constructor() {
    this._actions = new Map(); // uri → actions object
  }

  static register(context) {
    const provider = new SvdEditorProvider();
    return vscode.window.registerCustomEditorProvider(
      "svd.preview",
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
  }

  async openCustomDocument(uri) {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document, webviewPanel) {
    webviewPanel.webview.options = { enableScripts: true };
    await this.render(document.uri, webviewPanel.webview);

    // Re-render on file change
    const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
    watcher.onDidChange(() => this.render(document.uri, webviewPanel.webview));
    webviewPanel.onDidDispose(() => {
      watcher.dispose();
      this._actions.delete(document.uri.toString());
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "refresh") {
        await this.render(document.uri, webviewPanel.webview);
      } else if (msg.type === "action") {
        const actions = this._actions.get(document.uri.toString()) || {};
        const fn = actions[msg.name];
        if (fn) {
          try {
            await fn(msg.payload);
          } catch (e) {
            console.error(`SVD action '${msg.name}' error:`, e.message);
          }
        } else {
          console.warn(`SVD: unknown action '${msg.name}'`);
        }
        await this.render(document.uri, webviewPanel.webview);
      }
    });
  }

  async render(uri, webview) {
    try {
      const source = fs.readFileSync(uri.fsPath, "utf8");
      const { serverScript, svelte } = parseSvd(source);

      autoInstall(extractPackages(source));

      const { data, actions } = serverScript
        ? await runServerScript(serverScript)
        : { data: {}, actions: {} };

      this._actions.set(uri.toString(), actions);

      const processed = injectProps(svelte, Object.keys(data));
      const componentJs = await compileSvelte(processed);

      webview.html = wrapHtml(componentJs, data);
    } catch (e) {
      webview.html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)">
        <strong style="color:red">Error:</strong><pre>${e.stack || e.message}</pre>
      </body></html>`;
    }
  }
}

function activate(context) {
  context.subscriptions.push(SvdEditorProvider.register(context));
}

module.exports = { activate };
