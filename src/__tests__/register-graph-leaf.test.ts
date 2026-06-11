// The serverEntry STATIC import graph must stay LEAF-ONLY (cinatra#151):
// `register(ctx)` activates UNGUARDED on every boot path (nango is a
// systemExtension), so its module-eval graph must never pull
//   - the package index (whose `@cinatra-ai/sdk-ui/nango` VALUE re-export and
//     React components belong to the page graph, not activation),
//   - `./actions.ts` (the "use server" SDK-slot build site — the register
//     path injects the host action guard instead), or
//   - any host `@/lib/*` module EXCEPT `@/lib/database` (the one sanctioned
//     STATIC skew fallback of the injected config store: the sync store reads
//     force a static binding; removed by the post-cutover companion sweep).
// The wordpress/linkedin materializer fallbacks must stay DYNAMIC imports —
// those host modules import the host's `@/lib/nango` facade, which re-exports
// THIS package's index (a static edge would close that cycle into the
// activation graph).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const SRC = path.join(__dirname, "..");

/** Static import/export-from specifiers only — dynamic `import(...)` is the
 * sanctioned call-time escape hatch and deliberately NOT collected. */
function staticImportSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[1]);
  // side-effect imports: import "x";
  const side = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (let m = side.exec(source); m; m = side.exec(source)) out.push(m[1]);
  return out;
}

function traceRegisterGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = ["./register"];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    const base = path.join(SRC, rel.replace(/^\.\//, ""));
    const file = [".ts", ".tsx"].map((ext) => base + ext).find((f) => {
      try {
        readFileSync(f);
        return true;
      } catch {
        return false;
      }
    });
    if (!file || graph.has(rel)) continue;
    const specifiers = staticImportSpecifiers(file);
    graph.set(rel, specifiers);
    for (const spec of specifiers) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const normalized = "./" + path.normalize(spec).replace(/^\.\//, "");
        if (!graph.has(normalized)) queue.push(normalized);
      }
    }
  }
  return graph;
}

describe("register(ctx) static import graph stays leaf-only", () => {
  const graph = traceRegisterGraph();
  const allSpecifiers = [...graph.entries()].flatMap(([mod, specs]) =>
    specs.map((s) => ({ mod, spec: s })),
  );

  it("never imports the package index or the \"use server\" actions module", () => {
    const banned = allSpecifiers.filter(
      ({ spec }) =>
        spec === "./index" ||
        spec === "." ||
        spec === "./actions" ||
        spec === "@cinatra-ai/nango-connector",
    );
    expect(banned).toEqual([]);
  });

  it("never imports @cinatra-ai/sdk-ui (any subpath) statically", () => {
    const banned = allSpecifiers.filter(({ spec }) => spec.startsWith("@cinatra-ai/sdk-ui"));
    expect(banned).toEqual([]);
  });

  it("the ONLY static host @/ edge is the config-store's @/lib/database skew fallback", () => {
    const hostEdges = allSpecifiers.filter(({ spec }) => spec.startsWith("@/"));
    expect(hostEdges).toEqual([{ mod: "./config-store", spec: "@/lib/database" }]);
  });

  it("sanity: the graph actually contains the expected leaf modules", () => {
    for (const mod of [
      "./register",
      "./nango",
      "./nango-connectors",
      "./nango-connect-ui",
      "./route-handlers",
      "./first-party-mcp",
      "./actions-core",
      "./config-store",
      "./connection-materializer",
    ]) {
      expect(graph.has(mod), `missing ${mod}`).toBe(true);
    }
  });
});
