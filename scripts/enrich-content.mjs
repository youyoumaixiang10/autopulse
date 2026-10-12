import { sourceRegistry } from '../data/sources.js';
import { identifyBrands, isIndustryNews, chinaDate, readJson, writeJson } from './content-utils.mjs';
import { extractArticle } from './article-extractor.mjs';
import { collectBrowserHtml } from './browser-collector.mjs';

const dir = new URL('../runtime/', import.meta.url);
const cacheFile = new URL('articles.json', dir);
const cache = readJson(cacheFile, {});
const sources = new Map(sourceRegistry.map(source => [source.id, source]));
const inputs = ['candidates.json', 'discovery-candidates.json', 'search-candidates.json', 'openai-search-candidates.json'].flatMap(file => readJson(new URL(file, dir), { candidates: [] }).candidates);
const candidates = [...new Map(inputs.map(item => [item.url, item])).values()];
const failures = [];
let next = 0;
let fetched = 0;
function verifiedDiscoveryDate(value) {
  const match = String(value || '').match(/^(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/u);
  if (!match || match[1] > chinaDate()) return null;
  return { publishedAt: match[1], publishedTime: match[2] ? `${match[1]} ${match[2]}` : match[1] };
}
function deriveBrands(source, detail) {
  // A verified brand-owned social account is itself the attribution boundary.
  // Its posts may mention partner brands or unrelated hashtags, which must not
  // create extra brand rows in the daily report.
  if (source.sourceType === 'official-social') return source.brands;
  // Use the lead paragraphs as well as the headline: a filing roundup may name its
  // focus brands in the introductory sentence rather than in its headline.
  const matchedBrands = identifyBrands([detail.title, ...(detail.contentParagraphs || []).slice(0, 2)].join(' '));
  return source.sourceType === 'vertical-media' ? matchedBrands : matchedBrands.length ? matchedBrands : source.brands.slice(0, 1);
}
async function loadArticleHtml(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await collectBrowserHtml(url); }
    catch (error) {
      lastError = error;
      if (attempt === 1 || !/timeout|aborted|超时/iu.test(error.message || '')) throw error;
    }
  }
  throw lastError;
}
async function worker() {
  while (next < candidates.length) {
    const item = candidates[next++];
    const existing = cache[item.url];
    const registeredSource = sources.get(item.sourceId);
    if (existing?.contentParagraphs?.length && registeredSource && (item.publishedAt < chinaDate() || Date.now() - Date.parse(existing.fetchedAt) < 6 * 60 * 60 * 1000)) {
      cache[item.url] = { ...existing, brands: deriveBrands(registeredSource, existing) };
      continue;
    }
    try {
      const source = registeredSource;
      if (!source) throw new Error('来源未登记');
      const expectedHosts = (source.hosts || [new URL(source.url).hostname]).map(host => host.replace(/^www\./, ''));
      const articleUrl = new URL(item.url);
      const articleHost = articleUrl.hostname.replace(/^www\./, '');
      if (articleUrl.protocol !== 'https:' || !expectedHosts.some(expectedHost => articleHost === expectedHost || articleHost.endsWith(`.${expectedHost}`) || expectedHost.endsWith(`.${articleHost}`))) throw new Error('原文链接不属于已登记的来源');
      const extracted = item.contentParagraphs?.length ? { ...item, title: item.title, publishedAt: item.publishedAt, contentParagraphs: item.contentParagraphs } : extractArticle(await loadArticleHtml(item.url), item);
      const discoveryDate = verifiedDiscoveryDate(item.discoveryPublishedAt);
      const detail = {
        ...extracted,
        publishedAt: extracted.publishedAt || discoveryDate?.publishedAt || null,
        publishedTime: extracted.publishedTime || discoveryDate?.publishedTime || null
      };
      const reasons = [];
      if (!detail.publishedAt) reasons.push('缺少原文发布日期');
      if (detail.publishedAt > chinaDate()) reasons.push('原文发布日期晚于当前日期');
      if (item.publishedAt && detail.publishedAt && item.publishedAt !== detail.publishedAt) reasons.push('列表与原文发布日期不一致');
      if (!detail.contentParagraphs.length) reasons.push('正文尚未读取成功');
      if (source.sourceType === 'vertical-media' && source.id === 'autohome-news' && !detail.mediaOriginal) reasons.push('媒体原创与作者信息待核验');
      const brands = deriveBrands(source, detail);
      cache[item.url] = { ...item, ...detail, brands, industry: source.sourceType === 'government' || isIndustryNews(detail.title),
        evidenceStatus: source.sourceType === 'government' ? 'government' : source.sourceType === 'vertical-media' ? 'media' : 'official',
        reviewReasons: reasons, fetchedAt: new Date().toISOString() };
      fetched++;
    } catch (error) {
      failures.push({ sourceId: item.sourceId, url: item.url, reason: error.message });
      if (!existing) cache[item.url] = { ...item, contentParagraphs: [], reviewReasons: ['正文获取失败'], fetchError: error.message };
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
writeJson(cacheFile, cache);
writeJson(new URL('enrichment-status.json', dir), { completedAt: new Date().toISOString(), fetched, cached: candidates.length - fetched - failures.length, failures });
console.log(`原文处理：新读取 ${fetched} 篇，失败 ${failures.length} 篇；保留上次成功结果。`);
