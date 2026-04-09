# Changelog

## [0.0.1] - 2026-04-09

### Added
- Initial release
- `.sveld` file format — Svelte components with a `<script context="server">` block
- Server-side data fetching with full Node.js access (`require`, `process.env`, etc.)
- Server actions — call server-side functions from the component via `sveldAction()`
- Auto package installation into `~/.svd/<project>/node_modules`
- SCSS support via Dart Sass (`<style lang="scss">`)
- File watcher — auto re-renders when any bundled file changes (via esbuild metafile)
- `.env` support — global (`~/.svd/.env`) and local (next to `.sveld` file)
- Multi-panel focus broadcast — highlight the active tab across all open sveld panels
- `sveldOpen()` — navigate between `.sveld` files from the webview
- `sveldRefresh()` — trigger a full re-render from the webview
- Local `node_modules` support — respects project-level installs and `npm link`
- Shared helper files — `require('./db.js')` with automatic dependency tracking and hot-reload
