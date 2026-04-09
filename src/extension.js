const vscode = require("vscode");
const esbuild = require("esbuild");
const sveltePlugin = require("esbuild-svelte");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");
const Module = require("module");
const sass = require("sass");
const EventEmitter = require("events");

const { extractPackages, parseSvd, injectProps, loadDotenv } = require("./utils");

const SVD_DIR = path.join(os.homedir(), ".svd");
const SVD_MODULES = path.join(SVD_DIR, "node_modules");

// --- Shared context per project directory ---
// Persists across renders; lets server scripts communicate across panels.
class SharedContext {
  constructor() {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(100);
    this._panelListeners = new Map(); // panelUri → [{event, fn}]
    this.state = {};
  }

  // Returns a panel-scoped API injected into the server script VM.
  // Listeners registered via .on() are tagged to the panel and cleared before each re-render.
  forPanel(panelUri, sendFn) {
    const ctx = this;
    return {
      on(event, fn) {
        ctx._emitter.on(event, fn);
        if (!ctx._panelListeners.has(panelUri)) ctx._panelListeners.set(panelUri, []);
        ctx._panelListeners.get(panelUri).push({ event, fn });
      },
      emit(event, ...args) { ctx._emitter.emit(event, ...args); },
      state: this.state,
    };
  }

  clearPanel(panelUri) {
    for (const { event, fn } of (this._panelListeners.get(panelUri) || [])) {
      this._emitter.removeListener(event, fn);
    }
    this._panelListeners.delete(panelUri);
  }
}


// --- Ensure ~/.svd exists ---
function ensureSvdDir() {
  if (!fs.existsSync(SVD_DIR)) fs.mkdirSync(SVD_DIR, { recursive: true });
  const pkg = path.join(SVD_DIR, "package.json");
  if (!fs.existsSync(pkg))
    fs.writeFileSync(pkg, JSON.stringify({ name: "svd-packages", version: "1.0.0" }));
}

// --- Auto-install missing packages into ~/.svd ---
function projectDir(sveldDir) {
  const hash = crypto.createHash("sha1").update(sveldDir).digest("hex").slice(0, 8);
  return path.join(SVD_DIR, `${path.basename(sveldDir)}-${hash}`);
}

function autoInstall(packages, sveldDir) {
  const pDir = projectDir(sveldDir);
  const pMods = path.join(pDir, "node_modules");
  const missing = packages.filter((p) => !fs.existsSync(path.join(pMods, p)));
  if (missing.length === 0) return;
  if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
  if (!fs.existsSync(path.join(pDir, "package.json")))
    fs.writeFileSync(path.join(pDir, "package.json"), JSON.stringify({ name: `svd-${path.basename(sveldDir)}`, version: "1.0.0" }));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`SVD: installing ${missing.join(", ")} into ~/.svd/${path.basename(sveldDir)}...`);
  execSync(`${npm} install ${missing.join(" ")} --prefix "${pDir}"`, { stdio: "pipe" });
  console.log(`SVD: installed ${missing.join(", ")}`);
}

// --- Run server script, returns { data, actions } ---

async function runServerScript(script, filePath, sendFn, shared) {
  const pDir = projectDir(path.dirname(filePath));
  const projectRequire = Module.createRequire(filePath);
  const svdRequire = Module.createRequire(path.join(pDir, "index.js"));

  // Load .env: global (~/.svd/.env) overridden by local (next to the .sveld file)
  const globalEnv = loadDotenv(path.join(SVD_DIR, ".env"));
  const localEnv = loadDotenv(path.join(path.dirname(filePath), ".env"));
  const env = { ...process.env, ...globalEnv, ...localEnv };
  const customProcess = { ...process, env };

  function makeHybridRequire(fromFile) {
    const fromRequire = Module.createRequire(fromFile);
    const hybridRequire = (id) => {
      if (id.startsWith('./') || id.startsWith('../') || path.isAbsolute(id)) {
        // Local file — resolve and execute with hybridRequire + custom process
        const resolved = fromRequire.resolve(id);
        if (require.cache[resolved]) return require.cache[resolved].exports;
        const src = fs.readFileSync(resolved, 'utf8');
        const mod = { exports: {} };
        const wrapped = `(function(module,exports,require,__filename,__dirname,process){${src}\n})`;
        vm.runInThisContext(wrapped)(mod, mod.exports, makeHybridRequire(resolved), resolved, path.dirname(resolved), customProcess);
        require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: mod.exports };
        return mod.exports;
      }
      // npm package — try project first, then svd
      try { return fromRequire(id); } catch { return svdRequire(id); }
    };
    return hybridRequire;
  }

  const hybridRequire = makeHybridRequire(filePath);

  const cacheBefore = new Set(Object.keys(require.cache));

  const sveld = {
    send:   (msg)   => { try { sendFn(msg); } catch {} },
    update: (props) => { try { sendFn({ type: 'propsUpdate', props }); } catch {} },
  };

  const wrapped = `(async function() {\n${script}\n})()`;
  const result = await vm.runInNewContext(wrapped, {
    require: hybridRequire,
    console,
    process: { ...process, env },
    URL,
    setTimeout,
    clearTimeout,
    sveld,
    shared,
  }) || {};

  const serverDeps = new Set(
    Object.keys(require.cache).filter(k => !cacheBefore.has(k) && !k.includes("node_modules"))
  );

  // Support both { data, actions } and legacy { ...data }
  if (result.data && typeof result.data === "object") {
    return { data: result.data, actions: result.actions || {}, serverDeps };
  }
  return { data: result, actions: {}, serverDeps };
}


