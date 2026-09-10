import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

test('native UI elements use app help instead of browser title tooltips', () => {
  const failures = [];
  const root = new URL('../src/', import.meta.url);
  for (const file of fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.tsx'))) {
    const source = fs.readFileSync(new URL(file.replaceAll(path.sep, '/'), root), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        if (/^[a-z]/.test(tag) || tag === 'LabelTag') {
          for (const attribute of node.attributes.properties) {
            if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'title') failures.push(`${file}:${ast.getLineAndCharacterOfPosition(attribute.pos).line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(failures, []);
});
