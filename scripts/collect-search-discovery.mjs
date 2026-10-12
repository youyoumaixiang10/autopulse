import { readHtmlWithFallback } from './browser-collector.mjs';
import { parseBingResults } from './bing-search.mjs';
import { issueSearchDates, readJson, writeJson } from './content-utils.mjs';
import { sourceRegistry } from '../data/sources.js';
import { monitoringCoverage } from '../data/monitoring-coverage.js';

const dir = new URL('../runtime/', import.meta.url);
const previous = readJson(new URL('search-candidates.json', dir), { candidates: [] }).candidates;
const searchSources = sourceRegistry.filter(source => source.method === 'browser-search');
const sourceForUrl = value => {
  try {
    const host = new URL(value).hostname.replace(/^www\./u, '');
    return searchSources.find(source => {
      const sourceHosts = source.hosts || [new URL(source.url).hostname];
      return sourceHosts.some(candidate => {
        const sourceHost = candidate.replace(/^www\./u, '');
        return host === sourceHost || host.endsWith(`.${sourceHost}`) || sourceHost.endsWith(`.${host}`);
      });
    });
  } catch { return null; }
};
const targetDates = issueSearchDates();
const targetTexts = targetDates.map(date => {
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
});
const queries = targetTexts.flatMap(targetText => [
  ...monitoringCoverage.flatMap(item => [
    `${targetText} ${item.brand} 汽车`,
    `${targetText} ${item.brand} 汽车 上市 发布 改款 年款 新增版本`
  ]),
  `${targetText} 汽车行业 政策`
]);
const collected = [];
const sourceCounts = new Map(searchSources.map(source => [source.id, 0]));
let parsedLinks = 0;
for (const query of queries) {
  try {
    const html = await readHtmlWithFallback(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&mkt=zh-CN`, {
      accept: page => parseBingResults(page).length > 0
    });
    for (const link of parseBingResults(html)) {
      parsedLinks += 1;
      const source = sourceForUrl(link.url);
      if (!source || !link.title) continue;
      collected.push({ sourceId: source.id, sourceName: source.name, sourceType: source.sourceType, title: link.title, url: link.url, publishedAt: null, discoveryQuery: query });
      sourceCounts.set(source.id, (sourceCounts.get(source.id) || 0) + 1);
    }
  } catch { /* Official and media lists still publish when a search page is unavailable. */ }
}
const candidates = [...new Map([...previous, ...collected].map(item => [item.url, item])).values()];
const sourceResults = searchSources.map(source => ({
  sourceId: source.id, url: source.url, status: sourceCounts.get(source.id) ? 'partial' : 'no-recent-updates',
  candidateCount: sourceCounts.get(source.id),
  publicLabel: sourceCounts.get(source.id) ? `已发现 ${sourceCounts.get(source.id)} 条待核验线索` : '未发现待核验线索'
}));
writeJson(new URL('search-candidates.json', dir), {
  collectedAt: new Date().toISOString(), targetDates, candidates, sourceResults,
  publicationRule: '搜索只用于发现线索；仅在原文页面核验发布日期与正文后，才会作为媒体报道进入日报。'
});
console.log(`必应搜索：解析 ${parsedLinks} 条结果，其中 ${collected.length} 条属于已登记媒体，覆盖 ${queries.length} 个品牌与行业检索式。`);
