import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLaunchFromStory, mergeLaunches, qualifiesForLaunchCalendar, validateReports } from '../scripts/report-builder.mjs';

const story = (title, summary, extra = {}) => ({
  title,
  summary,
  detail: extra.detail || summary,
  brands: extra.brands || [],
  publishedAt: extra.publishedAt || '2026-10-12',
  sourceName: extra.sourceName || '测试媒体',
  sourceUrl: extra.sourceUrl || 'https://example.com/launch',
  evidenceLabel: extra.evidenceLabel || '媒体报道',
  evidenceStatus: extra.evidenceStatus || 'media'
});

test('正式上市 with a stated price becomes a launched calendar row', () => {
  const row = deriveLaunchFromStory(story(
    '银河战舰700 正式上市',
    '10月10日，银河战舰700正式上市，共推出三种动力、六大版型，上市限时焕新价16.98-35.98万元。',
    { brands: ['吉利银河'], sourceUrl: 'https://example.com/zhanjian' }
  ));
  assert.ok(row);
  assert.equal(row.brand, '吉利银河');
  assert.match(row.model, /银河战舰700/);
  assert.equal(row.status, 'launched');
  assert.equal(row.statusLabel, '已上市');
  assert.equal(row.date, '2026-10-10');
  assert.equal(row.dateText, '10月10日');
  assert.equal(row.windowText, undefined);
  assert.equal(row.month, '2026-10');
  assert.match(row.priceText, /16\.98-35\.98万元/);
  assert.equal(row.kind, '新车上市');
  assert.doesNotThrow(() => validateReports({}, [row]));
});

test('官宣 without a price or launch day stays confirmed and does not invent either', () => {
  const row = deriveLaunchFromStory(story(
    '小鹏汽车官宣MONA L05即将登场，定位“年轻人的首款大五座SUV”',
    '10月12日，小鹏汽车正式宣布，旗下MONA系列全新车型MONA L05即将登场。据工信部此前公示信息，MONA L05已于2026年5月9日亮相。',
    { brands: ['小鹏'], sourceUrl: 'https://example.com/mona' }
  ));
  assert.ok(row);
  assert.equal(row.brand, '小鹏');
  assert.match(row.model, /MONA L05/);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.statusLabel, '已官宣');
  assert.equal(row.date, undefined);
  assert.equal(row.dateText, '待定');
  assert.match(row.windowText, /即将登场/);
  assert.equal(row.priceText, '价格待公布');
  assert.equal(/\d+(?:\.\d+)?\s*万/.test(row.priceText), false);
  assert.equal(row.month, '2026-10');
});

test('a presale note that warns against calling it a launch stays unlaunched', () => {
  const row = deriveLaunchFromStory(story(
    '吉利银河战舰700将于9月15日开启全球预售',
    '9月15日是预售节点，正式上市时间并未确认。日历不把预售自动换成正式上市。',
    { publishedAt: '2026-09-10', brands: ['吉利银河'], sourceUrl: 'https://example.com/presale' }
  ));
  assert.ok(row);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.statusLabel, '已官宣');
  assert.equal(row.date, undefined);
  assert.equal(row.dateText, '待定');
  assert.match(row.windowText, /9月15日/);
  assert.equal(row.priceText, '价格待公布');
});

test('an announced refresh date is kept and a historical price is not reused', () => {
  const row = deriveLaunchFromStory(story(
    '长城坦克500车型官宣10月16日上新',
    '坦克500车型将于10月16日上新。综合此前报道，全新坦克500于2025年8月上市，官方指导价33.5万元至37.5万元。',
    { publishedAt: '2026-10-12', sourceUrl: 'https://example.com/tank' }
  ));
  assert.ok(row);
  assert.equal(row.date, undefined);
  assert.equal(row.dateText, '待定');
  assert.match(row.windowText, /10月16日上新/);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.statusLabel, '已官宣');
  assert.equal(row.priceText, '价格待公布');
});

