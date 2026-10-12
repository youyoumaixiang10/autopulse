import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReports, classify, ensureIssueRange, isNewCarHighlight, mergeLaunches, reportIssueDate, titleQualityIssues, validateReports } from '../scripts/report-builder.mjs';
import { extractArticle } from '../scripts/article-extractor.mjs';
import { identifyBrands, issueSearchDates, mentionedMakers } from '../scripts/content-utils.mjs';
import { escapeHtml, safeHref, sortedDates, monthWindow } from '../data/view-utils.js';
import { createSiteServer } from '../scripts/serve.mjs';
import { reconcileLaunchCalendar } from '../scripts/reconcile-launch-calendar.mjs';
import { allowedDomains, candidatesFromResponse, discoveryJobs, hasStructuredOutput, isSpecificContentUrl, registeredSourceForUrl, structuredArticles } from '../scripts/openai-web-discovery.mjs';

const record = (number, changes = {}) => ({ title: `测试车型${number}上市`, url: `https://example.com/news/${number}`, sourceName: '测试媒体', sourceId: 'test', evidenceStatus: 'media', publishedAt: '2026-09-09', contentParagraphs: ['这里是可追溯原文中的正文内容。'], brands: ['理想'], reviewReasons: [], ...changes });
const now = new Date('2026-09-10T12:00:00+08:00');

test('daily discovery searches both calendar dates covered by the 08:00 issue window', () => {
  assert.deepEqual(issueSearchDates(new Date('2026-09-14T08:17:00+08:00')), ['2026-09-13', '2026-09-14']);
});
test('web discovery runs every focus brand plus source sweeps and industry', () => {
  const jobs = discoveryJobs(new Date('2026-09-14T08:17:00+08:00'));
  assert.equal(jobs.length, 20);
  assert.equal(new Set(jobs.filter(job => job.brand).map(job => job.brand)).size, 16);
  assert.match(jobs.find(job => job.brand === '小鹏').prompt, /小鹏汽车/);
  assert.match(jobs.find(job => job.brand === '鸿蒙智行').prompt, /问界.*智界.*享界.*尊界.*尚界/u);
  assert.match(jobs[0].prompt, /2026-09-13 08:00 至 2026-09-14 08:00/u);
  assert.equal(jobs.filter(job => job.id.startsWith('media-sweep:')).length, 3);
  assert.ok(jobs.find(job => job.id === 'media-sweep:1').allowedDomains.includes('autohome.com.cn'));
});
test('web discovery accepts only registered sources and exposes complete consulted URLs', () => {
  assert.ok(allowedDomains.includes('auto.sina.com.cn'));
  assert.equal(registeredSourceForUrl('https://auto.sina.com.cn/newcar/a.html').id, 'sina-auto');
  assert.equal(registeredSourceForUrl('https://weibo.com/teslaofficial/status/1', '特斯拉').id, 'tesla-weibo');
  assert.equal(registeredSourceForUrl('https://unknown.example/a'), null);
  const response = { output: [{ type: 'web_search_call', action: { sources: [
    { url: 'https://auto.sina.com.cn/newcar/a.html', title: '可信原文' },
    { url: 'https://unknown.example/a', title: '未知来源' }
  ] } }, { type: 'message', content: [{ annotations: [{ type: 'url_citation', url: 'https://auto.sina.com.cn/newcar/a.html', title: '核验后的标题' }] }] }] };
  const items = candidatesFromResponse(response, { id: 'brand:理想', brand: '理想' });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceId, 'sina-auto');
  assert.equal(items[0].title, '核验后的标题');
  assert.equal(items[0].discoveryBrand, '理想');
});
test('web discovery prefers structured article results over unrelated consulted pages', () => {
  const payload = JSON.stringify({ articles: [{ title: '小米汽车发布新车预告', url: 'https://www.ithome.com/1/002/003.htm', published_at: '2026-09-13 20:00' }] });
  const response = { output: [
    { type: 'web_search_call', action: { sources: [{ url: 'https://www.xiaomiev.com/' }] } },
    { type: 'message', content: [{ type: 'output_text', text: payload, annotations: [] }] }
  ] };
  assert.equal(structuredArticles(response).length, 1);
  const items = candidatesFromResponse(response, { id: 'brand:小米', brand: '小米' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '小米汽车发布新车预告');
  assert.equal(items[0].discoveryPublishedAt, '2026-09-13 20:00');
});
test('an empty structured result retains only specific consulted article pages', () => {
  const response = { output: [
    { type: 'web_search_call', action: { sources: [
      { url: 'https://www.xiaomiev.com/', title: '小米汽车官网' },
      { url: 'https://www.ithome.com/1/002/003.htm', title: '小米汽车发布新车预告' }
    ] } },
    { type: 'message', content: [{ type: 'output_text', text: '{"articles":[]}', annotations: [] }] }
  ] };
  assert.equal(hasStructuredOutput(response), true);
  const items = candidatesFromResponse(response, { id: 'brand:小米', brand: '小米' });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceId, 'ithome-auto');
  assert.equal(isSpecificContentUrl('https://www.xiaomiev.com/', registeredSourceForUrl('https://www.xiaomiev.com/')), false);
});

