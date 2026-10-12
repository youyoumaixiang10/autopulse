import { monitoringCoverage } from '../data/monitoring-coverage.js';
import { sourceRegistry } from '../data/sources.js';
import { readJson, writeJson } from './content-utils.mjs';
import { brandCoverageState, freePathReady } from './coverage-rule.mjs';

const dir = new URL('../runtime/', import.meta.url);
const sourceResults = ['candidates.json', 'discovery-candidates.json', 'search-candidates.json']
  .flatMap(file => readJson(new URL(file, dir), {}).sourceResults || []);
const resultById = new Map(sourceResults.map(result => [result.sourceId, result]));
const webSearch = readJson(new URL('openai-search-candidates.json', dir), { providerStatus: 'unavailable', queryRuns: [] });
const webSearchByBrand = new Map((webSearch.queryRuns || []).filter(run => run.brand).map(run => [run.brand, run]));
const healthy = result => result?.status === 'ok' || (result?.status === 'no-recent-updates' && result.listRead === true);

const brands = monitoringCoverage.map(coverage => {
  const statuses = ids => ids.map(id => ({ id, ...(resultById.get(id) || { status: 'pending' }) }));
  const officialStatuses = statuses(coverage.officialSourceIds);
  const socialStatuses = statuses(sourceRegistry
    .filter(source => source.sourceType === 'official-social' && source.brands.includes(coverage.brand))
    .map(source => source.id));
  const discoveryStatuses = statuses(coverage.discoverySourceIds);
  return {
    brand: coverage.brand,
    webSearchStatus: webSearchByBrand.get(coverage.brand) || { status: 'skipped', sourceCount: 0 },
    state: brandCoverageState({ officialStatuses, socialStatuses, discoveryStatuses }),
    officialStatuses, socialStatuses, discoveryStatuses
  };
});
const media = sourceRegistry.filter(source => source.sourceType === 'vertical-media').map(source => ({
  id: source.id, name: source.name, ...(resultById.get(source.id) || { status: 'pending' })
}));
const policy = sourceRegistry.filter(source => source.sourceType === 'government').map(source => ({
  id: source.id, name: source.name, ...(resultById.get(source.id) || { status: 'pending' })
}));
const reviewQueue = readJson(new URL('review-queue.json', dir), []);
const completeBrands = brands.filter(item => item.state === 'complete').length;
const healthyMedia = media.filter(healthy).length;
const audit = {
  checkedAt: new Date().toISOString(),
  passed: freePathReady({ brands, policy }),
  summary: {
    completeBrands, totalBrands: brands.length, healthyMedia, totalMedia: media.length,
    policyHealthy: policy.some(healthy), unresolvedCandidates: reviewQueue.length
  },
  brands, media, policy,
  webSearch: { providerStatus: webSearch.providerStatus, queryRuns: webSearch.queryRuns || [] },
  rule: '品牌在官网列表和媒体发现都可读时计为完整。微博和 OpenAI 不参与这一判断。只要有一个官网或政策来源可读，日报就会发布。'
};
writeJson(new URL('coverage-audit.json', dir), audit);
console.log(JSON.stringify(audit.summary, null, 2));
if (!audit.passed) console.warn('官方与政策来源本轮都没有读到可用列表。');
else console.log('覆盖检查通过：日报由官网、政策、媒体列表和必应搜索生成，不调用付费模型。');
