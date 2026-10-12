import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGalaxyNewsRecords, parseTeslaBlog } from '../scripts/official-fetch-collectors.mjs';

test('tesla blog teasers keep the official heading, china date and summary', () => {
  const html = `<section class="tcl-article-teaser"><span class="tcl-article-teaser__heading">向您介绍全新 Model 3 高性能版</span><span class="tcl-article-teaser__published-date">Tesla 团队，2024 年 4 月 23 日</span><div class="tcl-article-teaser__article-summary"><p>我们推出了全新 Model 3 高性能版。</p><a href="/blog/introducing-new-model-3-performance">继续阅读</a></div></section>`;
  const [item] = parseTeslaBlog(html);
  assert.equal(item.sourceId, 'tesla-home');
  assert.equal(item.publishedAt, '2024-04-23');
  assert.equal(item.url, 'https://www.tesla.cn/blog/introducing-new-model-3-performance');
  assert.deepEqual(item.contentParagraphs, ['我们推出了全新 Model 3 高性能版。']);
});

test('galaxy news keeps only public https articles that mention 银河', () => {
  const items = parseGalaxyNewsRecords({ data: { list: [
    { NewsTitle: '吉利银河战舰新增订单', NewsSummary: '订单超过700台', NewsDate: '2026-10-11T00:00:00', Url: 'https://galaxy.geely.com/news/20261011.html' },
    { NewsTitle: '吉利品牌9月销量', NewsSummary: '星越销量增长', NewsDate: '2026-10-10T00:00:00', Url: '/zh-CN/sitecore/content/Sites/Geely/home/news/2026/202610/1010' },
    { NewsTitle: '银河新车', NewsSummary: '即将发布', NewsDate: '2026-10-11', Url: 'https://example.com/news' }
  ] } });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://galaxy.geely.com/news/20261011.html');
  assert.equal(items[0].publishedAt, '2026-10-11');
});
