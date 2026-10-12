import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDongchediNews, parseDongchediHome } from '../scripts/dongchedi-collector.mjs';

const fixture = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  page: '/new_home', props: { pageProps: {
    todayNews: { head_article: [{ gid_str: '7682952411494629913', title: '实测小米澎程N90！', article_type: 1 }] },
    focusPic: [{ pic_list: [{ group_id: '7682313652146848318', title: '特斯拉推送FSD v14.3.9监督版', article_type: 1 }] }],
    newCarData: [{ online_date_unix: 1788710400, article_info: { gid: '7660462481990713918', title_name: '售26.99万元起，小米澎程N90正式上市' } }]
  } }
})}</script>
<a href="/article/7682952411494629913">实测小米澎程N90！</a>
<a href="/article/7682313652146848318"><img></a>
<a href="/article/7682313652146848318"><img></a>
<a href="/article/7660462481990713918">售26.99万元起，小米澎程N90正式上市</a>
<a href="/ugc/article/7671296504241373208">车友内容</a>`;

test('reads public editorial links and preserves missing article dates', () => {
  const rows = parseDongchediHome(fixture);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].title, '特斯拉推送FSD v14.3.9监督版');
  assert.equal(rows[0].sourceType, 'vertical-media');
  assert.ok(rows.every(row => row.publishedAt === null && row.sourceMonth === null));
  assert.equal(rows[2].publishedAt, null, 'vehicle launch date must not become article publication date');
});

test('does not report a login wall as a successful source', async () => {
  const result = await collectDongchediNews({ fetchImpl: async () => ({ ok: true, text: async () => '<script id="__NEXT_DATA__">{"page":"/login-required"}</script>' }) });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.sourceResults[0].status, 'failed');
  assert.match(result.sourceResults[0].reason, /登录/);
});

test('falls back to a direct request when the browser page has no public list', async () => {
  const result = await collectDongchediNews({
    browserImpl: async () => '<html><body>login</body></html>',
    httpImpl: async () => fixture
  });
  assert.equal(result.sourceResults[0].status, 'partial');
  assert.equal(result.sourceResults[0].candidateCount, 3);
});

test('marks homepage-only discovery as partial coverage', async () => {
  const result = await collectDongchediNews({ fetchImpl: async () => ({ ok: true, text: async () => fixture }) });
  assert.equal(result.sourceResults[0].status, 'partial');
  assert.equal(result.sourceResults[0].candidateCount, 3);
});
