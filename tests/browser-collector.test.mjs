import test from 'node:test';
import assert from 'node:assert/strict';
import { readHtmlWithFallback } from '../scripts/browser-collector.mjs';

test('uses the direct response when the browser page has no parseable list', async () => {
  const html = await readHtmlWithFallback('https://example.test/news', {
    accept: page => page.includes('article'),
    browser: async () => '<html><body>empty shell</body></html>',
    http: async () => '<html><body><a href="/news/202610/1.html">article</a></body></html>'
  });
  assert.match(html, /article/);
});

test('reports both failures when neither response has a list', async () => {
  await assert.rejects(() => readHtmlWithFallback('https://example.test/news', {
    accept: () => false,
    browser: async () => { throw new Error('浏览器超时'); },
    http: async () => '<html></html>'
  }), /浏览器超时/);
});