test('important news is unbounded and dates are sorted independently of insertion order', () => {
  const records = [...Array.from({ length: 7 }, (_, i) => record(i)), record(8, { publishedAt: '2026-09-08' }), record(9, { publishedAt: '2026-09-10' })];
  const { reports, launches } = buildReports(records, {}, now);
  assert.equal(reports['2026-09-09'].highlights.length, 7);
  assert.deepEqual(Object.keys(reports), ['2026-09-10', '2026-09-09', '2026-09-08']);
  assert.doesNotThrow(() => validateReports(reports, launches));
});
test('each daily issue covers the previous 08:00 through the current 08:00', () => {
  const issueNow = new Date('2026-09-11T08:00:00+08:00');
  const afterStart = record(1, { publishedAt: '2026-09-10', publishedTime: '2026-09-10T08:00:00+08:00' });
  const beforeCutoff = record(2, { publishedAt: '2026-09-11', publishedTime: '2026-09-11T07:59:00+08:00' });
  const afterCutoff = record(3, { publishedAt: '2026-09-11', publishedTime: '2026-09-11T08:00:00+08:00' });
  const { reports } = buildReports([afterStart, beforeCutoff, afterCutoff], {}, issueNow);
  assert.equal(reportIssueDate(afterStart), '2026-09-11');
  assert.equal(reportIssueDate(beforeCutoff), '2026-09-11');
  assert.equal(reportIssueDate(afterCutoff), '2026-09-12');
  assert.equal(reports['2026-09-11'].brands['理想'].length, 2);
  assert.equal(reports['2026-09-12'], undefined);
  assert.equal(reports['2026-09-11'].windowLabel, '9月10日 08:00 — 9月11日 08:00');
  assert.doesNotThrow(() => validateReports(reports, []));
});
test('the public archive keeps every issue date selectable even when no verified story was collected', () => {
  const reports = ensureIssueRange({}, '2026-09-12', '2026-09-14', new Date('2026-09-14T08:05:00+08:00'));
  assert.deepEqual(Object.keys(reports), ['2026-09-14', '2026-09-13', '2026-09-12']);
  assert.equal(reports['2026-09-14'].windowLabel, '9月13日 08:00 — 9月14日 08:00');
  assert.deepEqual(reports['2026-09-14'].brands, {});
});
test('highlights prioritise focused brands and government notices over unrelated media headlines', () => {
  const unrelated = record(1, { title: '外部品牌车型将于本月上市', brands: [] });
  const focused = record(2, { title: '理想新车发布会定档', brands: ['理想'] });
  const government = record(3, { title: '汽车行业政策公告', brands: [], evidenceStatus: 'government' });
  const { reports } = buildReports([unrelated, focused, government], {}, now);
  assert.equal(reports['2026-09-09'].highlights.length, 2);
  assert.equal(reports['2026-09-09'].industry.length, 1);
  assert.equal(reports['2026-09-09'].otherBrands.length, 1);
});
test('a non-focus-brand model update appears above industry information', () => {
  const model = record(1, { title: 'smart精灵#2开启早鸟计划 将于巴黎车展首发', contentParagraphs: ['smart精灵#2开启早鸟计划，将于巴黎车展首发。'], brands: [], industry: true });
  const { reports } = buildReports([model], {}, now);
  assert.equal(reports['2026-09-09'].otherBrands[0].title, 'smart精灵#2开启早鸟计划，将于巴黎车展首发');
  assert.equal(reports['2026-09-09'].industry.length, 0);
});
test('media bylines and fast-report labels stay in the source field, not the headline', () => {
  const sina = record(1, { title: '阿维塔发布9系旗舰SUV外观 与华为联合设计_新浪财经_新浪网', contentParagraphs: ['阿维塔发布9系旗舰SUV外观，与华为联合设计。'] });
  const netcar = record(2, { title: '【网通社快报】理想汽车CEO李想发文称i9为第二代纯电平台首发旗舰', contentParagraphs: ['理想汽车CEO李想发文称i9为第二代纯电平台首发旗舰。'] });
  const { reports } = buildReports([sina, netcar], {}, now);
  const titles = reports['2026-09-09'].brands['理想'].map(story => story.title);
  assert.ok(titles.includes('阿维塔发布9系旗舰SUV外观，与华为联合设计'));
  assert.ok(titles.includes('理想汽车CEO李想发文称i9为第二代纯电平台首发旗舰'));
});
test('media headlines are rewritten from the verified article lead instead of retaining a sensational source title', () => {
  const article = record(1, {
    title: '93万起！极氪9X杀入欧洲豪华腹地：成中国最贵出海车',
    contentParagraphs: ['快科技9月10日消息，近日，极氪在摩纳哥游艇展上发布了其欧洲市场迄今最重要的车型极氪9X。德国市场售价11.95万欧元起。'],
    brands: ['极氪']
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['极氪'][0];
  assert.equal(story.title, '极氪在摩纳哥游艇展上发布了其欧洲市场迄今最重要的车型极氪9X');
});
test('verified media stories fall back to a concise factual headline when the lead sentence is too long', () => {
  const et5t = record(1, {
    title: '加长L113 比例更修长低趴！疑似全新蔚来ET5T最新谍照曝光',
    publishedAt: '2026-09-13', publishedTime: '2026-09-13 18:09:52', brands: ['蔚来'],
    contentParagraphs: ['日前，有网友爆料了疑似全新蔚来ET5T的最新谍照。相较在售车型，新车视觉上明显更为修长低趴，预计于2027年正式发布。']
  });
  const roadster = record(2, {
    title: '终于要来了？特斯拉官宣新一代Roadster将于10月1日首秀',
    publishedAt: '2026-09-13', publishedTime: '2026-09-13 10:36:46', brands: ['特斯拉'],
    contentParagraphs: ['日前，我们从相关渠道了解到，特斯拉官宣新一代Roadster将于10月1日首秀。该车定位旗舰纯电超跑，此前亮相活动多次延期。']
  });
  const report = buildReports([et5t, roadster], {}, new Date('2026-09-14T10:20:00+08:00')).reports['2026-09-14'];
  assert.equal(report.brands['蔚来'][0].title, '疑似全新蔚来ET5T谍照曝光');
  assert.equal(report.brands['特斯拉'][0].title, '特斯拉官宣新一代Roadster将于10月1日首秀');
});
test('a clickbait price headline is rewritten from the verified offer details', () => {
  const article = record(20, {
    title: '部分车主1天亏1万？特斯拉也有无奈',
    brands: ['特斯拉'],
    contentParagraphs: [
      '9月7日一早，“特斯拉降价”的话题便冲上各大社交媒体的热搜榜首位。',
      '当天，特斯拉宣布开启限时优惠活动：9月30日前下单并提车Model 3/Model Y，可分别享受5000元和1万元优惠。'
    ]
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['特斯拉'][0];
  assert.equal(story.title, '特斯拉Model 3/Model Y限时优惠至9月30日，最高优惠1万元');
});
test('multiple reports about the same model debut merge and media names stay out of the title', () => {
  const sina = record(1, {
    title: '特斯拉新车发布会官宣！终于来了_新浪科技_新浪网', brands: ['特斯拉'],
    contentParagraphs: ['特斯拉终于正式官宣了全新 Roadster 跑车，将会在当地时间 10 月 1 日晚上发布。']
  });
  const autohome = record(2, {
    title: '终于要来了？特斯拉官宣新一代Roadster将于10月1日首秀', brands: ['特斯拉'],
    contentParagraphs: ['日前，我们从相关渠道了解到，特斯拉官宣新一代Roadster将于10月1日首秀。']
  });
  const stories = buildReports([autohome, sina], {}, now).reports['2026-09-09'].brands['特斯拉'];
  assert.equal(stories.length, 1);
  assert.equal(stories[0].sourceLinks.length, 2);
  assert.ok(!/新浪/u.test(stories[0].title));
});
test('a truncated discovery headline is rebuilt from a verified factual lead', () => {
  const article = record(1, {
    title: '比亚迪腾势 N8L 纯电全球首搭“迪迪虾”AI 超级智能体，官宣支付宝、 …',
    brands: ['比亚迪', '腾势'],
    contentParagraphs: ['IT之家 9 月 13 日消息，比亚迪旗下腾势 N8L 纯电全球首搭迪迪虾，将于 9 月 14 日 19:00 正式上市，今日有多位合作伙伴对这款新车的上市进行了祝贺。']
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['腾势'][0];
  assert.equal(story.title, '比亚迪旗下腾势N8L纯电全球首搭迪迪虾，将于9月14日19:00正式上市');
});
test('title quality guard rejects raw source copy and accepts a factual editorial title', () => {
  assert.deepEqual(titleQualityIssues('日前，我们从工信部目录中发现了新车申报图…'), ['标题过长或截断', '标题使用原文叙述口吻']);
  assert.deepEqual(titleQualityIssues('品牌官方微博视频'), ['标题包含来源或载体']);
  assert.deepEqual(titleQualityIssues('新款极氪7X完成申报，新增85kWh电池'), []);
});
test('a routine brand post does not become a highlight only because an old promotion appears in a hashtag', () => {
  const post = record(1, {
    title: '理想汽车分享智能泊车功能',
    evidenceStatus: 'official',
    contentParagraphs: ['介绍日常使用中的智能泊车功能。 #理想L系列限时预售权益#']
  });
  const { reports } = buildReports([post], {}, now);
  assert.equal(reports['2026-09-09'].highlights.length, 0);
});
test('a routine brand FAQ does not become a highlight merely because it says it responds to users', () => {
  const post = record(1, {
    title: '品牌用户问答内容上线，回应每份关切',
    evidenceStatus: 'official',
    contentParagraphs: ['本期围绕版本选购和用车技巧解答网友问题。']
  });
  const { reports } = buildReports([post], {}, now);
  const story = reports['2026-09-09'].brands['理想'][0];
  assert.equal(reports['2026-09-09'].highlights.length, 0);
  assert.deepEqual(story.tags, ['品牌动态']);
});
test('a brand response to a specific public issue remains an important item', () => {
  const post = record(1, {
    title: '品牌回应网传测试车事故',
    evidenceStatus: 'official',
    contentParagraphs: ['官方说明事故发生经过及后续处理。']
  });
  const { reports } = buildReports([post], {}, now);
  const story = reports['2026-09-09'].highlights[0];
  assert.deepEqual(story.tags, ['品牌回应']);
});
test('story classification retains multiple relevant business tags', () => {
  assert.deepEqual(classify('全新车型上市，预订价及首发权益公布', 'official'), ['新车', '促销']);
});
test('a short official social headline inherits a product tag from its verified lead text', () => {
  const post = record(1, {
    title: '全新旗舰车型，一台更像家的车',
    evidenceStatus: 'official',
    sourceType: 'official-social',
    contentParagraphs: ['全新旗舰车型产品发布会将于9月16日举行。']
  });
  const story = buildReports([post], {}, now).reports['2026-09-09'].highlights[0];
  assert.deepEqual(story.tags, ['新车']);
});
test('summaries stay a short clip of the first verified paragraph', () => {
  const opening = '开场介绍只保留这一小段，后面的数字和来源名不应被抽出来单独铺开。';
  const article = record(1, {
    sourceName: '新浪汽车',
    title: '银河战舰700开启交付',
    contentParagraphs: [`${opening}${'补充说明'.repeat(20)}`, '银河战舰700订单超过700台，并公布到店安排。']
  });
  const report = buildReports([article], {}, now).reports['2026-09-09'];
  assert.equal(report.leadBullets, undefined);
  const summary = report.brands['理想'][0].summary;
  assert.match(summary, /^开场介绍/);
  assert.match(summary, /铺开。$/u);
  assert.doesNotMatch(summary, /700|新浪汽车|到店|^媒体报道[：:]/u);
  assert.ok(summary.length <= 93);
});
test('source-record details keep enough verified source context to be useful on the detail page', () => {
  const article = record(1, { contentParagraphs: ['第一段包含已经发布的产品和活动信息。', '第二段说明具体日期、价格或适用范围。'] });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.equal(story.editorialStatus, 'source-record');
  assert.equal(story.details.length, 2);
  assert.match(story.detail, /第二段说明/);
});
test('media boilerplate is excluded from summaries and detail points', () => {
  const article = record(1, { contentParagraphs: [
    '疑似全新蔚来ET5T谍照曝光，新车视觉上更加修长低趴。',
    '友情提示：如果您有新车谍照，请点击编辑头像私信给我们。',
    '新车预计采用三激光雷达感知方案，并基于第三代纯电平台打造。'
  ] });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.ok(!story.summary.includes('友情提示'));
  assert.ok(!story.detail.includes('私信给我们'));
  assert.equal(story.details.length, 2);
});
test('official social posts use a readable list title while preserving original source text in detail', () => {
  const article = record(1, {
    sourceType: 'official-social',
    title: '#品牌新车# 官方长文',
    contentParagraphs: ['#品牌新车# 全场景智能泊车功能上线！更多功能说明与用车建议。']
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.equal(story.title, '品牌新车 全场景智能泊车功能上线');
  assert.ok(!story.summary.includes('#'));
  assert.match(story.detail, /#品牌新车#/);
});
test('official social slogans become a factual event title when the post supplies a model and schedule', () => {
  const article = record(1, {
    sourceType: 'official-social',
    title: '全新理想i9，一台更像家的旗舰',
    contentParagraphs: ['全新理想i9，一台更像家的旗舰。9月16日 19:30，我们不见不散。观看全新理想i9产品发布会。']
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.equal(story.title, '理想 i9 产品发布会定档 9月16日 19:30');
});
test('official social launch clips become factual model and price headlines', () => {
  const article = record(1, {
    sourceType: 'official-social',
    title: '别眨眼，仔细看', brands: ['吉利银河'],
    contentParagraphs: ['一条视频讲清楚#吉利银河TT# 有多强！\n吉利银河TT上市限时先享价12.99万元起\n#吉利银河TT全球上市# 吉利银河的微博视频']
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].highlights[0];
  assert.equal(story.title, '吉利银河 TT 上市，限时12.99万元起');
});
test('quoted official-social Q&A posts use their supplied series title in the list', () => {
  const article = record(1, {
    sourceType: 'official-social',
    title: '小米汽车官方问答',
    contentParagraphs: ['“小米澎程N90 Max的七车叠罗汉挑战是什么测试？”\n“和日常用车场景有什么关系？”\n\n今日针对以上问题进行解答。 小米汽车答网友问（第287集）']
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.equal(story.title, '小米汽车答网友问（第287集）');
  assert.match(story.detail, /七车叠罗汉/);
});
test('brand mapping recognises focus-brand subbrands in a report lead paragraph', () => {
  assert.deepEqual(identifyBrands('第411批申报车型包括阿维塔T09和吉利银河M8'), ['阿维塔', '吉利银河']);
  assert.deepEqual(identifyBrands('问界M9与方程豹新车'), ['鸿蒙智行', '比亚迪']);
});
test('same event merges evidence, keeps the official account as primary and keeps other days', () => {
  const a = record(1); const b = record(2, { evidenceStatus: 'official', sourceName: '官方账号' });
  const notes = { [a.url]: { eventKey: 'launch' }, [b.url]: { eventKey: 'launch' } };
  const { reports } = buildReports([a, b, record(3, { publishedAt: '2026-09-08' })], notes, now);
  const story = reports['2026-09-09'].brands['理想'][0];
  assert.equal(reports['2026-09-09'].brands['理想'].length, 1);
  assert.equal(story.sourceUrl, b.url);
  assert.equal(story.sourceLinks.length, 2);
  assert.ok(reports['2026-09-08']);
});
test('editorial exclusions keep low-information source posts out of the report', () => {
  const keep = record(1);
  const exclude = record(2, { title: '无业务信息的短视频' });
  const { reports } = buildReports([keep, exclude], { [exclude.url]: { exclude: true } }, now);
  assert.equal(reports['2026-09-09'].brands['理想'].length, 1);
  assert.equal(reports['2026-09-09'].brands['理想'][0].sourceUrl, keep.url);
});
test('an incomplete social post or one without a readable factual title stays in the review queue', () => {
  const incomplete = record(1, { sourceType: 'official-social', evidenceStatus: 'official', contentComplete: false });
  const vague = record(2, { sourceType: 'official-social', evidenceStatus: 'official', title: '看看这一刻', contentParagraphs: ['我们今天与大家见面。'] });
  const { reports, reviewQueue } = buildReports([incomplete, vague], {}, now);
  assert.deepEqual(reports, {});
  assert.equal(reviewQueue.length, 2);
  assert.ok(reviewQueue.flatMap(item => item.reasons).some(reason => reason.includes('原帖正文未完整读取')));
  assert.ok(reviewQueue.flatMap(item => item.reasons).some(reason => reason.includes('无法生成符合编辑规范的标题')));
});
test('same model launch reported by multiple verified media sources appears once with both sources', () => {
  const a = record(1, { title: '吉利银河TT正式上市 限时先享价12.99万起', brands: ['吉利银河'] });
  const b = record(2, { title: '一文看懂吉利银河TT上市价格与权益', brands: ['吉利银河'], sourceName: '另一家媒体' });
  const story = buildReports([a, b], {}, now).reports['2026-09-09'].brands['吉利银河'][0];
  assert.equal(buildReports([a, b], {}, now).reports['2026-09-09'].brands['吉利银河'].length, 1);
  assert.equal(story.sourceLinks.length, 2);
});
test('the same model announcement from different outlets is one highlight and one brand card', () => {
  const gasgoo = record(1, {
    title: '小鹏汽车官宣MONA L05即将登场，定位“年轻人的首款大五座SUV”',
    sourceName: '盖世汽车',
    brands: ['小鹏'],
    sourceType: 'vertical-media',
    publishedTime: '2026-09-09',
    contentParagraphs: ['盖世汽车获悉 9月9日，小鹏汽车正式宣布，旗下MONA系列全新车型MONA L05即将登场，官方将其定位为“年轻人的首款大五座SUV”。']
  });
  const ithome = record(2, {
    title: '小鹏 MONA L05 官宣即将登场，号称“年轻人的首款大五座 SUV”',
    sourceName: 'IT之家',
    brands: ['小鹏'],
    sourceType: 'vertical-media',
    publishedTime: '2026-09-09',
    contentParagraphs: ['IT之家 9 月 9 日消息，小鹏汽车今日宣布，MONA L05，年轻人的首款大五座 SUV，即将登场。']
  });
  const report = buildReports([ithome, gasgoo], {}, now).reports['2026-09-09'];
  assert.equal(report.highlights.length, 1);
  assert.equal(report.brands['小鹏'].length, 1);
  assert.equal(report.highlights[0].id, report.brands['小鹏'][0].id);
  assert.equal(report.highlights[0].sourceName, '盖世汽车');
  assert.equal(report.highlights[0].sourceLinks.length, 2);
  assert.ok(report.highlights[0].sourceLinks.some(link => link.name === 'IT之家' && link.url !== report.highlights[0].sourceUrl));
});
test('different events and sibling models stay on separate cards', () => {
  const debut = record(1, {
    title: '小鹏汽车官宣MONA L05即将登场',
    brands: ['小鹏'],
    contentParagraphs: ['小鹏汽车官宣MONA L05即将登场，定位年轻人的首款大五座SUV。']
  });
  const filing = record(2, {
    title: '小鹏MONA L05完成工信部申报',
    brands: ['小鹏'],
    sourceName: 'IT之家',
    contentParagraphs: ['小鹏MONA L05完成工信部申报，车身长度4870毫米。']
  });
  const n90 = record(3, {
    title: '小米澎程N90上市，售价26.99万元起',
    brands: ['小米'],
    contentParagraphs: ['小米澎程N90上市，售价26.99万元起。']
  });
  const n70 = record(4, {
    title: '小米澎程N70上市，售价20.99万元起',
    brands: ['小米'],
    sourceName: '汽车之家资讯',
    contentParagraphs: ['小米澎程N70上市，售价20.99万元起。']
  });
  const { reports } = buildReports([debut, filing, n90, n70], {}, now);
  assert.equal(reports['2026-09-09'].brands['小鹏'].length, 2);
  assert.equal(reports['2026-09-09'].brands['小米'].length, 2);
});
test('official coverage is the primary card and equal-quality media keeps the earlier report', () => {
  const media = record(1, {
    title: '理想i8即将上市',
    sourceName: '盖世汽车',
    publishedTime: '2026-09-09 07:10',
    contentParagraphs: ['理想i8即将上市，定位家庭旗舰。']
  });
  const official = record(2, {
    title: '理想i8即将上市',
    evidenceStatus: 'official',
    sourceName: '理想汽车官方微博',
    sourceType: 'official-social',
    publishedTime: '2026-09-09 07:40',
    contentParagraphs: ['理想i8即将上市，定位家庭旗舰。']
  });
  const later = record(3, {
    title: '蔚来ET9即将上市',
    brands: ['蔚来'],
    sourceName: '甲媒体',
    publishedTime: '2026-09-09 07:40',
    contentParagraphs: ['蔚来ET9即将上市，定位行政旗舰。']
  });
  const earlier = record(4, {
    title: '蔚来ET9即将上市',
    brands: ['蔚来'],
    sourceName: '乙媒体',
    publishedTime: '2026-09-09 07:10',
    contentParagraphs: ['蔚来ET9即将上市，定位行政旗舰。']
  });
  const { reports } = buildReports([media, official, later, earlier], {}, now);
  assert.equal(reports['2026-09-09'].brands['理想'].length, 1);
  assert.equal(reports['2026-09-09'].brands['理想'][0].sourceName, '理想汽车官方微博');
  assert.equal(reports['2026-09-09'].brands['理想'][0].sourceLinks.length, 2);
  assert.equal(reports['2026-09-09'].brands['蔚来'].length, 1);
  assert.equal(reports['2026-09-09'].brands['蔚来'][0].sourceName, '乙媒体');
});
test('a launch confirmation survives when its daily story merges with a higher-priority source', () => {
  const official = record(1, { title: '吉利银河TT上市信息发布', evidenceStatus: 'official', sourceType: 'official-social', brands: ['吉利银河'], contentParagraphs: ['吉利银河TT上市信息发布。'] });
  const confirmation = record(2, { title: '吉利银河TT正式上市', brands: ['吉利银河'], contentParagraphs: ['吉利银河TT正式上市，限时先享价12.99万元起。'] });
  const notes = { [confirmation.url]: { launches: [{ date: '2026-09-10', brand: '吉利银河', model: '银河TT', kind: '新车上市', powertrain: '纯电轿车', priceText: '限时先享价12.99万元起', status: 'launched' }] } };
  const { launches } = buildReports([official, confirmation], notes, now);
  assert.equal(launches[0].status, 'launched');
  assert.equal(launches[0].sourceUrl, confirmation.url);
});
test('repeated official social materials for the same model debut merge into one readable update', () => {
  const a = record(1, {
    title: '品牌官方微博视频', evidenceStatus: 'official', sourceType: 'official-social', brands: ['比亚迪'],
    contentParagraphs: ['@高德地图 携手超级智能体「迪迪虾」，从被动响应到主动理解，首发#腾势N8L纯电#。']
  });
  const b = record(2, {
    title: '品牌官方微博视频', evidenceStatus: 'official', sourceType: 'official-social', brands: ['比亚迪'],
    contentParagraphs: ['@优酷 携手超级智能体「迪迪虾」，语音点播、解放双手，首发#腾势N8L纯电#。']
  });
  const story = buildReports([a, b], {}, now).reports['2026-09-09'].brands['比亚迪'][0];
  assert.equal(buildReports([a, b], {}, now).reports['2026-09-09'].brands['比亚迪'].length, 1);
  assert.equal(story.title, '腾势N8L纯电将首发“迪迪虾”超级智能体服务');
  assert.equal(story.sourceLinks.length, 2);
});
test('unknown dates, future dates and missing bodies go to review and never become todays news', () => {
  const { reports, reviewQueue } = buildReports([record(1, { publishedAt: null }), record(2, { publishedAt: '2026-09-11' }), record(3, { contentParagraphs: [] })], {}, now);
  assert.deepEqual(reports, {}); assert.equal(reviewQueue.length, 3);
});
test('calendar never turns a forecast into a completed launch when its planned day arrives', () => {
  const article = record(1);
  const notes = { [article.url]: { launches: [{ date: '2026-09-10', brand: '理想', model: '测试车型', status: 'estimated' }] } };
  assert.equal(buildReports([article], notes, now).launches[0].status, 'estimated');
  assert.deepEqual(monthWindow(new Date('2026-12-31T18:00:00Z')), ['2026-12', '2027-01', '2027-02']);
});
test('curated calendar keeps a quarter window without inventing an exact launch day', () => {
  const launches = mergeLaunches([], [{ id: 'calendar-q4', month: '2026-10', dateText: '第四季度（具体日期待官宣）', brand: '极氪', model: '新款极氪7X', kind: '计划上市', powertrain: '纯电 SUV', priceText: '价格待公布', status: 'estimated', statusLabel: '预计上市', sourceName: '测试媒体', sourceUrl: 'https://example.com/q4', evidenceLabel: '媒体报道' }]);
  assert.equal(launches[0].month, '2026-10');
  assert.equal(launches[0].date, undefined);
  assert.doesNotThrow(() => validateReports({}, launches));
});
test('calendar status is updated only by a post-launch source for the same model', () => {
  const calendar = { items: [{ id: 'tt', date: '2026-09-10', month: '2026-09', dateText: '9月10日', brand: '吉利银河', model: '银河TT', kind: '预计上市', powertrain: '纯电轿车', priceText: '预售14.59万元起', status: 'estimated', statusLabel: '预计上市', sourceName: '测试媒体', sourceUrl: 'https://example.com/preview', evidenceLabel: '媒体报道' }] };
  const articles = [record(1, { title: '吉利银河TT正式上市', publishedAt: '2026-09-10', contentParagraphs: ['吉利银河TT迎来正式上市，上市限时先享价12.99-18.59万元。'] })];
  const { calendar: next, changed } = reconcileLaunchCalendar(calendar, articles);
  assert.equal(changed, 1);
  assert.equal(next.items[0].status, 'launched');
  assert.equal(next.items[0].priceText, '12.99-18.59万元');
});
test('card summaries stop on a sentence and skip copyright boilerplate', () => {
  const article = record(1, {
    sourceName: '网易汽车',
    contentParagraphs: [
      '版权声明：本文版权为网易汽车所有，未经授权禁止转载。',
      '理想汽车公布新车交付与价格信息，覆盖续航、权益和到店安排。新一代理想L6位列增程市场前三。根据乘联会后续跟踪，下一段不应该被截进摘要，' + '补充说明'.repeat(40)
    ]
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.equal(story.summary.includes('版权'), false);
  assert.equal(story.summary.includes('根据乘联会'), false);
  assert.match(story.summary, /前三。$/u);
  assert.equal(story.summary.startsWith('媒体报道'), false);
  assert.ok(story.summary.length <= 110);
});
test('a financial lead keeps its own title and a stale March delivery hook is not a highlight', () => {
  const financial = record(1, {
    title: '理想汽车2026年中期业绩解读',
    publishedAt: '2026-10-11', publishedTime: '2026-10-11 09:00',
    contentParagraphs: [
      '理想汽车发布2026年第二季度财报，营收257亿元，净亏损12亿元。',
      '回顾今年3月，理想i6单月交付超过2.4万辆。'
    ]
  });
  const recap = record(2, {
    title: '理想i6交付回顾',
    publishedAt: '2026-10-11', publishedTime: '2026-10-11 10:00',
    contentParagraphs: ['今年3月，理想i6单月交付超过2.4万辆，成为当时的销量焦点。']
  });
  const report = buildReports([financial, recap], {}, new Date('2026-10-12T10:00:00+08:00')).reports['2026-10-12'];
  const earnings = report.brands['理想'].find(story => /257亿元/.test(story.summary));
  const march = report.brands['理想'].find(story => /2\.4万辆/.test(story.summary));
  assert.match(earnings.title, /营收257亿元|第二季度财报/);
  assert.equal(/2\.4万/.test(earnings.title), false);
  assert.equal(/2\.4万/.test(earnings.summary), false);
  assert.match(march.title, /2026年3月/);
  assert.equal(/今年3月/.test(march.title), false);
  assert.equal(report.highlights.some(story => story.id === march.id), false);
});
test('a Chery wholesale ranking is not filed under a focus brand it only compares', () => {
  const article = record(1, {
    title: '奇瑞9月批发销量排名公布',
    brands: ['比亚迪'],
    contentParagraphs: ['奇瑞9月批发量超过10万辆，比亚迪同期批发量排在其后。']
  });
  const report = buildReports([article], {}, now).reports['2026-09-09'];
  assert.equal(report.brands['比亚迪'], undefined);
  assert.equal(report.otherBrands.length, 1);
  assert.match(report.otherBrands[0].summary, /奇瑞/);
});
test('wire attribution is not a headline and a single other-brand model stays in other brands', () => {
  const idEra = record(1, {
    title: '空间宽敞 上汽大众ID.ERA 5X内饰谍照曝光',
    brands: [], sourceType: 'vertical-media', sourceName: '盖世汽车',
    contentParagraphs: [
      '近日，车质网从相关渠道获悉。上汽大众ID.ERA 5X内饰谍照曝光，新车此前已开启盲订，预计将于2026年第四季度正式上市，时间或为11月。',
      '从曝光的谍照来看，座舱配备悬浮式中控屏。'
    ]
  });
  const m5 = record(2, {
    title: '延续V8插混动力 中期改款宝马M5谍照曝光',
    brands: [], sourceType: 'vertical-media', sourceName: '盖世汽车',
    contentParagraphs: ['近日，车质网从相关渠道获悉，中期改款宝马M5谍照曝光，并在纽博格林赛道进行测试。新车预计将于2027年推出。']
  });
  const report = buildReports([idEra, m5], {}, now).reports['2026-09-09'];
  assert.equal(report.otherBrands.find(story => /ID\.ERA 5X/.test(story.title)).title, '上汽大众ID.ERA 5X内饰谍照曝光');
  assert.equal(report.otherBrands.find(story => /M5/.test(story.title)).title, '中期改款宝马M5谍照曝光，并在纽博格林赛道进行测试');
  assert.equal(report.industry.length, 0);
  assert.equal(/车质网|从相关渠道获悉/.test(report.otherBrands.map(story => story.title).join(' ')), false);
});
test('channel greetings are dropped and a weekly multi-brand preview goes to industry', () => {
  const greeting = record(1, {
    title: 'IT早报 1012：国家安全部提醒接陌生来电先沉默三秒',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['“IT早报”时间，大家好，现在是2026年10月12日星期一，今天的重要科技资讯有：', '苹果首款智能家庭中枢定名 HomeView。']
  });
  const preview = record(2, {
    title: '比亚迪大汉/大众ID.ERA 8X等 2026年第42周(10.12-10.18)新车预告',
    brands: ['比亚迪'], sourceType: 'vertical-media',
    contentParagraphs: [
      '本期内容我们将为大家带来2026年10月12日-10月18日的新车预告。本周将迎来多款重磅新车上市/预售，其中包括比亚迪大汉、上汽大众ID.ERA 8X、捷途旅行者7、吉利星瑞L PLUS、埃安Ray7等。',
      '比亚迪大汉EV此前已开启预售，预售价区间为24.99-29.99万元。'
    ]
  });
  const policy = record(3, {
    title: '工信部：汽车创新设计迎新规 禁全隐藏门把手 行车禁用旋转座椅',
    brands: ['岚图'], sourceType: 'vertical-media', industry: true,
    contentParagraphs: ['近期，工业和信息化部会同公安部发布汽车产品创新设计征求意见稿。岚图汽车表示将支持本次征求意见稿。']
  });
  const roundup = record(4, {
    title: '新车谍照丨海洋网MPV、林肯9系、宝马纯电M3',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['海洋网MPV、林肯9系和宝马纯电M3的谍照集中曝光。']
  });
  const { reports, reviewQueue } = buildReports([greeting, preview, policy, roundup], {}, now);
  const report = reports['2026-09-09'];
  const titles = [...report.highlights, ...(report.otherBrands || []), ...report.industry, ...Object.values(report.brands).flat()].map(story => story.title);
  assert.equal(titles.some(title => /IT早报|大家好|今天的重要科技资讯/.test(title)), false);
  assert.equal(report.brands['比亚迪'], undefined);
  assert.equal(report.brands['岚图'], undefined);
  assert.equal(report.otherBrands.length, 0);
  assert.ok(report.industry.some(story => /比亚迪大汉/.test(story.title) && /ID\.ERA 8X/.test(story.title)));
  assert.equal(report.industry.find(story => /比亚迪大汉/.test(story.title)).summary.startsWith('本期内容'), false);
  assert.ok(report.industry.some(story => /工信部|征求意见稿|新规/.test(story.title)));
  assert.ok(report.industry.some(story => /林肯/.test(story.title) && /宝马/.test(story.title)));
  assert.ok(reviewQueue.some(item => /IT早报/.test(item.title)));
});
test('a subject-less clause yields to the source headline and stays in the right section', () => {
  const xpeng = record(1, {
    title: '小鹏智驾出海欧洲：两周微调适配一个国家，计划 2027 年落地 NGP',
    brands: [], sourceType: 'vertical-media', sourceName: 'IT之家',
    contentParagraphs: [
      'IT之家 10 月 12 日消息，据彭博社报道，在巴黎车展前夕，小鹏汽车通用智能中心负责人刘先明接受采访时透露，该公司成功在约两周时间内，将智驾系统从一个欧洲国家微调适配到另一个欧洲国家。',
      '据刘先明介绍，小鹏目前正与欧洲监管机构紧密沟通，并维持在 2027 年于欧洲正式落地智能导航辅助驾驶系统（NGP）的原定规划。'
    ]
  });
  const hud = record(2, {
    title: '国显科技推出4.1寸Mini LED AR-HUD PGU模组',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['盖世汽车获悉 国显科技近日推出4.1寸AR-HUD专用Mini LED PGU（图像生成单元）模组。该模组采用菲涅尔透镜阵列准直光学架构，旨在为高端新能源及智能驾驶AR-HUD提供高性能的国产像源方案。']
  });
  const mou = record(3, {
    title: '晶能与Wolfspeed签署合作备忘录',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['盖世汽车获悉，近日，Wolfspeed,Inc.（纽约证券交易所代码：WOLF）与晶能微电子（Geener Microelectronics）在杭州市吉利科技大厦签署合作备忘录，双方将围绕碳化硅功率模块的芯片供应、技术适配及市场拓展展开深度合作。']
  });
  const show = record(4, {
    title: '智驭向新丨华域 & 汇众底盘专场前瞻技术展即将启幕',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['由上汽集团共同主办，盖世汽车承办的智驭向新・华域&汇众底盘专场前瞻技术展，将于10月16日在汇众研发大楼举行。']
  });
  const dongfeng = record(6, {
    title: '东风风行携三款新车亮相2026巴黎车展',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['盖世汽车获悉 2026年10月12日至18日，东风风行携TK7、TK5及V9露营版三款车型，亮相在巴黎凡尔赛门展览中心7.1号馆举办的2026巴黎车展。']
  });
  const paris = record(5, {
    title: '巴黎车展上的两种姿态：中国猛攻，日系保守',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['10月12日，巴黎凡尔赛门展览中心，2026巴黎国际车展正式开幕。中国车企与日系车企在此同台亮相。']
  });
  const report = buildReports([xpeng, hud, mou, show, paris, dongfeng], {}, now).reports['2026-09-09'];
  const titles = [...report.highlights, ...(report.otherBrands || []), ...Object.values(report.brands).flat(), ...report.industry].map(story => story.title);
  assert.match(report.brands['小鹏'][0].title, /小鹏/);
  assert.equal(/将智驾系统从一个欧洲国家/.test(report.brands['小鹏'][0].title), false);
  assert.ok(titles.some(title => /国显科技/.test(title) && /推出|AR-HUD/.test(title)));
  assert.ok(report.industry.some(story => /Wolfspeed/.test(story.title) && /签署|备忘录/.test(story.title)));
  assert.equal(report.industry.some(story => /双方将围绕/.test(story.title)), false);
  assert.equal(report.brands['吉利'], undefined);
  assert.ok(report.industry.some(story => /华域/.test(story.title) && /汇众/.test(story.title)));
  assert.ok(report.industry.some(story => /巴黎/.test(story.title) && /开幕/.test(story.title)));
  assert.equal(report.otherBrands.find(story => /东风风行/.test(story.title)).title, '东风风行携三款新车亮相2026巴黎车展');
  assert.equal(titles.some(title => /旨在为|盖世汽车承办|从相关渠道获悉/.test(title)), false);
});
test('a quoted opener is replaced by the later factual sentence', () => {
  const article = record(1, {
    title: '车圈“造人”：第二曲线，还是纸面富贵？',
    brands: [], sourceType: 'vertical-media',
    contentParagraphs: [
      '“不布局，怕错失长期机会；提前投入，又要承担短期亏损。”',
      '过去两年，不少车企把具身智能写进核心战略，相关收入仍可忽略。'
    ]
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].industry[0];
  assert.match(story.title, /车企/);
  assert.equal(/不布局/.test(story.title), false);
  assert.equal(story.summary.includes('不布局'), false);
});
test('maker mentions do not double-count a compound brand', () => {
  assert.deepEqual(mentionedMakers('上汽大众ID.ERA 5X内饰谍照曝光'), ['上汽大众']);
  assert.deepEqual(mentionedMakers('吉利银河TT正式上市'), ['吉利银河']);
  assert.ok(mentionedMakers('比亚迪大汉/大众ID.ERA 8X等本周新车预告').length >= 2);
});
test('title quality rejects greetings, weekly intros and bare wire openers', () => {
  assert.ok(titleQualityIssues('“IT早报”时间，大家好，现在是2026年10月12日星期一，今天的重要科技资讯有：').includes('标题是频道问候或栏目导语'));
  assert.ok(titleQualityIssues('本期内容我们将为大家带来2026年10月12日的新车预告').includes('标题是频道问候或栏目导语'));
  assert.ok(titleQualityIssues('车质网从相关渠道获悉').includes('标题保留电头'));
  assert.deepEqual(titleQualityIssues('上汽大众ID.ERA 5X内饰谍照曝光'), []);
  assert.deepEqual(titleQualityIssues('中期改款宝马M5谍照曝光，并在纽博格林赛道进行测试'), []);
});
test('xpeng stories are a focused brand group rather than other brands', () => {
  const article = record(1, {
    title: '小鹏G9L上市', brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['小鹏G9L正式上市，售价23.18万元起。']
  });
  const report = buildReports([article], {}, now).reports['2026-09-09'];
  assert.equal(report.brands['小鹏'].length, 1);
  assert.equal(report.otherBrands.length, 0);
});
test('weekly preview teasers stay out of highlights and brand cards while a named model launch stays', () => {
  const issueNow = new Date('2026-10-12T10:00:00+08:00');
  const preview = record(1, {
    title: '比亚迪大汉/大众ID.ERA 8X等 2026年第42周(10.12-10.18)新车预告',
    brands: ['比亚迪'],
    publishedAt: '2026-10-11',
    publishedTime: '2026-10-11 20:00:00',
    contentParagraphs: [
      '本期内容我们将为大家带来2026年10月12日-10月18日的新车预告。本周将迎来多款重磅新车上市/预售，其中包括比亚迪大汉、上汽大众ID.ERA 8X、捷途旅行者7、吉利星瑞L PLUS、埃安Ray7等。大家可以继续关注我们后续详细的新车内容报道。',
      '比亚迪大汉EV此前已开启预售，共推出3款配置，预售价区间为24.99-29.99万元。'
    ]
  });
  const launch = record(2, {
    title: '比亚迪大汉正式开启预售',
    brands: ['比亚迪'],
    publishedAt: '2026-10-11',
    publishedTime: '2026-10-11 18:00:00',
    contentParagraphs: ['比亚迪大汉正式开启预售，预售价24.99万元起。']
  });
  const invite = record(3, {
    title: '一起来看本周新车',
    brands: ['理想'],
    publishedAt: '2026-10-11',
    publishedTime: '2026-10-11 12:00:00',
    contentParagraphs: ['一起来看本周新车，本期为您汇总一周新车动态。']
  });
  const dated = record(4, {
    title: '2026年10月12日-10月18日新车预告',
    brands: ['吉利银河'],
    publishedAt: '2026-10-11',
    publishedTime: '2026-10-11 11:00:00',
    contentParagraphs: ['2026年10月12日-10月18日新车预告。']
  });
  const concept = record(5, {
    title: '雪铁龙正式发布了全新2CV纯电版概念车的官方预告图',
    brands: ['吉利银河'],
    publishedAt: '2026-10-11',
    publishedTime: '2026-10-11 10:00:00',
    contentParagraphs: ['雪铁龙正式发布了全新2CV纯电版概念车的官方预告图。']
  });
  const namedPreview = record(6, {
    title: '问界M9新车预告',
    brands: ['鸿蒙智行'],
    publishedAt: '2026-10-11',
    publishedTime: '2026-10-11 09:00:00',
    contentParagraphs: ['问界M9新车预告将于10月20日正式上市，售价待公布。']
  });
  const report = buildReports([preview, launch, invite, dated, concept, namedPreview], {}, issueNow).reports['2026-10-12'];
  const stories = [...report.highlights, ...(report.otherBrands || []), ...Object.values(report.brands).flat()];
  const titles = stories.map(story => story.title);
  assert.equal(titles.some(title => /本期内容|第42周|一起来看本周|10月12日-10月18日新车预告|一周新车/.test(title)), false);
  assert.equal(report.brands['理想'], undefined);
  assert.equal(report.brands['比亚迪'].some(story => /新车预告|本期内容/.test(`${story.title} ${story.summary}`)), false);
  assert.equal(report.highlights.some(story => /比亚迪大汉正式开启预售/.test(story.title)), true);
  assert.ok(titles.some(title => /2CV/.test(title)));
  assert.ok(titles.some(title => /问界M9/.test(title) && /上市/.test(title)));
});
test('new-car highlight cards cover launches, unveilings, and spy shots of a specific model', () => {
  const card = (title, summary, tags = ['新车'], evidenceStatus = 'media') => ({ title, summary, tags, evidenceStatus });
  assert.equal(isNewCarHighlight(card('小鹏汽车官宣MONA L05即将登场', '全新车型MONA L05即将登场')), true);
  assert.equal(isNewCarHighlight(card('阿维塔T09完成全球首秀', '概念版于巴黎完成全球首秀')), true);
  assert.equal(isNewCarHighlight(card('银河战舰700正式上市', '共推出六大版型')), true);
  assert.equal(isNewCarHighlight(card('方程豹钛9内饰谍照曝光', '计划四季度上市')), true);
  assert.equal(isNewCarHighlight(card('2026款理想i6实车首次亮相', '10月28日国内上市', ['新车', '市场'])), true);
  assert.equal(isNewCarHighlight(card('8系内饰官图曝光', '大五座科技旗舰SUV内饰官图曝光', ['营销传播'])), true);
  assert.equal(isNewCarHighlight(card('特斯拉官宣新车Roadster将首秀', '新一代Roadster将于10月1日首秀')), true);
  assert.equal(isNewCarHighlight(card('工信部：汽车创新设计迎新规', '发布征求意见稿，禁止全隐藏门把手', ['新车'])), false);
  assert.equal(isNewCarHighlight(card('智界R7大定用户画像', '谈及智界R7的大定用户画像', ['新车'])), false);
  assert.equal(isNewCarHighlight(card('9月销量快报', '鸿蒙智行与小米未进前三', ['新车', '市场'])), false);
  assert.equal(isNewCarHighlight(card('仰望U9迎来OTA升级', '仰望U9将迎来全新OTA升级推送', ['新车'])), false);
  assert.equal(isNewCarHighlight(card('理想汽车公布9月交付数据', '交付新车31817辆', ['新车', '市场'])), false);
  assert.equal(isNewCarHighlight(card('赛力斯与宁德时代签署合作协议', '签署长期战略合作深化协议', ['市场'])), false);
  assert.equal(isNewCarHighlight(card('问界汽车计划于2027年进入欧洲市场', '问界将进入欧洲市场', ['新车'])), false);
  assert.equal(isNewCarHighlight(card('小米集团发布第二季度业绩公告', '单季营收1089亿元', ['新车'])), false);
  assert.equal(isNewCarHighlight(card('全新比亚迪海鸥正式开启盲订', '换代车型针对尺寸升级')), true);
  assert.equal(isNewCarHighlight(card('银河星舰7混动版完成工信部申报', '新增激光雷达')), true);
  assert.equal(isNewCarHighlight(card('智界R7大定用户画像', '智界R7焕新款于9月28日上市，新车长宽高已公布', ['新车'])), false);
  assert.equal(isNewCarHighlight(card('工信部：汽车创新设计迎新规 禁止全隐藏门把手', '发布征求意见稿，新申报产品须完成验证', ['新车'])), false);
});
test('a Zhao Changjiang user portrait and the door-handle rule are not new-car highlights', () => {
  const portrait = record(1, {
    title: '赵长江谈智界 R7 大定人群画像：家庭用户占比 92%',
    brands: ['鸿蒙智行'],
    publishedAt: '2026-09-09',
    publishedTime: '2026-09-09 19:40:00',
    contentParagraphs: [
      '智界汽车执行董事及执行副总裁赵长江今日发文，谈及了智界 R7（焕新款）的大定用户画像。',
      '购车家庭用户占比直接拉到 92%，远超以往。',
      '据此前报道，智界 R7 焕新款于 9 月 28 日上市，新车长宽高分别为 4982/1981/1634mm。'
    ]
  });
  const policy = record(2, {
    title: '工信部：汽车创新设计迎新规 禁止全隐藏门把手 行车禁用旋转座椅',
    brands: ['岚图'],
    publishedAt: '2026-09-09',
    publishedTime: '2026-09-09 22:30:00',
    contentParagraphs: [
      '工业和信息化部会同公安部发布《关于进一步加强汽车产品创新设计和研发测试验证有关管理工作的通知（征求意见稿）》。',
      '通知要求，新申报产品应按照技术规范完成验证，禁止配备全隐藏式门把手，行车时不可使用旋转座椅。'
    ]
  });
  const launch = record(3, {
    title: '小鹏汽车官宣MONA L05即将登场',
    brands: ['小鹏'],
    publishedAt: '2026-09-09',
    publishedTime: '2026-09-09 12:00:00',
    contentParagraphs: ['小鹏汽车官宣MONA L05即将登场，定位大五座SUV。']
  });
  const notes = {
    [portrait.url]: { important: true, title: '赵长江公布智界R7大定用户画像' },
    [policy.url]: { important: true },
    [launch.url]: { important: true }
  };
  const report = buildReports([portrait, policy, launch], notes, now).reports['2026-09-10'];
  const titles = report.highlights.map(story => story.title);
  const portraitStory = report.highlights.find(story => /用户画像/.test(story.title));
  const policyStory = report.highlights.find(story => /门把手|迎新规/.test(story.title));
  const launchAt = titles.findIndex(title => /MONA L05/.test(title));
  assert.equal(portraitStory.tags.includes('新车'), false);
  assert.ok(portraitStory.tags.some(tag => tag === '市场' || tag === '品牌动态'));
  assert.equal(policyStory.tags.includes('新车'), false);
  assert.ok(policyStory.tags.includes('政策'));
  assert.ok(policyStory.tags.includes('行业'));
  assert.ok(launchAt >= 0 && launchAt < titles.findIndex(title => /用户画像/.test(title)));
  assert.ok(launchAt < titles.findIndex(title => /门把手|迎新规/.test(title)));
  assert.equal(isNewCarHighlight({ ...portraitStory, tags: ['新车'] }), false);
  assert.equal(isNewCarHighlight({ ...policyStory, tags: ['新车'] }), false);
  assert.equal(classify(`${portrait.title} ${portrait.contentParagraphs.join(' ')}`, 'media').includes('新车'), false);
  assert.equal(classify(`${policy.title} ${policy.contentParagraphs.join(' ')}`, 'media').includes('新车'), false);
  assert.ok(classify(`${policy.title} ${policy.contentParagraphs.join(' ')}`, 'media').includes('政策'));
});
test('daily highlights place new-car cards first and keep recency inside each group', () => {
  const items = [
    record(1, { title: '汽车创新设计迎新规', brands: [], evidenceStatus: 'government', publishedAt: '2026-09-09', publishedTime: '2026-09-09 22:00:00', contentParagraphs: ['工业和信息化部发布汽车设计新规征求意见稿，禁止全隐藏门把手。'] }),
    record(2, { title: '小鹏汽车官宣MONA L05即将登场', brands: ['小鹏'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 18:00:00', contentParagraphs: ['小鹏汽车官宣MONA L05即将登场，定位大五座SUV。'] }),
    record(3, { title: '理想汽车公布9月交付数据', brands: ['理想'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 21:00:00', contentParagraphs: ['理想汽车公布9月交付数据，交付新车31817辆。'] }),
    record(4, { title: '方程豹钛9内饰谍照曝光', brands: ['比亚迪'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 12:00:00', contentParagraphs: ['方程豹钛9内饰谍照曝光，计划四季度上市。'] }),
    record(5, { title: '仰望U9迎来OTA升级', brands: ['比亚迪'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 23:00:00', contentParagraphs: ['仰望U9将迎来全新OTA升级推送，新增导航播报与哨兵时段。'] }),
    record(6, { title: '理想i6实车首次亮相', brands: ['理想'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 16:00:00', contentParagraphs: ['理想i6实车首次亮相，并将于10月28日上市。'] }),
    record(7, { title: '智界R7公布大定用户画像', brands: ['鸿蒙智行'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 19:30:00', contentParagraphs: ['智界R7公布大定用户画像，家庭用户占比92%。'] }),
    record(8, { title: '阿维塔T09全球首发', brands: ['阿维塔'], publishedAt: '2026-09-09', publishedTime: '2026-09-09 20:00:00', contentParagraphs: ['阿维塔T09在巴黎完成全球首发。'] })
  ];
  const notes = Object.fromEntries(items.map(item => [item.url, { important: true }]));
  const report = buildReports(items, notes, now).reports['2026-09-10'];
  const titles = report.highlights.map(story => story.title);
  const newCars = report.highlights.filter(isNewCarHighlight);
  const rest = report.highlights.filter(story => !isNewCarHighlight(story));
  assert.deepEqual(report.highlights, [...newCars, ...rest]);
  const order = [/阿维塔T09/, /MONA L05/, /理想i6/, /钛9/, /OTA/, /征求意见稿/, /交付数据/, /用户画像/];
  assert.equal(titles.length, order.length);
  order.forEach((pattern, index) => assert.match(titles[index], pattern));
  assert.deepEqual(report.brands['理想'].map(story => story.publishedTime), ['2026-09-09 21:00:00', '2026-09-09 16:00:00']);
  assert.deepEqual(report.brands['比亚迪'].map(story => story.publishedTime), ['2026-09-09 23:00:00', '2026-09-09 12:00:00']);
});
test('a summary that only repeats the title is rewritten from a later factual sentence', () => {
  const lead = '理想汽车公布新车交付与价格安排，并说明到店安排与价格口径以及后续交付节奏和权益说';
  const point = '零跑8月全球交付量达103129台，同比增长80.7%，同时公布到店权益、区域配额、金融方案和后续交付节奏';
  const article = record(1, {
    title: '理想交付安排',
    contentParagraphs: [`${lead}。${point}。`]
  });
  const story = buildReports([article], {}, now).reports['2026-09-09'].brands['理想'][0];
  assert.equal(story.title, lead);
  assert.match(story.summary, /103129台/);
  assert.notEqual(story.summary.replace(/[。！？!?\s]/gu, ''), lead);
});
test('UI escapes imported headline markup and rejects unsafe links', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.deepEqual(sortedDates({ '2026-09-08': {}, '2026-09-10': {}, '2026-09-09': {} }), ['2026-09-10', '2026-09-09', '2026-09-08']);
});
test('the Chinese daily page opts out of browser translation overlays', async () => {
  const html = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../index.html', import.meta.url), 'utf8'));
  assert.match(html, /<html lang="zh-CN" translate="no">/u);
});
test('article extraction uses newsroom publication time and original byline, not related news', () => {
  const next = { props: { pageProps: { articleInfoInfo: { content: { title: '车型正式上市', publishDate: '2026-09-09 11:39:39', type: '原创', authorName: '原创车闻', content: '<p>原文披露新车型的正式价格与上市信息。</p><script>恶意脚本</script>' } } } } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next).replaceAll('<', '\\u003c')}</script><nav><p>其他文章不应成为本文的正文或日期。</p></nav>`;
  const extracted = extractArticle(html, { sourceId: 'autohome-news', title: '列表标题', url: 'https://www.autohome.com.cn/news/x.html' });
  assert.equal(extracted.publishedAt, '2026-09-09'); assert.equal(extracted.mediaOriginal, true);
  assert.equal(extracted.contentParagraphs.length, 1); assert.ok(!extracted.contentParagraphs.join('').includes('恶意'));
});
test('新浪汽车 uses its visible article timestamp and body instead of stale metadata', () => {
  const html = '<div class="main-content">吉利银河TT正式上市 2026-09-10 21:49:08 新浪汽车原创</div><div class="article-content"><p>9月10日，吉利银河TT正式上市，共推出五大版型。</p></div><meta property="article:published_time" content="2026-09-07T11:15:11+08:00">';
  const extracted = extractArticle(html, { sourceId: 'sina-auto', title: '列表标题', url: 'https://auto.sina.com.cn/newcar/x.html' });
  assert.equal(extracted.publishedAt, '2026-09-10');
  assert.equal(extracted.publishedTime, '2026-09-10 21:49:08');
  assert.match(extracted.contentParagraphs[0], /五大版型/);
});
test('财经汽车 extracts the visible article timestamp and response body', () => {
  const html = '<div class="article">启境汽车回应小米澎程攻防需求 作者：闫祺2026-09-10 16:18</div><div class="article-content"><p>启境汽车表示，误发信息并非策划攻击友商。</p></div>';
  const extracted = extractArticle(html, { sourceId: 'caijing-auto', title: '列表标题', url: 'https://auto.caijing.com.cn/x.html' });
  assert.equal(extracted.publishedAt, '2026-09-10');
  assert.equal(extracted.publishedTime, '2026-09-10 16:18');
  assert.match(extracted.contentParagraphs[0], /并非策划/);
});
test('site serves public reports but never serves raw collection files or project files', async () => {
  const server = createSiteServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/runtime/articles.json', '/runtime/candidates.json', '/data/editorial-notes.json', '/package.json', '/scripts/serve.mjs', '/.env']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/runtime/generated-reports.json')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
