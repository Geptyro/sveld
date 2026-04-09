const fs = require("fs");
const path = require("path");
const os = require("os");
const { extractPackages, parseSvd, injectProps, loadDotenv } = require("../src/utils");

// ── extractPackages ──────────────────────────────────────────────────────────

describe("extractPackages", () => {
  test("picks up ESM imports", () => {
    expect(extractPackages(`import Chart from 'chart.js/auto'`)).toEqual(["chart.js"]);
  });

  test("picks up CJS requires", () => {
    expect(extractPackages(`const { MongoClient } = require('mongodb')`)).toEqual(["mongodb"]);
  });

  test("ignores Node builtins", () => {
    expect(extractPackages(`import fs from 'fs'; import path from 'path'`)).toEqual([]);
  });

  test("ignores relative imports", () => {
    expect(extractPackages(`import Foo from './Foo.svelte'`)).toEqual([]);
  });

  test("deduplicates packages", () => {
    const src = `import { x } from 'lodash'; import { y } from 'lodash'`;
    expect(extractPackages(src)).toEqual(["lodash"]);
  });

  test("handles scoped packages", () => {
    expect(extractPackages(`import x from '@sveltejs/kit'`)).toEqual(["@sveltejs"]);
  });

  test("returns empty for no imports", () => {
    expect(extractPackages(`const x = 1 + 1`)).toEqual([]);
  });
});

// ── parseSvd ─────────────────────────────────────────────────────────────────

describe("parseSvd", () => {
  test("extracts server script", () => {
    const src = `<script context="server">\n  return { data: {} }\n</script>\n<p>hello</p>`;
    const { serverScript, svelte } = parseSvd(src);
    expect(serverScript).toBe("return { data: {} }");
    expect(svelte).toContain("<p>hello</p>");
    expect(svelte).not.toContain('context="server"');
  });

  test("returns null serverScript when no server block", () => {
    const src = `<script>\n  let x = 1\n</script>`;
    const { serverScript, svelte } = parseSvd(src);
    expect(serverScript).toBeNull();
    expect(svelte).toBe(src);
  });

  test("handles multiline server script", () => {
    const src = `<script context="server">\n  const a = 1\n  const b = 2\n  return { data: { a, b } }\n</script>\n<p>{a}</p>`;
    const { serverScript } = parseSvd(src);
    expect(serverScript).toContain("const a = 1");
    expect(serverScript).toContain("return { data: { a, b } }");
  });
});

// ── injectProps ───────────────────────────────────────────────────────────────

describe("injectProps", () => {
  test("injects missing props into existing script block", () => {
    const svelte = `<script>\n  let x = 1\n</script>`;
    const result = injectProps(svelte, ["brews"]);
    expect(result).toContain("export let brews = [];");
  });

  test("does not inject already declared props", () => {
    const svelte = `<script>\n  export let brews = []\n</script>`;
    const result = injectProps(svelte, ["brews"]);
    expect(result.match(/export let brews/g)).toHaveLength(1);
  });

  test("creates script block if missing", () => {
    const svelte = `<p>hello</p>`;
    const result = injectProps(svelte, ["items"]);
    expect(result).toContain("<script>");
    expect(result).toContain("export let items = [];");
  });

  test("injects multiple props", () => {
    const svelte = `<script>\n  let x = 1\n</script>`;
    const result = injectProps(svelte, ["a", "b", "c"]);
    expect(result).toContain("export let a = [];");
    expect(result).toContain("export let b = [];");
    expect(result).toContain("export let c = [];");
  });

  test("returns unchanged svelte when all props present", () => {
    const svelte = `<script>\n  export let x = []\n  export let y = []\n</script>`;
    expect(injectProps(svelte, ["x", "y"])).toBe(svelte);
  });
});

// ── loadDotenv ────────────────────────────────────────────────────────────────

describe("loadDotenv", () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `sveld-test-${Date.now()}.env`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  test("parses basic key=value pairs", () => {
    fs.writeFileSync(tmpFile, "FOO=bar\nBAZ=qux\n");
    expect(loadDotenv(tmpFile)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("strips surrounding quotes", () => {
    fs.writeFileSync(tmpFile, `KEY="hello world"\nOTHER='single'`);
    expect(loadDotenv(tmpFile)).toEqual({ KEY: "hello world", OTHER: "single" });
  });

  test("ignores comments and blank lines", () => {
    fs.writeFileSync(tmpFile, `# comment\n\nFOO=bar\n`);
    expect(loadDotenv(tmpFile)).toEqual({ FOO: "bar" });
  });

  test("handles values with = in them", () => {
    fs.writeFileSync(tmpFile, `URL=mongodb://user:pass@host/db?auth=true`);
    expect(loadDotenv(tmpFile)).toEqual({ URL: "mongodb://user:pass@host/db?auth=true" });
  });

  test("returns empty object for missing file", () => {
    expect(loadDotenv("/nonexistent/path/.env")).toEqual({});
  });
});
