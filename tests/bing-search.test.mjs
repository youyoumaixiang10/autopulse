import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBingHref, parseBingResults } from '../scripts/bing-search.mjs';

const encoded = Buffer.from('https://www.autohome.com.cn/news/202610/1317692.html', 'utf8').toString('base64');
const html = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=abc&amp;u=a1${encoded}&amp;ntb=1">理想汽车发布新车</a></h2><cite>https://www.autohome.com.cn › news › 202610 › 1317692.html</cite></li></ol>`;

test('decodes the current Bing redirect into the article URL', () => {
  const href = `https://www.bing.com/ck/a?!&&p=abc&u=a1${encoded}&ntb=1`;
  assert.equal(decodeBingHref(href), 'https://www.autohome.com.cn/news/202610/1317692.html');
  assert.deepEqual(parseBingResults(html), [{
    title: '理想汽车发布新车',
    url: 'https://www.autohome.com.cn/news/202610/1317692.html'
  }]);
});

test('uses the visible citation when the redirect cannot be decoded', () => {
  const page = '<li class="b_algo"><h2><a href="/ck/a">小米汽车交付</a></h2><cite>https://www.autohome.com.cn › news › 1.html</cite></li>';
  assert.equal(parseBingResults(page)[0].url, 'https://www.autohome.com.cn/news/1.html');
});
