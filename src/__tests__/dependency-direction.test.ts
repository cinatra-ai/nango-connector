// This test enforces the architectural invariant that `connector-nango` stays a
// LEAF: it must NOT depend on `@cinatra-ai/llm`. The helper
// `buildBearerAuthHeaderFromNango` deliberately returns a `{ Authorization }`
// shape (NOT an `LlmMcpServerTool`) precisely so this package never needs
// the orchestration type. This test makes the invariant mechanically enforced
// so future changes cannot accidentally introduce orchestration coupling.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const PKG_ROOT = path.join(__dirname, "..", "..");

describe("connector-nango dependency direction", () => {
  it("package.json declares NO dependency on @cinatra-ai/llm", () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    expect(Object.keys(allDeps)).not.toContain("@cinatra-ai/llm");
  });

  it("first-party-mcp.ts imports ONLY from ./nango (no orchestration coupling)", () => {
    const src = readFileSync(path.join(PKG_ROOT, "src", "first-party-mcp.ts"), "utf8");
    const importLines = src
      .split(/\r?\n/)
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    // No import may reference llm-orchestration in any form.
    for (const line of importLines) {
      expect(line).not.toMatch(/llm-orchestration/);
    }
    // Positive assertion: the only module specifier it imports is "./nango".
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers).toEqual(["./nango"]);
  });

  it("no connector-nango source file has an IMPORT statement referencing llm-orchestration", () => {
    // Repo-wide defense-in-depth across the package's own source (excludes
    // tests). Matches only actual import/from specifiers — a doc comment
    // that merely *mentions* the dep (e.g. first-party-mcp.ts's rationale
    // line) is NOT a violation.
    const srcDir = path.join(PKG_ROOT, "src");
    const { execSync } = require("node:child_process");
    let hits = "";
    try {
      // ERE: an import ... from "...llm-orchestration..." OR
      // import("...llm-orchestration...") — never a bare // comment.
      hits = execSync(
        `grep -rnE "(from[[:space:]]+[\\"']|import\\()[^\\"']*llm-orchestration" "${srcDir}" 2>/dev/null | grep -v __tests__ || true`,
        { encoding: "utf8" },
      ).trim();
    } catch {
      hits = "";
    }
    expect(hits).toBe("");
  });
});
