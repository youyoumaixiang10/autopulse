import { sourceRegistry } from '../data/sources.js';
import { assignReportedBrands, isIndustryNews, chinaDate, readJson, writeJson } from './content-utils.mjs';
import { extractArticle } from './article-extractor.mjs';
import { collectBrowserHtml } from './browser-collector.mjs';
import { createSourceBudget, shouldReuseArticle } from './article-reuse.mjs';

const dir = new URL('../runtime/', import.meta.url);
const cacheFile = new URL('articles.json', dir);
const cache = readJson(cacheFile, {});
const sources = new Map(sourceRegistry.map(source => [source.id, source]));
const inputs = ['candidates.json', 'discovery-candidates.json', 'search-candidates.json', 'openai-search-candidates.json'].flatMap(file => readJson(new URL(file, dir), { candidates: [] }).candidates);
const candidates = [...new Map(inputs.map(item => [item.url, item])).values()];
const sourceRank = item => {
  const sourceType = sources.get(item.sourceId)?.sourceType;
  if (sourceType === 'official' || sourceType === 'government') return 0;
  if (sourceType === 'official-social') return 1;
  return 2;
};
candidates.sort((left, right) => sourceRank(left) - sourceRank(right));
const reusable = candidates.filter(item => sources.has(item.sourceId) && shouldReuseArticle(cache[item.url], item, Date.now(), chinaDate())).length;
console.log(`原文计划：${candidates.length} 条，缓存可复用 ${reusable}，待读取 ${candidates.length - reusable}`);
const failures = [];
const budget = createSourceBudget(90_000);
let next = 0;
let fetched = 0;
let processed = 0;
const enrichStarted = Date.now();
function verifiedDiscoveryDate(value) {
  const match = String(value || '').match(/^(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/u);
  if (!match || match[1] > chinaDate()) return null;
  return { publishedAt: match[1], publishedTime: match[2] ? `${match[1]} ${match[2]}` : match[1] };
}
function deriveBrands(source, detail) {
  // Official accounts stay on the account brand. Vertical stories follow the
  // lead subject, so a Chery ranking that only compares a focus brand is not
  // filed under that brand. Filing roundups still match focus brands named in
  // the headline or the first paragraphs.
  return assignReportedBrands(source, detail);
}
async function loadArticleHtml(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await collectBrowserHtml(url, { deadlineMs: 12_000 }); }
    catch (error) {
      lastError = error;
      if (attempt === 1 || !/timeout|aborted|超时|取消/iu.test(error.message || '')) throw error;
    }
  }
  throw lastError;
}
async function worker() {
  while (next < candidates.length) {
    const item = candidates[next++];
    const existing = cache[item.url];
    const registeredSource = sources.get(item.sourceId);
    if (registeredSource && shouldReuseArticle(existing, item, Date.now(), chinaDate())) {
      cache[item.url] = { ...existing, brands: deriveBrands(registeredSource, existing) };
      processed++;
      continue;
    }
    if (budget.blocked(item.sourceId)) {
      budget.skip(item.sourceId);
      processed++;
      continue;
    }
    const started = Date.now();
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
      budget.charge(item.sourceId, Date.now() - started, detail.contentParagraphs.length > 0);
    } catch (error) {
      failures.push({ sourceId: item.sourceId, url: item.url, reason: error.message });
      budget.charge(item.sourceId, Date.now() - started, false);
      if (!existing) cache[item.url] = { ...item, contentParagraphs: [], reviewReasons: ['正文获取失败'], fetchError: error.message };
    }
    processed++;
  }
}
const progress = setInterval(() => {
  const skipped = budget.snapshot().reduce((sum, item) => sum + item.skipped, 0);
  console.log(`原文进度：${processed}/${candidates.length}，新读取 ${fetched}，失败 ${failures.length}，预算跳过 ${skipped}，已用 ${Date.now() - enrichStarted}ms`);
}, 20_000);
progress.unref?.();
try {
  await Promise.all(Array.from({ length: 6 }, worker));
} finally {
  clearInterval(progress);
}
const durationMs = Date.now() - enrichStarted;
const sourceBudgets = budget.snapshot();
const skipped = sourceBudgets.reduce((sum, item) => sum + item.skipped, 0);
writeJson(cacheFile, cache);
writeJson(new URL('enrichment-status.json', dir), {
  completedAt: new Date().toISOString(), durationMs, fetched, skipped,
  cached: candidates.length - fetched - failures.length - skipped, failures, sourceBudgets
});
console.log(`原文处理：新读取 ${fetched} 篇，失败 ${failures.length} 篇，预算跳过 ${skipped} 篇，耗时 ${durationMs}ms；保留上次成功结果。`);
for (const item of sourceBudgets) {
  if (item.stopped) console.log(`来源预算：${item.sourceId} 失败耗时 ${item.failureMs}ms，跳过 ${item.skipped} 条`);
}
