import { collectBrowserHtml, collectBrowserLinks } from './browser-collector.mjs';
import { parseAvatrNews, parseLiAutoNews, parseMiitAutoNews, parseNioNewsLinks, parseOnvoNews } from './pilot-collectors.mjs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chinaDate, writeJson } from './content-utils.mjs';
import { collectExtraOfficialSources } from './extra-official-collectors.mjs';
import { collectGalaxyNews, collectTeslaBlog } from './official-fetch-collectors.mjs';
import { collectOfficialSocial } from './social-collector.mjs';
import { sourceRegistry } from '../data/sources.js';

const pilots = [
  { url: 'https://www.lixiang.com/news.html', parse: parseLiAutoNews },
  { url: 'https://www.avatr.com/newscenter', parse: parseAvatrNews },
  { url: 'https://www.onvo.cn/about', parse: parseOnvoNews },
  { url: 'https://www.miit.gov.cn/zwgk/', parse: parseMiitAutoNews },
  { url: 'https://www.nio.com/news', collect: async () => parseNioNewsLinks(await collectBrowserLinks('https://www.nio.com/news', '/news/')) }
];

const attempts = await Promise.allSettled(pilots.map(async pilot => {
  if (pilot.collect) return pilot.collect();
  return pilot.parse(await collectBrowserHtml(pilot.url));
}));
const extra = await collectExtraOfficialSources();
const [tesla, galaxy] = await Promise.all([collectTeslaBlog(), collectGalaxyNews()]);
const social = await collectOfficialSocial();

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 45);
const cutoffDate = chinaDate(cutoff);
const outputDir = new URL('../runtime/', import.meta.url);
const outputFile = new URL('candidates.json', outputDir);
const previous = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, 'utf8')).candidates : [];
const freshCandidates = [...attempts.flatMap(result => result.status === 'fulfilled' ? result.value : []), ...extra.candidates, ...tesla.candidates, ...galaxy.candidates, ...social.candidates];
const candidates = [...new Map([...previous, ...freshCandidates]
  .filter(candidate => candidate.publishedAt >= cutoffDate && candidate.publishedAt <= chinaDate())
  .map(candidate => [candidate.url, candidate])).values()];
const failedSources = attempts.flatMap((result, index) => result.status === 'rejected' ? [{ url: pilots[index].url, reason: result.reason.message }] : []);
const sourceResults = [...attempts.map((result, index) => ({
  url: pilots[index].url,
  sourceId: sourceRegistry.find(source => source.url === pilots[index].url)?.id,
  status: result.status === 'rejected' ? 'error' : result.value.length ? 'ok' : 'empty',
  count: result.status === 'fulfilled' ? result.value.length : 0,
  latestPublishedAt: result.status === 'fulfilled' ? result.value.map(item => item.publishedAt).sort().at(-1) || null : null,
  reason: result.status === 'rejected' ? result.reason.message : result.value.length ? null : '未读到列表条目，尚不能判断当天是否无更新'
})), ...extra.sourceResults, ...tesla.sourceResults, ...galaxy.sourceResults, ...social.sourceResults];
mkdirSync(outputDir, { recursive: true });
writeJson(outputFile, {
  collectedAt: new Date().toISOString(),
  cutoffDate,
  candidates,
  failedSources, sourceResults
});

console.log(JSON.stringify({
  collectedAt: new Date().toISOString(),
  cutoffDate,
  candidateCount: candidates.length,
  sourceResults
}, null, 2));
