import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const componentPath = new URL('../src/SharedOptionGroupsManager.tsx', import.meta.url);
const stylesPath = new URL('../src/shared-option-groups.css', import.meta.url);

test('option group editor uses a viewport portal and semantic save form', async () => {
  const source = await readFile(componentPath, 'utf8');

  assert.match(source, /portalTarget\s*=.*document\.body/);
  assert.match(source, /<form className="group-editor-drawer"[^>]+onSubmit=/);
  assert.match(source, /<button type="submit"[^>]+className="small-action"/);
  assert.match(source, /document\.documentElement\.style\.overflow = 'hidden'/);
});

test('mobile option group editor keeps one touch scroll area and fixed actions', async () => {
  const styles = await readFile(stylesPath, 'utf8');

  assert.match(styles, /\.group-editor-drawer\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(styles, /\.group-editor-body\s*\{[^}]*grid-auto-rows:\s*max-content[^}]*overflow-y:\s*auto[^}]*touch-action:\s*pan-y/s);
  assert.match(styles, /\.group-editor-body\s*>\s*section\s*\{[^}]*overflow:\s*visible/s);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?\.group-editor-drawer\s*\{[^}]*height:\s*100dvh/s);
  assert.doesNotMatch(styles, /\.group-editor-body\s*>\s*section\s*\{[^}]*overflow:\s*hidden/s);
});
