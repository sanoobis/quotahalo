'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('public package metadata identifies QuotaHalo and GPL-3.0-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'quotahalo');
  assert.equal(packageJson.author, 'sanoobis');
  assert.equal(packageJson.license, 'GPL-3.0-only');
  assert.equal(packageJson.build.productName, 'QuotaHalo');
});

test('repository contains the complete GPL license and trademark policy', () => {
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  const trademarks = fs.readFileSync(path.join(root, 'TRADEMARKS.md'), 'utf8');
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 29 June 2007/);
  assert.match(trademarks, /QuotaHalo trademark policy/);
});

test('renderer exposes all three display modes and a draggable app surface', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  for (const mode of ['full', 'compact', 'mini']) {
    assert.match(html, new RegExp(`data-display-mode="${mode}"`));
  }
  assert.match(css, /\.app-shell[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(css, /body\.mini/);
  assert.match(html, /id="miniLimitsSetting"/);
  assert.match(html, /5-hour \+ Weekly/);
});
