import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadIndexHtml() {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  return readFile(indexPath, 'utf8');
}

test('public/index.html references only Charlie assets', async () => {
  const html = await loadIndexHtml();

  const scriptMatches = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map((match) => match[1]);
  const linkMatches = Array.from(html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)).map((match) => match[1]);

  assert.deepEqual(scriptMatches, ['app.charlie.js']);
  assert.deepEqual(linkMatches, ['styles.charlie.css']);
});