test('谍照 keeps an honest window and does not invent a launch day or price', () => {
  const row = deriveLaunchFromStory(story(
    '方程豹钛9内饰谍照曝光',
    '方程豹钛9内饰谍照曝光，计划四季度上市，售价尚未公布。',
    { brands: ['比亚迪'], publishedAt: '2026-09-10', sourceUrl: 'https://example.com/tai9' }
  ));
  assert.ok(row);
  assert.match(row.model, /钛\s*9|钛9/);
  assert.equal(row.kind, '谍照');
  assert.equal(row.status, 'estimated');
  assert.equal(row.statusLabel, '未官宣');
  assert.equal(row.date, undefined);
  assert.equal(row.dateText, '待定');
  assert.match(row.windowText, /第四季度/);
  assert.equal(row.priceText, '价格待公布');
  assert.equal(row.month, '2026-10');
});

test('channel lead-ins, weekly previews, portraits, sales, policy, OTA and partnerships are rejected', () => {
  const rejected = [
    story('一周新车预告', '本期内容我们将为大家带来一周新车预告：银河战舰700将于10月10日上市，MONA L05官宣。'),
    story('IT早报', '大家好，现在是IT早报，银河战舰700正式上市，售价16.98万元。'),
    story('智界R7大定用户画像', '智界R7焕新款于9月28日上市，新车长宽高已公布，本文谈及大定用户画像。'),
    story('9月销量快报', '鸿蒙智行9月销量快报，问界M9交付数据公布。'),
    story('工信部：汽车创新设计迎新规', '工信部发布征求意见稿，新申报产品须完成验证，禁止全隐藏门把手。'),
    story('仰望U9迎来OTA升级', '仰望U9将迎来全新OTA升级推送。'),
    story('赛力斯与宁德时代签署合作协议', '赛力斯与宁德时代签署长期战略合作协议，问界M9继续合作。')
  ];
  for (const item of rejected) {
    assert.equal(qualifiesForLaunchCalendar(`${item.title} ${item.summary}`), false, item.title);
    assert.equal(deriveLaunchFromStory(item), null, item.title);
  }
});

test('亮相 without a formal launch day is 已官宣 and the time cell stays 待定', () => {
  const row = deriveLaunchFromStory(story(
    '阿维塔T09概念版亮相',
    '阿维塔T09概念版正式亮相，新车计划于年内正式发布，售价尚未公布。',
    { brands: ['阿维塔'], publishedAt: '2026-10-11', sourceUrl: 'https://example.com/t09' }
  ));
  assert.ok(row);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.statusLabel, '已官宣');
  assert.equal(row.date, undefined);
  assert.equal(row.dateText, '待定');
  assert.match(row.windowText, /年底/);
  assert.equal(row.month, '2026-12');
});

test('a stated future launch day is shown while the status stays 未官宣', () => {
  const row = deriveLaunchFromStory(story(
    'ID.ERA 8X将于10月12日上市',
    '上汽大众ID.ERA 8X将于10月12日上市，价格尚未公布。',
    { brands: ['大众'], publishedAt: '2026-10-10', sourceUrl: 'https://example.com/era' }
  ));
  assert.ok(row);
  assert.equal(row.status, 'estimated');
  assert.equal(row.statusLabel, '未官宣');
  assert.equal(row.date, '2026-10-12');
  assert.equal(row.dateText, '10月12日');
});

