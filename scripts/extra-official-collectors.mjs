const proxy = 'http://localhost:3456';

const plainText = value => String(value || '')
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();
const htmlParagraphs = value => String(value || '').split(/<\/(?:p|div)>|<br\s*\/?\s*>/i)
  .map(plainText).filter(Boolean);

function publishedDate(value) {
  const date = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

function unique(items) {
  return [...new Map(items.filter(Boolean).map(item => [item.url, item])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function parseBydRecords(records) {
  return unique(records.map(record => {
    const title = plainText(record.title);
    const publishedAt = publishedDate(record.date);
    if (!title || !publishedAt || !record.url) return null;
    const url = new URL(record.url, 'https://prod.byd.com');
    if (url.protocol !== 'https:' || url.hostname !== 'prod.byd.com') return null;
    const summary = plainText(record.description);
    return {
      sourceId: 'byd-news', sourceName: '比亚迪新闻中心', sourceType: 'official',
      title, publishedAt, url: url.href, ...(summary ? { summary } : {})
    };
  }));
}

export function parseDeepalRecords(records) {
  return unique(records.map(record => {
    const title = plainText(record.title);
    const publishedAt = publishedDate(record.publishTime);
    if (!title || /^nise\d+$/i.test(title) || !publishedAt || !/^\d+$/.test(String(record.id))) return null;
    const summary = plainText(record.brief);
    const contentParagraphs = htmlParagraphs(record.content);
    return {
      sourceId: 'deepal-news', sourceName: '深蓝汽车资讯', sourceType: 'official',
      title, publishedAt, url: `https://deepal.com.cn/policy?id=${record.id}`,
      ...(summary ? { summary } : {}), ...(contentParagraphs.length ? { contentParagraphs } : {})
    };
  }));
}

export function parseZeekrRecords(records) {
  return unique(records.map(record => {
    const title = plainText(record.newsTitle);
    const publishedAt = publishedDate(record.showTime);
    const newsId = String(record.newsId || '');
    const columnId = String(record.columnId || '');
    if (!title || !publishedAt || !/^\d+$/.test(newsId) || !/^\d+$/.test(columnId)) return null;
    const query = new URLSearchParams({ columnId, newsId });
    const contentParagraphs = htmlParagraphs(record.newsText);
    return {
      sourceId: 'zeekr-info', sourceName: '极氪官方新闻', sourceType: 'official',
      title, publishedAt, url: `https://www.zeekrlife.com/informationDetail?${query}`,
      ...(contentParagraphs.length ? { contentParagraphs } : {})
    };
  }));
}

function releaseDate(value) {
  const direct = publishedDate(value);
  if (direct) return direct;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
  return publishedDate(date);
}

export function parseLeapmotorRecords(records) {
  return unique(records.map(record => {
    const title = plainText(record.title);
    const publishedAt = releaseDate(record.releaseTime);
    const id = String(record.id || '');
    if (!title || !publishedAt || !id) return null;
    const url = new URL(`/news/news-detail.html?id=${encodeURIComponent(id)}`, 'https://leapmotor.cn');
    return {
      sourceId: 'leapmotor-news', sourceName: '零跑汽车资讯新闻', sourceType: 'official',
      title, publishedAt, url: url.href
    };
  }));
}

async function proxyRequest(path, body, timeoutMs = 45000) {
  const response = await fetch(`${proxy}${path}`, {
    ...(body === undefined ? {} : { method: 'POST', body }),
    signal: AbortSignal.timeout(Math.max(1, timeoutMs))
  });
  const result = await response.json();
  if (!response.ok || result.error || result.exceptionDetails) {
    throw new Error(result.error || result.exceptionDetails?.text || `浏览器读取失败：${response.status}`);
  }
  return result;
}

async function readInBrowser(url, expression, deadlineMs = 80_000) {
  const deadlineAt = Date.now() + deadlineMs;
  const left = () => deadlineAt - Date.now();
  const call = (path, body, cap) => {
    const timeout = Math.min(cap, left());
    if (timeout < 800) throw new Error('官网页面加载超时');
    return proxyRequest(path, body, timeout);
  };
  const { targetId } = await call('/new', url, 35_000);
  if (!targetId) throw new Error('浏览器未返回页面编号');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      if (left() < 2_000) break;
      const { value } = await call(`/eval?target=${targetId}`, 'JSON.stringify({url:location.href,ready:document.readyState})', 5_000);
      const state = JSON.parse(value);
      if (state.url.startsWith(new URL(url).origin) && state.ready !== 'loading') { ready = true; break; }
      const pause = Math.min(250, Math.max(0, left()));
      if (!pause) break;
      await new Promise(resolve => setTimeout(resolve, pause));
    }
    if (!ready) throw new Error('官网页面加载超时');
    const { value } = await call(`/eval?target=${targetId}`, expression, Math.min(45_000, left()));
    const result = typeof value === 'string' ? JSON.parse(value) : value;
    if (!result || !Array.isArray(result.records) || !result.records.length) throw new Error('未读到官方新闻列表');
    return result;
  } finally {
    await proxyRequest(`/close?target=${targetId}`).catch(() => {});
  }
}

// esSearch is the public news page's own request function. Read every returned page.
const bydExpression = `(async () => {
  const { esSearch } = await import('/static_material/byd/cn_esm/esmodule_template/utils.js');
  const records = [];
  let total = 0, page = 1;
  do {
    const response = await esSearch({ page, size: 50, type: 'news', sortField: 'date', year: '' });
    if (response.code !== 0 || !Array.isArray(response.data?.records)) throw new Error('比亚迪新闻接口未返回有效列表');
    total = Number(response.data.total);
    if (!Number.isFinite(total) || !response.data.records.length) throw new Error('比亚迪新闻分页未完整返回');
    records.push(...response.data.records.map(({ title, date, url, description }) => ({ title, date, url, description })));
    page++;
  } while (records.length < total);
  return JSON.stringify({ records, total, pageCount: page - 1 });
})()`;

// listWeb and its payload are used by the official 资讯 menu; /policy?id= was verified by clicking a card.
const deepalExpression = `(async () => {
  const records = [];
  let total = 0, page = 1;
  do {
    const response = await fetch('https://app-api.deepal.com.cn/appapi/v1/m_app/article/listWeb', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryName: '官网-新闻中心', page, size: 999 })
    });
    if (!response.ok) throw new Error('深蓝新闻接口读取失败：' + response.status);
    const result = await response.json();
    if (result.success !== true || !Array.isArray(result.data?.content)) throw new Error('深蓝新闻接口未返回有效列表');
    total = Number(result.data.totalElements);
    if (!Number.isFinite(total) || !result.data.content.length) throw new Error('深蓝新闻分页未完整返回');
    records.push(...result.data.content.map(({ id, title, publishTime, brief, content }) => ({ id, title, publishTime, brief, content })));
    page++;
  } while (records.length < total);
  return JSON.stringify({ records, total, pageCount: page - 1 });
})()`;

// The official news page reads a pinned list and a paginated list from this API.
// Details are requested only for newly published records, so an old archive does not
// create unnecessary traffic each day.
const zeekrExpression = `(async () => {
  const base = 'https://api-gw-toc.zeekrlife.com/zeekrlife-od-news';
  const columns = new URLSearchParams({ firstColumnName: '极氪PC官网', secondColumnName: '官方新闻' });
  const request = async path => {
    const response = await fetch(base + path);
    const result = await response.json();
    if (!response.ok || result.code !== 200) throw new Error('极氪新闻接口读取失败：' + response.status);
    return result.data;
  };
  const top = await request('/v1/open/news/top/list?' + columns);
  const first = await request('/v1/open/news/list?' + columns + '&page=1&pageSize=20');
  if (!Array.isArray(top) || !Array.isArray(first.list)) throw new Error('极氪新闻接口未返回有效列表');
  const records = [...top, ...first.list];
  const pages = Number(first.pages);
  if (!Number.isInteger(pages) || pages < 1) throw new Error('极氪新闻分页信息无效');
  for (let page = 2; page <= pages; page++) {
    const result = await request('/v1/open/news/list?' + columns + '&page=' + page + '&pageSize=20');
    if (!Array.isArray(result.list)) throw new Error('极氪新闻分页未完整返回');
    records.push(...result.list);
  }
  const unique = [...new Map(records.map(record => [record.columnId + ':' + record.newsId, record])).values()];
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cutoff = new Date(today + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const since = cutoff.toISOString().slice(0, 10);
  for (const record of unique.filter(record => record.showTime >= since && record.showTime <= today)) {
    const detail = await request('/toc/v1/open/news?' + new URLSearchParams({ columnId: record.columnId, newsId: record.newsId }));
    record.newsText = detail.newsText || '';
  }
  return JSON.stringify({ records: unique, total: unique.length, pageCount: pages });
})()`;

// This is the exact form request used by the public news page. If the provider is
// temporarily unavailable, the caller records a transparent partial source state
// instead of publishing an empty result as "no updates".
const leapmotorExpression = `(async () => {
  const records = [];
  let page = 1, isLastPage = false;
  while (!isLastPage) {
    const response = await fetch('/api/informationmaterial/select.do', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ pageNum: String(page), pageSize: String(page === 1 ? 11 : 12) }).toString()
    });
    if (!response.ok) throw new Error('零跑新闻接口读取失败：' + response.status);
    const result = await response.json();
    if (Number(result.errorCode) || !Array.isArray(result.data?.list)) throw new Error('零跑新闻接口未返回有效列表');
    if (!result.data.list.length) throw new Error('零跑新闻接口返回空列表');
    records.push(...result.data.list.map(({ id, title, releaseTime }) => ({ id, title, releaseTime })));
    isLastPage = result.data.isLastPage === true;
    page++;
    if (page > 100) throw new Error('零跑新闻分页超过合理范围');
  }
  return JSON.stringify({ records, total: records.length, pageCount: page - 1 });
})()`;

export async function collectExtraOfficialSources() {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const since = cutoff.toISOString().slice(0, 10);
  const collected = await Promise.all([
    { id: 'byd-news', url: 'https://prod.byd.com/cn/news', expression: bydExpression, parse: parseBydRecords },
    { id: 'deepal-news', url: 'https://deepal.com.cn/news', expression: deepalExpression, parse: parseDeepalRecords },
    { id: 'zeekr-info', url: 'https://www.zeekrlife.com/information', expression: zeekrExpression, parse: parseZeekrRecords },
    {
      id: 'leapmotor-news', url: 'https://leapmotor.cn/news/news.html', expression: leapmotorExpression,
      parse: parseLeapmotorRecords, softFailure: true,
      publicFailureLabel: '官网新闻列表暂不可读 · 官方微博仍持续采集'
    }
  ].map(async source => {
    try {
      const result = await readInBrowser(source.url, source.expression);
      const items = source.parse(result.records);
      if (items.length !== result.total) throw new Error(`有效新闻 ${items.length} 条，接口报告 ${result.total} 条，需检查列表字段或分页`);
      const recentCount = items.filter(item => item.publishedAt >= since && item.publishedAt <= today).length;
      return {
        candidates: items,
        sourceResult: {
          sourceId: source.id, url: source.url, checkedAt, status: recentCount ? 'collected' : 'no-recent-updates',
          listRead: true, itemCount: items.length, recentCount, latestPublishedAt: items[0].publishedAt,
          since, pageCount: result.pageCount
        }
      };
    } catch (error) {
      return {
        candidates: [],
        sourceResult: {
          sourceId: source.id, url: source.url, checkedAt, status: source.softFailure ? 'partial' : 'failed',
          listRead: false, candidateCount: 0, ...(source.publicFailureLabel ? { publicLabel: source.publicFailureLabel } : {}),
          error: error.message
        }
      };
    }
  }));
  console.log(`[daily] 官网列表耗时 ${Date.now() - started}ms`);
  return {
    candidates: collected.flatMap(result => result.candidates),
    sourceResults: collected.map(result => result.sourceResult)
  };
}
