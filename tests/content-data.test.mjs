import test from 'node:test';
import assert from 'node:assert/strict';
import { reportsByDate } from '../data/reports.js';
import { launchesByMonth } from '../data/launches.js';
import { sourceRegistry } from '../data/sources.js';
import { officialSocialCoverage } from '../data/official-social.js';
import { monitoringCoverage } from '../data/monitoring-coverage.js';

function collectAllIds() {
  const reportIds = Object.values(reportsByDate).flatMap(report => [
    ...report.highlights,
    ...report.industry,
    ...Object.values(report.brands).flat()
  ].map(story => story.id));
  const launchIds = Object.values(launchesByMonth).flat().map(launch => launch.id);
  return [...reportIds, ...launchIds];
}

test('each story has auditable editorial fields', () => {
  for (const report of Object.values(reportsByDate)) {
    const stories = [...report.highlights, ...report.industry, ...Object.values(report.brands).flat()];
    for (const story of stories) {
      assert.ok(story.id);
      assert.ok(Array.isArray(story.tags) && story.tags.length > 0);
      assert.ok(story.title && story.summary && story.detail);
      assert.ok(story.sourceName && 'sourceUrl' in story && story.publishedAt);
    }
  }
});

test('each launch uses a known status and has an auditable source', () => {
  const allowed = new Set(['launched', 'confirmed', 'estimated']);
  for (const [month, launches] of Object.entries(launchesByMonth)) {
    assert.match(month, /^\d{4}-\d{2}$/);
    for (const launch of launches) {
      assert.ok(allowed.has(launch.status));
      assert.ok(launch.id && launch.sourceName && 'sourceUrl' in launch && launch.detail);
    }
  }
});

test('story and launch IDs are globally unique', () => {
  const ids = collectAllIds();
  assert.equal(new Set(ids).size, ids.length);
});

test('source registry uses HTTPS sources, declared collection states, and source types', () => {
  const allowed = new Set(['pilot', 'route-check']);
  const sourceTypes = new Set(['official', 'government', 'vertical-media', 'official-social']);
  for (const source of sourceRegistry) {
    assert.match(source.url, /^https:\/\//);
    assert.ok(Array.isArray(source.brands));
    assert.ok(allowed.has(source.status));
    assert.ok(sourceTypes.has(source.sourceType));
    assert.ok(source.id && source.name && source.category && source.method);
  }
});

test('each monitored brand has an official-social account verification plan', () => {
  const expectedBrands = ['鸿蒙智行', '比亚迪', '零跑', '蔚来', '乐道', '理想', '极氪', '小米', '小鹏', '岚图', '阿维塔', '深蓝', '腾势', '吉利银河', '特斯拉', '启源'];
  assert.deepEqual(officialSocialCoverage.map(item => item.brand), expectedBrands);
  for (const item of officialSocialCoverage) {
    assert.ok(['account-check', 'partial-verified'].includes(item.status));
    assert.ok(item.channels.includes('微信公众号'));
    assert.ok(item.channels.includes('微博'));
  }
});

test('each monitored brand has official and vertical-media discovery coverage', () => {
  const sourcesById = new Map(sourceRegistry.map(source => [source.id, source]));
  const socialByBrand = new Map(officialSocialCoverage.map(item => [item.brand, item]));
  assert.equal(monitoringCoverage.length, 16);
  for (const coverage of monitoringCoverage) {
    assert.ok(socialByBrand.has(coverage.brand));
    assert.ok(coverage.officialSourceIds.length > 0);
    assert.ok(coverage.discoverySourceIds.length > 0);
    for (const sourceId of coverage.officialSourceIds) {
      const source = sourcesById.get(sourceId);
      assert.ok(source && source.sourceType === 'official');
    }
    for (const sourceId of coverage.discoverySourceIds) {
      const source = sourcesById.get(sourceId);
      assert.ok(source && source.sourceType === 'vertical-media');
    }
  }
});
