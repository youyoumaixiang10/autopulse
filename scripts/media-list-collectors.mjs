import { load } from 'cheerio';
import { chinaDate, cleanText, fetchHtml } from './content-utils.mjs';
import { sourceRegistry } from '../data/sources.js';

const automotiveTitle = /汽车|新车|车展|上市|发布|交付|销量|订单|续航|换电|残值|工信部|蔚来|理想|小米|比亚迪|极氪|问界|鸿蒙|岚图|零跑|腾势|阿维塔|深蓝|银河|启源|乐道|特斯拉|智界|享界|尊界|尚界|方程豹|仰望/u;
const ithomeAutomotive = /汽车|新车|车展|车企|蔚来|理想汽车|理想\s*[iIL]\d|小米汽车|小米SU|比亚迪|极氪|问界|鸿蒙智行|岚图|零跑|腾势|阿维塔|深蓝|银河|启源|乐道|特斯拉|智界|享界|尊界|尚界|方程豹|仰望|换电|工信部|宁德时代|赛力斯/u;

export function withinDiscoveryWindow(date, today = chinaDate(), days = 10) {
  if (!date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date > today) return false;
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return date >= cutoff.toISOString().slice(0, 10);
}

function decodeBasic(value) {
  return cleanText(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&nbsp;|&#160;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>'));
}

function isoDate(year, month, day) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

function candidate(source, { title, url, discoveryPublishedAt = null }) {
  const text = decodeBasic(title);
  if (text.length < 6 || text.length > 160) return null;
  return {
    sourceId: source.id, sourceName: source.name, sourceType: 'vertical-media',
    title: text, url, publishedAt: null,
    ...(discoveryPublishedAt ? { discoveryPublishedAt } : {}),
    verificationStatus: 'media-discovery', dateStatus: discoveryPublishedAt ? 'list-date' : 'unconfirmed'
  };
}

function unique(items) {
  return [...new Map(items.filter(Boolean).map(item => [item.url, item])).values()];
}

function absoluteUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function anchors(html, base) {
  const $ = load(html);
  return $('a[href]').toArray().map(element => {
    const url = absoluteUrl($(element).attr('href'), base);
    const preferred = decodeBasic($(element).find('.letters-title, h1, h2, h3').first().text());
    const title = preferred || decodeBasic($(element).text());
    return url ? { url, title } : null;
  }).filter(Boolean);
}

export function parseSinaAutoList(html) {
  const source = { id: 'sina-auto', name: '新浪汽车' };
  return unique(anchors(html, 'https://auto.sina.com.cn/').map(({ url, title }) => {
    if (url.hostname !== 'auto.sina.com.cn' || !/\/detail-[a-z0-9]+\.shtml$/iu.test(url.pathname)) return null;
    const discoveryPublishedAt = isoDate(...(url.pathname.match(/\/(20\d{2})-(\d{2})-(\d{2})\//u) || []).slice(1));
    url.search = '';
    return candidate(source, { title, url: url.href, discoveryPublishedAt });
  }));
}

export function parseGasgooList(html) {
  const source = { id: 'gasgoo-auto', name: '盖世汽车' };
  return unique(anchors(html, 'https://auto.gasgoo.com/').map(({ url, title }) => {
    if (url.hostname !== 'auto.gasgoo.com') return null;
    const match = url.pathname.match(/\/news\/(20\d{2})(\d{2})\/(\d{2})/u);
    if (!match) return null;
    url.search = '';
    return candidate(source, { title, url: url.href, discoveryPublishedAt: isoDate(match[1], match[2], match[3]) });
  }));
}

export function parsePcautoList(html) {
  const source = { id: 'pcauto-news', name: '太平洋汽车' };
  return unique(anchors(html, 'https://www.pcauto.com.cn/').map(({ url, title }) => {
    if (url.hostname !== 'www.pcauto.com.cn' || !/^\/(?:nation|news)\/\d+\/\d+\.html$/u.test(url.pathname)) return null;
    url.search = '';
    return candidate(source, { title, url: url.href });
  }));
}

export function parseSohuAutoList(html) {
  const source = { id: 'sohu-auto', name: '搜狐汽车' };
  return unique(anchors(html, 'https://auto.sohu.com/').map(({ url, title }) => {
    if (url.hostname !== 'www.sohu.com' || !/^\/a\/\d+_\d+/u.test(url.pathname)) return null;
    if (!automotiveTitle.test(title)) return null;
    url.search = '';
    return candidate(source, { title, url: url.href });
  }));
}

export function parseNeteaseAutoList(html) {
  const source = { id: 'netease-auto', name: '网易汽车' };
  const found = [];
  const add = (href, title) => {
    const url = absoluteUrl(href, 'https://auto.163.com/');
    if (!url || url.hostname !== 'www.163.com' || !url.pathname.startsWith('/auto/article/')) return;
    url.search = '';
    found.push(candidate(source, { title, url: url.href }));
  };
  for (const match of html.matchAll(/data-title="([^"]{6,160})"[^>]*data-url="(https?:\/\/www\.163\.com\/auto\/article\/[^"]+)"/gu)) add(match[2], match[1]);
  for (const match of html.matchAll(/data-url="(https?:\/\/www\.163\.com\/auto\/article\/[^"]+)"[^>]*data-title="([^"]{6,160})"/gu)) add(match[1], match[2]);
  for (const item of anchors(html, 'https://auto.163.com/')) add(item.url.href, item.title);
  return unique(found);
}

export function parseIfengAutoList(html) {
  const source = { id: 'ifeng-auto', name: '凤凰网汽车' };
  const found = [];
  const pattern = /"title":"((?:\\.|[^"\\]){6,160})"[\s\S]{0,700}?"url":"(https?:\\?\/\\?\/auto\.ifeng\.com\\?\/c\\?\/[^"\\]+)"/gu;
  for (const match of html.matchAll(pattern)) {
    const title = decodeBasic(match[1].replace(/\\"/gu, '"').replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))));
    const href = match[2].replace(/\\\//gu, '/');
    const url = absoluteUrl(href, 'https://auto.ifeng.com/');
    if (!url || url.hostname !== 'auto.ifeng.com' || !/^\/c\/[A-Za-z0-9]+$/u.test(url.pathname)) continue;
    url.search = '';
    found.push(candidate(source, { title, url: url.href }));
  }
  return unique(found);
}

export function parseNews18aList(html) {
  const source = { id: 'news18a-auto', name: '网通社' };
  return unique(anchors(html, 'https://auto.news18a.com/').map(({ url, title }) => {
    if (!['auto.news18a.com', 'www.news18a.com'].includes(url.hostname) || !/^\/news\/storys_\d+\.html$/u.test(url.pathname)) return null;
    url.search = '';
    return candidate(source, { title, url: url.href });
  }));
}

export function parseIthomeRss(xml) {
  const source = { id: 'ithome-auto', name: 'IT之家' };
  const $ = load(xml, { xmlMode: true });
  return unique($('item').toArray().map(item => {
    const node = $(item);
    const title = decodeBasic(node.find('title').first().text());
    const description = decodeBasic(node.find('description').first().text());
    if (!ithomeAutomotive.test(`${title} ${description}`)) return null;
    const url = absoluteUrl(decodeBasic(node.find('link').first().text()), 'https://www.ithome.com/');
    if (!url || url.hostname !== 'www.ithome.com' || !/^\/\d+\/\d+\/\d+\.htm$/u.test(url.pathname)) return null;
    const published = Date.parse(node.find('pubDate').first().text());
    const discoveryPublishedAt = Number.isFinite(published)
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(published))
      : null;
    url.search = '';
    return candidate(source, { title, url: url.href, discoveryPublishedAt });
  }));
}

export function bingDestination(href) {
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (url.hostname.endsWith('bing.com')) {
      const encoded = url.searchParams.get('u') || '';
      const payload = encoded.replace(/^a1/u, '');
      if (payload) {
        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        if (/^https:\/\//u.test(decoded)) return decoded;
      }
      for (const key of ['url', 'r']) {
        const plain = url.searchParams.get(key) || '';
        if (/^https:\/\//u.test(plain)) return plain;
      }
      return '';
    }
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

export function parseBingSearchHtml(html) {
  const $ = load(html);
  const links = $('li.b_algo h2 a, .b_algo h2 a, #b_results h2 a').toArray();
  const found = [];
  for (const link of links) {
    const url = bingDestination($(link).attr('href') || '');
    const title = cleanText($(link).text());
    if (!url || !title) continue;
    found.push({ title, url });
  }
  return unique(found.map(item => ({ ...item, url: item.url.split('#')[0] })));
}

const directLists = [
  { id: 'sina-auto', url: 'https://auto.sina.com.cn/news/', parse: parseSinaAutoList },
  { id: 'gasgoo-auto', url: 'https://auto.gasgoo.com/auto-news/C-103-106-107-108-109-110-303-409-501-601', parse: parseGasgooList },
  { id: 'pcauto-news', url: 'https://www.pcauto.com.cn/nation/', parse: parsePcautoList },
  { id: 'sohu-auto', url: 'https://auto.sohu.com/', parse: parseSohuAutoList },
  { id: 'netease-auto', url: 'https://auto.163.com/', parse: parseNeteaseAutoList },
  { id: 'ifeng-auto', url: 'https://auto.ifeng.com/', parse: parseIfengAutoList },
  { id: 'news18a-auto', url: 'https://auto.news18a.com/', parse: parseNews18aList },
  { id: 'ithome-auto', url: 'https://www.ithome.com/rss/', parse: parseIthomeRss }
];

export async function collectMediaLists({ fetchHtmlImpl = fetchHtml, today = chinaDate() } = {}) {
  const names = new Map(sourceRegistry.map(source => [source.id, source.name]));
  const settled = await Promise.all(directLists.map(async source => {
    try {
      const html = await fetchHtmlImpl(source.url);
      const items = source.parse(html)
        .filter(item => withinDiscoveryWindow(item.discoveryPublishedAt, today))
        .slice(0, 30);
      return {
        items,
        sourceResult: {
          sourceId: source.id, url: source.url, listRead: true, candidateCount: items.length,
          status: items.length ? 'ok' : 'no-recent-updates',
          publicLabel: items.length ? `列表已读 ${items.length} 条待核验线索` : '列表已读，窗口内未解析到新闻链接'
        }
      };
    } catch (error) {
      return {
        items: [],
        sourceResult: {
          sourceId: source.id, url: source.url, listRead: false, candidateCount: 0, status: 'partial',
          publicLabel: '直连列表暂不可读，将回退公开检索', error: error.message, sourceName: names.get(source.id)
        }
      };
    }
  }));
  return {
    candidates: settled.flatMap(result => result.items),
    sourceResults: settled.map(result => result.sourceResult)
  };
}