// --- Compile Svelte component to self-contained IIFE ---
// Returns { js, deps } where deps is the set of real file paths bundled
async function compileSvelte(source, originalFilePath) {
  const tmpFile = path.join(path.dirname(originalFilePath), `._sveld_tmp_${Date.now()}.svelte`);
  fs.writeFileSync(tmpFile, source, "utf8");
  try {
    const result = await esbuild.build({
      entryPoints: [tmpFile],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "SvdComponent",
      metafile: true,
      plugins: [sveltePlugin({
        preprocess: {
          style: ({ content, attributes, filename }) => {
            if (attributes.lang !== 'scss') return;
            const result = sass.compileString(content, {
              loadPaths: [path.dirname(filename || '.')],
            });
            return { code: result.css };
          }
        },
        compilerOptions: { css: "injected", compatibility: { componentApi: 4 } },
      })],
      nodePaths: [path.dirname(originalFilePath), path.join(projectDir(path.dirname(originalFilePath)), "node_modules"), SVD_MODULES, path.join(__dirname, "..", "node_modules")],
      logLevel: "silent",
    });
    const deps = new Set(
      Object.keys(result.metafile.inputs)
        .map(f => path.resolve(f))
        .filter(f => !f.includes("node_modules") && f !== tmpFile)
    );
    return { js: result.outputFiles[0].text, deps };
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// --- HTML shell ---
function wrapHtml(componentJs, data, filename = '') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    html, body {
      background: #1e2334;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 2rem; max-width: 1400px; margin: 0 auto;
      color: #e8eaf0;
      line-height: 1.6;
    }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 8px 12px; text-align: left; }
    th { background: var(--vscode-editorGroupHeader-tabsBackground); font-weight: 600; }
    tr:hover { background: var(--vscode-list-hoverBackground); }
    h1, h2, h3 { border-bottom: 1px solid var(--vscode-panel-border, #444); padding-bottom: 0.3rem; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    const vscode = acquireVsCodeApi();

    // Re-fetch data and re-render the whole view
    function sveldRefresh() { vscode.postMessage({ type: 'refresh' }); }

    // Open a relative .sveld file in a side panel
    function sveldOpen(relativePath) { vscode.postMessage({ type: 'open', path: relativePath }); }

    // Reopen the current file in the text editor
    function sveldEdit() { vscode.postMessage({ type: 'openTextEditor' }); }

    // Call a server-side action.
    // - If the action returns a value → resolves with that value, no re-render
    // - If the action returns nothing → triggers a full re-render
    const _pending = new Map();
    let _nextId = 0;
    function sveldAction(name, payload) {
      return new Promise((resolve) => {
        const id = ++_nextId;
        _pending.set(id, resolve);
        vscode.postMessage({ type: 'action', name, payload, id });
      });
    }
    window.addEventListener('message', (e) => {
      if (e.data.type === 'actionResult') {
        const resolve = _pending.get(e.data.id);
        if (resolve) { _pending.delete(e.data.id); resolve(e.data.result); }
      } else if (e.data.type === 'propsUpdate') {
        if (window.__sveld_component__) window.__sveld_component__.$set(e.data.props);
      }
    });
  </script>
  <script>const __DATA__ = ${JSON.stringify(data)}; const __SVELD_FILE__ = ${JSON.stringify(filename)};</script>
  <script>${componentJs}</script>
  <script>window.__sveld_component__ = new SvdComponent.default({ target: document.getElementById("app"), props: __DATA__ });</script>
</body>
</html>`;
}

// --- Custom Editor Provider ---
class SvdEditorProvider {
  constructor() {
    this._actions = new Map(); // uri → actions object
    this._panels = new Map(); // uri → webviewPanel
    this._shared = new Map(); // projectDir → SharedContext
  }

  _getShared(fsPath) {
    const dir = path.dirname(fsPath);
    if (!this._shared.has(dir)) this._shared.set(dir, new SharedContext());
    return this._shared.get(dir);
  }

  _broadcast(msg) {
    for (const panel of this._panels.values()) {
      panel.webview.postMessage(msg);
    }
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

    let depWatchers = new Map(); // fsPath → FileSystemWatcher
    let serverDepPaths = new Set(); // currently tracked server-side deps

    const updateDepWatchers = (newDeps, newServerDeps) => {
      for (const [fsPath, w] of depWatchers) {
        if (!newDeps.has(fsPath)) { w.dispose(); depWatchers.delete(fsPath); }
      }
      for (const fsPath of newDeps) {
        if (!depWatchers.has(fsPath)) {
          const isServerDep = newServerDeps.has(fsPath);
          const w = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(fsPath)), path.basename(fsPath))
          );
          const onChange = () => {
            if (isServerDep) delete require.cache[fsPath];
            doRender();
          };
          w.onDidChange(onChange);
          w.onDidCreate(onChange);
          depWatchers.set(fsPath, w);
        }
      }
      serverDepPaths = newServerDeps;
    };

    const shared = this._getShared(document.uri.fsPath);

    const doRender = async () => {
      shared.clearPanel(document.uri.toString());
      const sendFn = (msg) => webviewPanel.webview.postMessage(msg);
      const result = await this.render(document.uri, webviewPanel.webview, sendFn, shared);
      if (result) { updateDepWatchers(result.deps, result.serverDeps); }
      // Re-broadcast focus so re-rendered panels restore the highlighted link
      if (webviewPanel.active) {
        this._broadcast({ type: 'focusChange', file: path.basename(document.uri.fsPath) });
      }
    };

    // Re-render when the .sveld file itself is saved from a VS Code text editor
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.fsPath === document.uri.fsPath) doRender();
    });

    this._panels.set(document.uri.toString(), webviewPanel);
    await doRender();

    webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this._broadcast({ type: 'focusChange', file: path.basename(document.uri.fsPath) });
      } else {
        setTimeout(() => {
          const anyActive = [...this._panels.values()].some(p => p.active);
          if (!anyActive) this._broadcast({ type: 'focusChange', file: '' });
        }, 100);
      }
    });

    webviewPanel.onDidDispose(() => {
      saveWatcher.dispose();
      for (const w of depWatchers.values()) w.dispose();
      shared.clearPanel(document.uri.toString());
      this._actions.delete(document.uri.toString());
      this._panels.delete(document.uri.toString());
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "openTextEditor") {
        vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      } else if (msg.type === "open") {
        const targetUri = vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), msg.path));
        let targetColumn = null;
        for (const group of vscode.window.tabGroups.all) {
          for (const tab of group.tabs) {
            if (tab.input?.uri?.fsPath === targetUri.fsPath) {
              targetColumn = group.viewColumn; // already open — focus it
              break;
            }
          }
          if (targetColumn) break;
        }
        if (!targetColumn) {
          // Use an existing column that isn't the current one, or create beside
          const otherGroup = vscode.window.tabGroups.all.find(g => g.viewColumn !== webviewPanel.viewColumn);
          targetColumn = otherGroup ? otherGroup.viewColumn : vscode.ViewColumn.Beside;
        }
        await vscode.commands.executeCommand("vscode.open", targetUri, targetColumn);
      } else if (msg.type === "refresh") {
        await doRender();
      } else if (msg.type === "action") {
        const actions = this._actions.get(document.uri.toString()) || {};
        const fn = actions[msg.name];
        if (!fn) {
          if (msg.name === 'refresh') await doRender();
          else console.warn(`SVD: unknown action '${msg.name}'`);
          return;
        }
        let result;
        try {
          result = await fn(msg.payload);
        } catch (e) {
          console.error(`SVD action '${msg.name}' error:`, e.message);
          return;
        }
        if (result !== undefined) {
          // Data query — return result, no re-render
          webviewPanel.webview.postMessage({ type: 'actionResult', id: msg.id, result });
        } else {
          // Mutation — re-render
          await doRender();
        }
      }
    });
  }

  async render(uri, webview, sendFn, shared) {
    try {
      const source = fs.readFileSync(uri.fsPath, "utf8");
      const { serverScript, svelte } = parseSvd(source);

      autoInstall(extractPackages(source), path.dirname(uri.fsPath));

      const panelShared = shared ? shared.forPanel(uri.toString(), sendFn) : { on() {}, emit() {}, state: {} };

      const { data, actions, serverDeps } = serverScript
        ? await runServerScript(serverScript, uri.fsPath, sendFn || (() => {}), panelShared)
        : { data: {}, actions: {}, serverDeps: new Set() };

      this._actions.set(uri.toString(), actions);

      const processed = injectProps(svelte, Object.keys(data));
      const { js, deps } = await compileSvelte(processed, uri.fsPath);
      deps.add(uri.fsPath);
      for (const d of serverDeps) deps.add(d);

      webview.html = wrapHtml(js, data, path.basename(uri.fsPath));
      return { deps, serverDeps };
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
