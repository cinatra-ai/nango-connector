import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The setup form must use the host Card without reintroducing the removed
// package copy's interactive, border, fill or hover treatment at its call site.
describe("setup Card host styling", () => {
  it("does not layer a local visual recipe onto the host Card", () => {
    const text = readFileSync("src/pages/nango-settings-page.tsx", "utf8");
    const source = ts.createSourceFile("setup.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const cards: ts.JsxOpeningLikeElement[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Card") cards.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(cards).toHaveLength(1);
    expect(cards[0].attributes.properties).toHaveLength(0);
  });
});
