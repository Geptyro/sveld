# Sveld

**Sveld** is a VS Code extension that lets you write `.sveld` files — Svelte components with a server-side data block — and renders them as live, interactive views directly inside VS Code.

No web server. No build pipeline. Just open a `.sveld` file and it renders.

---

## How it works

A `.sveld` file is a standard Svelte component with one extra block: `<script context="server">`. This block runs in the VS Code extension host (full Node.js access), fetches data from any source, and injects it as props into the Svelte component rendered in the webview.

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

<h1>{users.length} users</h1>

{#each users as user}
  <p>{user.name} — {user.email}</p>
{/each}
```

---

## Features

### Server-side data block
The `<script context="server">` block runs in Node.js. Use it to query databases, read files, call REST APIs — anything you can do in Node.js.

### Auto package installation
Any `require()` or `import` in your `.sveld` file is automatically installed into `~/.sveld/node_modules` on first use. No `npm install` needed.

```svelte
<script context="server">
  const { MongoClient } = require('mongodb')   // auto-installed on first open
  const axios = require('axios')               // same
  ...
</script>
```

### Write-back actions
The server block can expose `actions` — async functions that run server-side when triggered from the Svelte component. Use `svdAction(name, payload)` (globally available) to call them.

```svelte
<script context="server">
  return {
    data: { items },
    actions: {
      async deleteItem({ id }) {
        await collection.deleteOne({ _id: id })
      }
    }
  }
</script>

<script>
  export let items = []
</script>

{#each items as item}
  <button onclick={() => svdAction('deleteItem', { id: item._id })}>Delete</button>
{/each}
```

After an action runs, data is automatically re-fetched and the view re-renders.

### Toolbar
A sticky toolbar is always visible with:
- **↻ Refresh** — manually re-fetch data and re-render
- **Auto-refresh input** — type any interval in seconds (or pick 5 / 10 / 30 / 60) to auto-refresh

### Theme-aware
The default styles use VS Code CSS variables and adapt automatically to light and dark themes.

---

## Format

A `.sveld` file is structured as follows:

```
<script context="server">
  // Runs in Node.js (extension host)
  // Has access to require(), process, etc.
  // Must return { data: { ...props }, actions: { ...fns } }
  // Packages are auto-installed from npm on first use
</script>

<!-- Everything below is standard Svelte -->
<script>
  export let myData = []
</script>

<h1>Hello</h1>
{#each myData as item}
  <p>{item.name}</p>
{/each}

<style>
  h1 { color: red; }
</style>
```

---

## Installation

Until published to the marketplace, install locally by symlinking the extension folder:

```bash
ln -s /path/to/sveld ~/.vscode-server/extensions/sveld
# or for desktop VS Code:
ln -s /path/to/sveld ~/.vscode/extensions/sveld
```

Then reload VS Code. Opening any `.sveld` file will automatically trigger the renderer.

---

## Ideas & Roadmap

- **More connectors** — PostgreSQL, SQLite, REST APIs, local CSV/JSON files
- **Multiple server blocks** — named data sources composed together
- **Prop reactivity** — update Svelte props in-place after actions instead of full re-render
- **Error overlay** — better in-view error display with stack traces
- **Syntax highlighting** — proper `.sveld` language grammar for VS Code
- **Marketplace publish** — one-click install from the VS Code extension marketplace
- **Shared components** — import `.sveld` partials into other `.sveld` files
- **`$sveld` store** — reactive store that re-fetches on demand from within the component
- **Export to HTML** — generate a standalone static HTML snapshot of any view

---

## Example use cases

- Personal dashboards (cold brew tracker, finance, habits)
- MongoDB collection browsers
- Internal admin panels without a web server
- Data exploration during development
- Lightweight BI views next to your code

---

## Tech stack

- **Svelte 5** — component framework
- **esbuild** + **esbuild-svelte** — compiles `.sveld` files on the fly
- **VS Code Custom Editor API** — renders the webview on file open
- **Node.js `vm`** — sandboxed execution of the server block
- Packages auto-installed to **`~/.sveld/node_modules`** on demand

---

## License

MIT
