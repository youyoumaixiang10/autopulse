import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReports, classify, ensureIssueRange, mergeLaunches, reportIssueDate, titleQualityIssues, validateReports } from '../scripts/report-builder.mjs';
import { extractArticle } from '../scripts/article-extractor.mjs';
import { identifyBrands, issueSearchDates } from '../scripts/content-utils.mjs';
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
test('lead bullets cite a verified fact and its source without adding claims', () => {
  const article = record(1, {
    sourceName: '新浪汽车',
    title: '银河战舰700开启交付',
    contentParagraphs: ['开场介绍。银河战舰700订单超过700台，并公布到店安排。']
  });
  const report = buildReports([article], {}, now).reports['2026-09-09'];
  assert.equal(report.leadBullets.length, 1);
  assert.match(report.leadBullets[0].text, /700/);
  assert.equal(report.leadBullets[0].sourceName, '新浪汽车');
  assert.match(report.brands['理想'][0].summary, /700/);
  assert.doesNotMatch(report.brands['理想'][0].summary, /^媒体报道[：:]/u);
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
test('xpeng stories are a focused brand group rather than other brands', () => {
  const article = record(1, {
    title: '小鹏G9L上市', brands: [], sourceType: 'vertical-media',
    contentParagraphs: ['小鹏G9L正式上市，售价23.18万元起。']
  });
  const report = buildReports([article], {}, now).reports['2026-09-09'];
  assert.equal(report.brands['小鹏'].length, 1);
  assert.equal(report.otherBrands.length, 0);
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
