# Sveld

**Sveld** is a VS Code extension that lets you write `.sveld` files — Svelte components with a server-side data block — and renders them as live, interactive views directly inside VS Code.

No web server. No build pipeline. Just open a `.sveld` file and it renders.

![Sveld preview](https://raw.githubusercontent.com/Geptyro/sveld/main/media/screenshot.png)

---

## How it works

A `.sveld` file is a standard Svelte component with one optional block: `<script context="server">`. This block runs in the VS Code extension host (full Node.js access), fetches data from any source, and injects it as props into the Svelte component rendered in the webview.

```svelte
<script context="server">
  const { MongoClient } = require('mongodb')

  const client = new MongoClient('mongodb://localhost:27017')
  await client.connect()
  const users = await client.db('myapp').collection('users').find().toArray()
  await client.close()

  return { data: { users } }
</script>

<script>
  export let users = []
</script>

<ul>
  {#each users as user}
    <li>{user.name}</li>
  {/each}
</ul>
```

---

## Features

### Server-side data block
The `<script context="server">` block runs in Node.js with full access to `require()`, `process`, `URL`, `setTimeout`, and any npm package. Use it to query databases, read files, call REST APIs, or run any Node.js code. Return `{ data: { ...props } }` to inject values as Svelte props.

### Actions
The server block can expose `actions` — async functions that run server-side when called from the component via the globally available `sveldAction(name, payload)`.

- If an action **returns a value**, it resolves as a Promise in the component — no re-render.
- If an action **returns nothing**, the view fully re-renders with fresh data.

```svelte
<script context="server">
  return {
    data: { items },
    actions: {
      async addItem({ name }) {
        await collection.insertOne({ name })
        // returns nothing → triggers re-render
      },
      async search({ query }) {
        return collection.find({ name: query }).toArray()
        // returns value → no re-render, resolves in component
      }
    }
  }
</script>

<script>
  export let items = []

  async function handleSearch() {
    const results = await sveldAction('search', { query: 'tea' })
    // results available here, no page re-render
  }
</script>
```

### Auto package installation
Any package `require()`d in the server block is automatically installed into `~/.svd/node_modules` on first use. No manual `npm install` needed.

```svelte
<script context="server">
  const { MongoClient } = require('mongodb')  // auto-installed on first open
  const Chart = require('chart.js/auto')      // same
</script>
```

### SCSS support
Svelte `<style lang="scss">` blocks are compiled automatically via Dart Sass. Import shared stylesheets using `@use` or `@import`:

```svelte
<style lang="scss">
  @use './components/theme.scss';

  .card {
    background: var(--bg-card);
    &:hover { border-color: var(--accent); }
  }
</style>
```

### File watcher
Sveld tracks every file bundled into the component (Svelte files, imported JS, SCSS partials) using esbuild's metafile. Saving any of those files automatically re-renders the view — no manual refresh needed.

### Environment variables (`.env`)
Sveld automatically loads `.env` files in two locations:

| File | Purpose |
|------|---------|
| `~/.svd/.env` | Global secrets (shared across all `.sveld` files) |
| `.env` next to the `.sveld` file | Local overrides for that project |

Local values override global ones. Variables are available as `process.env.MY_VAR` in the server block.

```
# ~/.svd/.env
MONGO_URI=mongodb://localhost:27017
MONGO_DB=myapp
```

### Multi-panel focus broadcast
When multiple `.sveld` files are open, the extension broadcasts which panel is currently active to all other panels. Each panel can use this to highlight the active tab in a shared navigation header.

- `onDidChangeViewState` fires when a panel gains or loses focus.
- A `focusChange` message (with the active filename) is posted to every open sveld panel.
- When switching to a non-sveld editor, a 100ms debounce clears the highlight in all panels.

A typical use case is a shared `Header.svelte` component that highlights which panel is currently focused, even when viewed from another panel:

```svelte
<!-- src/Header.svelte -->
<script>
  import { onMount } from 'svelte'

  const links = [
    { label: 'Home',  file: 'home.sveld' },
    { label: 'Stats', file: 'stats.sveld' },
  ];

  // __SVELD_FILE__ is injected by the extension — filename of the current panel (constant)
  const currentFile = typeof __SVELD_FILE__ !== 'undefined' ? __SVELD_FILE__ : '';
  // focusedFile updates via broadcast — may differ from currentFile
  let focusedFile = currentFile;

  onMount(() => {
    window.addEventListener('message', (e) => {
      if (e.data.type === 'focusChange') focusedFile = e.data.file;
    });
  });
</script>

<nav>
  {#each links as link}
    <button
      class:active={link.file === currentFile}
      class:focused={link.file === focusedFile}
      onclick={() => link.file !== currentFile && sveldOpen('./' + link.file)}
    >{link.label}</button>
  {/each}
</nav>

<style>
  .active  { color: #4ecdc4; }
  .focused { color: #ffb86c; } /* orange — visible in all panels, not just the focused one */
</style>
```

```svelte
<!-- home.sveld -->
<script>
  import Header from './src/Header.svelte'
</script>

<Header />
```

### Navigation between sveld files
Call `sveldOpen('./path/to/other.sveld')` (globally available in the webview) to open another `.sveld` file:

- If the target is already open in another column, it is focused there.
- Otherwise it opens beside the current panel.

### Svelte component imports
Import regular `.svelte` components from the same directory. They are bundled by esbuild at render time and hot-reloaded when their source changes (tracked via the file watcher).

```svelte
<script>
  import MyChart from './components/MyChart.svelte'
  export let data = []
</script>

<MyChart {data} />
```

---

## Global webview functions

| Function | Description |
|----------|-------------|
| `sveldAction(name, payload)` | Call a server-side action. Returns a Promise. |
| `sveldOpen(relativePath)` | Open another `.sveld` file in VS Code. |
| `sveldRefresh()` | Trigger a full re-render of the current panel. |

---

## File format

```
<script context="server">
  // Node.js — runs in the extension host
  // Has access to require(), process.env, etc.
  // Packages are auto-installed from npm on first use
  // Must return { data: { ...props }, actions: { ...fns } }
</script>

<!-- Standard Svelte below -->
<script>
  export let myProp = []
</script>

<div>{myProp.length} items</div>

<style lang="scss">
  /* SCSS supported */
</style>
```

---

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CdricDessalles.sveld), or via terminal:

```bash
code --install-extension CdricDessalles.sveld
```

## Development

**Build:**
```bash
npm run build
```

**Test the packaged extension locally** (validates exactly what the marketplace ships):
```bash
npm run package              # builds + creates sveld-x.x.x.vsix
code --install-extension sveld-*.vsix
```
Reload VS Code after installing. This is the recommended way to validate before publishing.

**Publish** (requires `VSCE_PAT` env var, or use CI by pushing a version tag):
```bash
npx vsce publish -p $VSCE_PAT
```

---

## Tech stack

| Component | Role |
|-----------|------|
| **Svelte 5** | Component framework (Svelte 4 compat mode) |
| **esbuild** + **esbuild-svelte** | Compiles `.sveld` files on the fly |
| **Dart Sass** | SCSS preprocessing |
| **VS Code Custom Editor API** | Renders the webview on file open |
| **Node.js `vm`** | Sandboxed execution of the server block |
| **esbuild metafile** | Precise dependency tracking for the file watcher |
| **`~/.svd/node_modules`** | Shared npm package store, auto-populated |

---

## Ideas & Roadmap

- **Syntax highlighting** — proper `.sveld` language grammar
- **Prop reactivity** — update props in-place after actions instead of full re-render
- **Export to HTML** — standalone static snapshot of any view

---

## License

MIT
