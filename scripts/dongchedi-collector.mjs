const sourceId = 'dongchedi-news';
const sourceName = '懂车帝公开首页';
const entryUrl = 'https://www.dongchedi.com/';
import { collectBrowserHtml, fetchPageHtml } from './browser-collector.mjs';

const plainText = value => String(value || '')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function parseDongchediHome(html) {
  const raw = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) throw new Error('懂车帝首页缺少公开列表数据');
  const data = JSON.parse(raw);
  if (data.page === '/login-required') throw new Error('懂车帝要求登录，未读取资讯列表');
  const page = data.props?.pageProps;
  if (!page?.todayNews) throw new Error('懂车帝首页列表结构已变化');

  const titles = new Map();
  for (const item of [...(page.todayNews.head_article || []), ...(page.todayNews.content_article || [])]) {
    titles.set(item.gid_str, item.title);
  }
  for (const group of page.focusPic || []) {
    for (const item of group.pic_list || []) titles.set(item.group_id, item.title);
  }
  for (const car of page.newCarData || []) {
    const item = car.article_info;
    if (item?.gid && !titles.has(item.gid)) titles.set(item.gid, item.title_name);
  }

  const candidates = new Map();
  for (const link of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(link[1].replace(/&amp;/g, '&'), entryUrl); } catch { continue; }
    const match = url.pathname.match(/^\/(article|video)\/(\d+)\/?$/);
    if (!match || url.hostname !== 'www.dongchedi.com') continue;
    const title = plainText(titles.get(match[2]) || link[2]);
    if (!title) continue;
    url.hash = '';
    candidates.set(url.href, {
      sourceId, sourceName, sourceType: 'vertical-media', title, url: url.href,
      publishedAt: null, sourceMonth: null,
      contentFormat: match[1] === 'video' ? 'video' : 'article',
      verificationStatus: 'media-discovery', dateStatus: 'unconfirmed',
      discoveryUrl: entryUrl
    });
  }
  return [...candidates.values()];
}

async function loadDongchediHtml({ fetchImpl, browserImpl, httpImpl }) {
  if (fetchImpl) {
    const response = await fetchImpl(entryUrl, { signal: AbortSignal.timeout(35000) });
    if (!response.ok) throw new Error(`懂车帝首页返回 ${response.status}`);
    return response.text();
  }
  const browser = browserImpl || collectBrowserHtml;
  const http = httpImpl || fetchPageHtml;
  let browserError;
  try {
    const html = await browser(entryUrl);
    parseDongchediHome(html);
    return html;
  } catch (error) { browserError = error; }
  try {
    const html = await http(entryUrl);
    parseDongchediHome(html);
    return html;
  } catch (error) {
    throw new Error(`${browserError?.message || '浏览器读取失败'}；直接请求也失败：${error.message}`);
  }
}

export async function collectDongchediNews({ fetchImpl, browserImpl, httpImpl } = {}) {
  const collectedAt = new Date().toISOString();
  try {
    const html = await loadDongchediHtml({ fetchImpl, browserImpl, httpImpl });
    const candidates = parseDongchediHome(html);
    if (!candidates.length) throw new Error('懂车帝公开首页未解析到新闻链接');
    return {
      candidates,
      sourceResults: [{
        sourceId, status: 'partial', collectedAt, entryUrl, candidateCount: candidates.length,
        reason: '已读取公开首页推荐标题和原链接；资讯列表及正文当前要求登录，发布时间未核验，不代表完整日流。'
      }]
    };
  } catch (error) {
    return { candidates: [], sourceResults: [{ sourceId, status: 'failed', collectedAt, entryUrl, candidateCount: 0, reason: error.message }] };
  }
}
