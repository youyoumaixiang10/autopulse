import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bingDestination, collectMediaLists, parseBingSearchHtml, parseGasgooList, parseIfengAutoList,
  parseIthomeRss, parseNeteaseAutoList, parseNews18aList, parseSinaAutoList, parseSohuAutoList, withinDiscoveryWindow
} from '../scripts/media-list-collectors.mjs';

test('direct media lists keep article links and list dates from public markup', () => {
  const sina = parseSinaAutoList('<a href="https://auto.sina.com.cn/news/2026-10-11/detail-iniuwkhf8774904.shtml?oaid=1">李传海：银河战舰700是越野2.0时代</a><a href="https://auto.sina.com.cn/newcar/">新车</a>');
  assert.equal(sina.length, 1);
  assert.equal(sina[0].discoveryPublishedAt, '2026-10-11');
  assert.equal(sina[0].url, 'https://auto.sina.com.cn/news/2026-10-11/detail-iniuwkhf8774904.shtml');
  const gasgoo = parseGasgooList('<a href="/news/202610/11I70474473C501.shtml">吉利汽车进入加拿大市场并说明出口政策</a>');
  assert.equal(gasgoo[0].discoveryPublishedAt, '2026-10-11');
  assert.equal(gasgoo[0].sourceId, 'gasgoo-auto');
  const netease = parseNeteaseAutoList('<div data-title="远程星享M7E上市限时价11.39万元" data-url="https://www.163.com/auto/article/L90BNLHD0008856R.html"></div>');
  assert.equal(netease[0].sourceId, 'netease-auto');
  const news18a = parseNews18aList('<a href="//www.news18a.com/news/storys_304067.html"><div class="letters-time">10:15:08</div><div class="letters-title">零跑汽车宣布C系车型开始推送OTA更新</div></a>');
  assert.equal(news18a[0].title, '零跑汽车宣布C系车型开始推送OTA更新');
  assert.equal(news18a[0].url, 'https://www.news18a.com/news/storys_304067.html');
  const sohu = parseSohuAutoList('<a href="https://www.sohu.com/a/1085641704_430289">尊界V800陷刹车踏板风波</a><a href="https://www.sohu.com/a/1_2">今日菜谱</a>');
  assert.equal(sohu.length, 1);
  const ifeng = parseIfengAutoList('{"title":"赛力斯与宁德时代签署长期战略合作协议","url":"https:\\/\\/auto.ifeng.com\\/c\\/8x8C0dMH4sF"}');
  assert.equal(ifeng[0].url, 'https://auto.ifeng.com/c/8x8C0dMH4sF');
  const rss = parseIthomeRss('<?xml version="1.0"?><rss><channel><item><title>蔚来换电站单日超过200万次</title><link>https://www.ithome.com/1/011/808.htm</link><pubDate>Sun, 11 Oct 2026 02:00:00 GMT</pubDate><description>汽车</description></item><item><title>键盘新轴</title><link>https://www.ithome.com/1/011/809.htm</link><description>机械键盘</description></item></channel></rss>');
  assert.equal(rss.length, 1);
  assert.equal(rss[0].discoveryPublishedAt, '2026-10-11');
  const gadget = parseIthomeRss('<?xml version="1.0"?><rss><channel><item><title>小米显示器支架臂开售</title><link>https://www.ithome.com/1/011/810.htm</link><description>VESA</description></item></channel></rss>');
  assert.equal(gadget.length, 0);
});

test('discovery window drops stale list dates and Bing redirects still resolve to https articles', () => {
  assert.equal(withinDiscoveryWindow('2026-10-11', '2026-10-12'), true);
  assert.equal(withinDiscoveryWindow('2026-09-01', '2026-10-12'), false);
  assert.equal(withinDiscoveryWindow(null, '2026-10-12'), true);
  const target = 'https://auto.sina.com.cn/news/2026-10-11/detail-abc.shtml';
  const href = `https://www.bing.com/ck/a?u=a1${Buffer.from(target).toString('base64')}`;
  assert.equal(bingDestination(href), target);
  const html = `<div class="b_algo"><h2><a href="${href}">银河战舰订单</a></h2></div>`;
  assert.equal(parseBingSearchHtml(html)[0].url, target);
});

test('a failed direct list stays partial so publish can continue', async () => {
  const result = await collectMediaLists({
    today: '2026-10-12',
    fetchHtmlImpl: async () => { throw new Error('HTTP 403'); }
  });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.sourceResults.every(item => item.status === 'partial' && item.listRead === false));
});