test('the same car does not duplicate a curated row, and a more specific launch replaces an estimate', () => {
  const auto = deriveLaunchFromStory(story(
    '银河战舰700 正式上市',
    '10月10日，银河战舰700正式上市，上市限时焕新价16.98-35.98万元。',
    { brands: ['吉利银河'], sourceName: '盖世汽车', sourceUrl: 'https://example.com/media', evidenceLabel: '媒体报道' }
  ));
  const official = deriveLaunchFromStory(story(
    '银河战舰700 正式上市',
    '10月10日，银河战舰700正式上市，上市限时焕新价16.98-35.98万元。',
    { brands: ['吉利银河'], sourceName: '吉利银河', sourceUrl: 'https://example.com/official', evidenceLabel: '官方发布', evidenceStatus: 'official' }
  ));
  const curated = {
    id: 'calendar-zhanjian',
    month: '2026-10',
    date: '2026-10-10',
    dateText: '10月10日',
    brand: '吉利银河',
    model: '银河战舰700',
    kind: '新车上市',
    powertrain: '多动力 越野SUV',
    priceText: '16.98-35.98万元',
    status: 'launched',
    statusLabel: '已上市',
    sourceName: '吉利汽车',
    sourceUrl: 'https://example.com/curated',
    evidenceLabel: '官方发布'
  };
  const sameDay = mergeLaunches([auto, official], [curated]);
  assert.equal(sameDay.length, 1);
  assert.equal(sameDay[0].id, 'calendar-zhanjian');
  assert.equal(sameDay[0].sourceUrl, 'https://example.com/curated');

  const sources = mergeLaunches([auto, official], []);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].evidenceLabel, '官方发布');
  assert.equal(sources[0].sourceUrl, 'https://example.com/official');

  const estimate = {
    id: 'calendar-tai9',
    month: '2026-10',
    dateText: '待定',
    windowText: '第四季度（具体日期待官宣）',
    brand: '比亚迪',
    model: '方程豹钛9',
    kind: '计划上市',
    powertrain: '插混 SUV',
    priceText: '价格待公布',
    status: 'estimated',
    statusLabel: '未官宣',
    sourceName: '汽车之家',
    sourceUrl: 'https://example.com/tai9-plan',
    evidenceLabel: '媒体报道'
  };
  const launched = deriveLaunchFromStory(story(
    '方程豹钛9正式上市',
    '10月15日，方程豹钛9正式上市，官方指导价32.98万元起。',
    { brands: ['比亚迪'], publishedAt: '2026-10-15', sourceUrl: 'https://example.com/tai9-live' }
  ));
  const upgraded = mergeLaunches([launched], [estimate]);
  assert.equal(upgraded.length, 1);
  assert.equal(upgraded[0].status, 'launched');
  assert.equal(upgraded[0].date, '2026-10-15');
  assert.match(upgraded[0].priceText, /32\.98万元起/);
});

test('a debut date and a later launch window stay separate', () => {
  const debut = {
    id: 'calendar-smart-2-debut',
    month: '2026-10',
    dateText: '待定',
    windowText: '10月12日全球首发',
    brand: 'smart',
    model: '精灵 #2',
    kind: '全球首发',
    powertrain: '纯电城市车',
    priceText: '价格待公布',
    status: 'confirmed',
    statusLabel: '已官宣',
    sourceName: '汽车之家',
    sourceUrl: 'https://example.com/smart-debut',
    evidenceLabel: '媒体报道'
  };
  const plan = {
    id: 'calendar-smart-2-launch',
    month: '2026-11',
    dateText: '待定',
    windowText: '11月中旬（具体日期待官宣）',
    brand: 'smart',
    model: '精灵 #2',
    kind: '计划上市',
    powertrain: '纯电城市车',
    priceText: '价格待公布',
    status: 'estimated',
    statusLabel: '未官宣',
    sourceName: '汽车之家',
    sourceUrl: 'https://example.com/smart-plan',
    evidenceLabel: '媒体报道'
  };
  const merged = mergeLaunches([], [debut, plan]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(item => item.id), ['calendar-smart-2-debut', 'calendar-smart-2-launch']);
  assert.deepEqual(merged.map(item => item.dateText), ['待定', '待定']);
  assert.match(merged[0].windowText, /10月12日全球首发/);
  assert.match(merged[1].windowText, /11月中旬/);
  assert.equal(merged[1].statusLabel, '未官宣');
});
