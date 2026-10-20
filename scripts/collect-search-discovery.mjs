import { mapLimit } from './async-pool.mjs';
import { readHtmlWithFallback } from './browser-collector.mjs';
import { parseBingResults } from './bing-search.mjs';
import { chinaDate, issueSearchDates, readJson, writeJson } from './content-utils.mjs';
import { sourceRegistry } from '../data/sources.js';
import { collectMediaLists, withinDiscoveryWindow } from './media-list-collectors.mjs';

const dir = new URL('../runtime/', import.meta.url);
const previous = readJson(new URL('search-candidates.json', dir), { candidates: [] }).candidates;
const searchSources = sourceRegistry.filter(source => source.method === 'browser-search');

export const sourceForUrl = value => {
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

function pathDate(url) {
  try {
    return new URL(url).pathname.match(/\/(20\d{2})-(\d{2})-(\d{2})\//u)?.slice(1).join('-') || null;
  } catch { return null; }
}

const searchStarted = Date.now();
const direct = await collectMediaLists();
const directById = new Map(direct.sourceResults.map(result => [result.sourceId, result]));
const today = chinaDate();
const [windowStart, windowEnd] = issueSearchDates();
const bingSources = searchSources.filter(source => !(directById.get(source.id)?.candidateCount > 0));
const queries = [
  ...bingSources.map(source => {
    const host = (source.hosts || [new URL(source.url).hostname])[0].replace(/^www\./u, '');
    return `site:${host} 汽车 上市 OR 发布 OR 交付 OR 订单`;
  }),
  `汽车行业 政策 OR 车展 OR 工信部 ${windowStart} ${windowEnd}`
];
const bingCollected = [];
const bingCounts = new Map(searchSources.map(source => [source.id, 0]));
await mapLimit(queries, 3, async query => {
  try {
    const html = await readHtmlWithFallback(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&mkt=zh-CN`, {
      accept: page => parseBingResults(page).length > 0
    });
    for (const link of parseBingResults(html)) {
      const source = sourceForUrl(link.url);
      if (!source || !link.title) continue;
      const discoveryPublishedAt = pathDate(link.url);
      if (!withinDiscoveryWindow(discoveryPublishedAt, today)) continue;
      bingCollected.push({
        sourceId: source.id, sourceName: source.name, sourceType: source.sourceType,
        title: link.title, url: link.url, publishedAt: null,
        ...(discoveryPublishedAt ? { discoveryPublishedAt } : {}),
        discoveryQuery: query, verificationStatus: 'media-discovery'
      });
      bingCounts.set(source.id, (bingCounts.get(source.id) || 0) + 1);
    }
  } catch { /* Direct lists still feed the daily report when search is unavailable. */ }
});
const fresh = [...direct.candidates, ...bingCollected].filter(item => withinDiscoveryWindow(item.discoveryPublishedAt, today));
const candidates = [...new Map([...previous, ...fresh].map(item => [item.url, item])).values()];
const sourceResults = searchSources.map(source => {
  const listed = directById.get(source.id);
  const bingCount = bingCounts.get(source.id) || 0;
  if (listed?.candidateCount) return { ...listed, url: source.url };
  if (bingCount) return {
    sourceId: source.id, url: source.url, status: 'partial', candidateCount: bingCount, listRead: false,
    publicLabel: `公开检索发现 ${bingCount} 条待核验线索`
  };
  if (listed?.listRead) return { ...listed, url: source.url };
  return {
    sourceId: source.id, url: source.url, status: 'partial', candidateCount: 0, listRead: false,
    publicLabel: listed?.publicLabel || '直连列表与公开检索均未匹配',
    ...(listed?.error ? { error: listed.error } : {})
  };
});
writeJson(new URL('search-candidates.json', dir), {
  collectedAt: new Date().toISOString(), targetDates: [windowStart, windowEnd], candidates, sourceResults,
  publicationRule: '列表和检索只用于发现线索；仅在原文页面核验发布日期与正文后，才会作为媒体报道进入日报。'
});
console.log(`媒体发现：直连 ${direct.candidates.length} 条，公开检索 ${bingCollected.length} 条，覆盖 ${searchSources.length} 个登记媒体，耗时 ${Date.now() - searchStarted}ms。`);
