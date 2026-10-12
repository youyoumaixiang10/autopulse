import { load } from 'cheerio';
import { chinaDate, cleanText, fetchHtml } from './content-utils.mjs';

const englishMonths = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function isoDate(year, month, day) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

function plainText(value) {
  return cleanText(String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

export function parseTeslaBlog(html) {
  const $ = load(html);
  const items = [];
  $('.tcl-article-teaser').each((_, element) => {
    const node = $(element);
    const title = cleanText(node.find('.tcl-article-teaser__heading').first().text());
    const href = node.find('a[href*="/blog/"]').attr('href') || '';
    const summary = cleanText(node.find('.tcl-article-teaser__article-summary p').first().text());
    const dateText = cleanText(node.find('.tcl-article-teaser__published-date').first().text());
    const chinese = dateText.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
    const english = dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})/u);
    const publishedAt = chinese ? isoDate(chinese[1], chinese[2], chinese[3])
      : english && englishMonths[english[1].toLowerCase()] ? isoDate(english[3], englishMonths[english[1].toLowerCase()], english[2])
        : null;
    let url;
    try { url = new URL(href, 'https://www.tesla.cn'); } catch { return; }
    if (!title || !publishedAt || url.protocol !== 'https:' || url.hostname !== 'www.tesla.cn' || !url.pathname.startsWith('/blog/')) return;
    url.search = '';
    url.hash = '';
    items.push({
      sourceId: 'tesla-home', sourceName: '特斯拉中国官网', sourceType: 'official',
      title, publishedAt, url: url.href,
      ...(summary ? { summary, contentParagraphs: [summary] } : {})
    });
  });
  return [...new Map(items.map(item => [item.url, item])).values()];
}

export function parseGalaxyNewsRecords(payload) {
  const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  const items = [];
  for (const record of list) {
    const title = plainText(record.NewsTitle);
    const summary = plainText(record.NewsSummary);
    const publishedAt = isoDate(...String(record.NewsDate || '').match(/^(20\d{2})-(\d{2})-(\d{2})/u)?.slice(1) || []);
    if (!title || !publishedAt || !/银河/u.test(`${title} ${summary}`)) continue;
    let url;
    try { url = new URL(record.Url, 'https://galaxy.geely.com'); } catch { continue; }
    if (url.protocol !== 'https:' || !['galaxy.geely.com', 'www.geely.com'].includes(url.hostname)) continue;
    if (url.pathname.includes('/sitecore/')) continue;
    url.search = '';
    url.hash = '';
    items.push({
      sourceId: 'galaxy-official', sourceName: '吉利银河官网', sourceType: 'official',
      title, publishedAt, url: url.href,
      ...(summary ? { summary, contentParagraphs: [summary] } : {})
    });
  }
  return items;
}

function daysAgo(today, days) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

export async function collectTeslaBlog({ fetchHtmlImpl = fetchHtml, today = chinaDate() } = {}) {
  const checkedAt = new Date().toISOString();
  try {
    const items = parseTeslaBlog(await fetchHtmlImpl('https://www.tesla.cn/blog'));
    if (!items.length) throw new Error('特斯拉博客列表未解析到文章');
    const since = daysAgo(today, 45);
    const recent = items.filter(item => item.publishedAt >= since && item.publishedAt <= today);
    const latestPublishedAt = items.map(item => item.publishedAt).sort().at(-1) || null;
    return {
      candidates: recent,
      sourceResults: [{
        sourceId: 'tesla-home', url: 'https://www.tesla.cn/blog', checkedAt, listRead: true,
        status: recent.length ? 'ok' : 'no-recent-updates',
        candidateCount: recent.length, latestPublishedAt,
        publicLabel: recent.length ? `已读 ${recent.length} 条` : `列表可读 · 最近发布 ${latestPublishedAt}`
      }]
    };
  } catch (error) {
    return {
      candidates: [],
      sourceResults: [{
        sourceId: 'tesla-home', url: 'https://www.tesla.cn/blog', checkedAt, listRead: false,
        status: 'partial', candidateCount: 0, publicLabel: '官网博客暂不可读', error: error.message
      }]
    };
  }
}

export async function collectGalaxyNews({ fetchImpl = fetch, today = chinaDate() } = {}) {
  const checkedAt = new Date().toISOString();
  const url = 'https://galaxy.geely.com/api/geely/official/News/getNews';
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', referer: 'https://galaxy.geely.com/news' },
      body: JSON.stringify({ Size: 20, Page: 0, Search: { KeyWords: '', IsNew: false, NewsType: 0, InProgress: '', Brand: 'GEELY' } }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`银河新闻接口返回 ${response.status}`);
    const items = parseGalaxyNewsRecords(await response.json());
    const since = daysAgo(today, 45);
    const recent = items.filter(item => item.publishedAt >= since && item.publishedAt <= today);
    return {
      candidates: recent,
      sourceResults: [{
        sourceId: 'galaxy-official', url: 'https://galaxy.geely.com/news', checkedAt, listRead: true,
        status: recent.length ? 'ok' : 'partial', candidateCount: recent.length,
        publicLabel: recent.length ? `已读 ${recent.length} 条` : '新闻接口可读，但返回条目没有可公开访问的详情链接'
      }]
    };
  } catch (error) {
    return {
      candidates: [],
      sourceResults: [{
        sourceId: 'galaxy-official', url: 'https://galaxy.geely.com/news', checkedAt, listRead: false,
        status: 'partial', candidateCount: 0, publicLabel: '官网新闻接口暂不可读', error: error.message
      }]
    };
  }
}
