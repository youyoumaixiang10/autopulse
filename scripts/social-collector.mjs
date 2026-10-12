import { ajaxListToItems, fetchAjaxTimeline, fetchMobileTimeline, mintWeiboVisitor, mobileCardsToItems } from './weibo-public.mjs';

export const officialSocialAccounts = [
  { sourceId: 'li-auto-weibo', sourceName: '理想汽车官方微博', name: '理想汽车', uid: '6001272153', url: 'https://www.weibo.com/lixiangzhizao' },
  { sourceId: 'denza-weibo', sourceName: '腾势汽车官方微博', name: '腾势汽车', uid: '2664689831', url: 'https://weibo.com/2664689831' },
  { sourceId: 'byd-weibo', sourceName: '比亚迪汽车官方微博', name: '比亚迪汽车', uid: '1746221281', url: 'https://weibo.com/bydauto' },
  { sourceId: 'leapmotor-weibo', sourceName: '零跑汽车官方微博', name: '零跑汽车', uid: '5872290888', url: 'https://www.weibo.com/u/5872290888' },
  { sourceId: 'nio-weibo', sourceName: '蔚来官方微博', name: '蔚来', uid: '5675889356', url: 'https://weibo.com/nextevofficial' },
  { sourceId: 'onvo-weibo', sourceName: '乐道汽车官方微博', name: '乐道汽车', uid: '7892483716', url: 'https://weibo.com/u/7892483716' },
  { sourceId: 'xiaomi-auto-weibo', sourceName: '小米汽车官方微博', name: '小米汽车', uid: '7871239944', url: 'https://weibo.com/u/7871239944' },
  { sourceId: 'xpeng-weibo', sourceName: '小鹏汽车官方微博', name: '小鹏汽车', uid: '5710264970', url: 'https://weibo.com/u/5710264970' },
  { sourceId: 'voyah-weibo', sourceName: '岚图汽车官方微博', name: '岚图汽车', uid: '7351024207', url: 'https://weibo.com/u/7351024207' },
  { sourceId: 'avatr-weibo', sourceName: '阿维塔官方微博', name: '阿维塔', uid: '7714083748', url: 'https://www.weibo.com/avatr' },
  { sourceId: 'deepal-weibo', sourceName: '深蓝汽车官方微博', name: '深蓝汽车', uid: '7751244203', url: 'https://weibo.com/7751244203' },
  { sourceId: 'tesla-weibo', sourceName: '特斯拉官方微博', name: '特斯拉', uid: '3615027564', url: 'https://www.weibo.com/teslaofficial' },
  { sourceId: 'zeekr-weibo', sourceName: '极氪官方微博', name: '极氪Zeekr', uid: '7576049404', url: 'https://weibo.com/u/7576049404' },
  { sourceId: 'galaxy-weibo', sourceName: '吉利银河官方微博', name: '吉利银河', uid: '7794864065', url: 'https://weibo.com/u/7794864065' },
  { sourceId: 'changan-qiyuan-weibo', sourceName: '长安启源官方微博', name: '长安启源', uid: '3194397971', url: 'https://weibo.com/u/3194397971' },
  { sourceId: 'hima-weibo', sourceName: '鸿蒙智行官方微博', name: '鸿蒙智行', uid: '3032210184', url: 'https://weibo.com/u/3032210184' }
];

export function parseOfficialSocialPosts(items, account) {
  const candidates = new Map();
  for (const item of items) {
    const match = item.date?.match(/^(20\d{2}-\d{2}-\d{2}) (\d{2}:\d{2})$/);
    if (!match || !item.blueVerified || item.author !== account.name || item.truncated || /(?:\.{3}|…)\s*展开\s*$/u.test(item.text || '')) continue;
    let url;
    try { url = new URL(item.url); } catch { continue; }
    if (url.protocol !== 'https:' || !['weibo.com', 'www.weibo.com'].includes(url.hostname)) continue;
    const post = url.pathname.match(/^\/(\d+)\/([A-Za-z0-9]+)$/);
    if (!post || post[1] !== account.uid) continue;
    const publishedTime = `${match[1]}T${match[2]}:00+08:00`;
    const timestamp = Date.parse(publishedTime);
    if (!Number.isFinite(timestamp) || new Date(timestamp + 8 * 3600000).toISOString().slice(0, 16) !== `${match[1]}T${match[2]}`) continue;
    const text = String(item.text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (!text) continue;
    candidates.set(url.href, {
      sourceId: account.sourceId, sourceName: account.sourceName, sourceType: 'official-social',
      title: text.split('\n').find(line => line.trim()).slice(0, 120),
      url: url.href, publishedAt: match[1], publishedTime,
      authorVerified: true, authorId: account.uid, authorName: account.name,
      verificationEvidence: '帖文发布者名称、UID、蓝V标识与指定官方账号一致',
      contentParagraphs: [text], contentComplete: true,
      contentScope: 'post-text',
      ...(item.quotedPost ? { postKind: 'repost', quotedPost: item.quotedPost } : {}),
      sourcePageUrl: account.url
    });
  }
  return [...candidates.values()];
}

const snapshotExpression = `JSON.stringify({
  url: location.href,
  accessLimit: document.body?.innerText.includes('仅对粉丝展示全部微博内容') ? 'followers-only' : null,
  items: Array.from(document.querySelectorAll('article')).map(article => {
    const header = article.querySelector('header');
    const time = Array.from(header?.querySelectorAll('a[title]') || []).find(a => /^\\d{4}-\\d{2}-\\d{2} /.test(a.title));
    const content = article.querySelector('.wbpro-feed-ogText');
    const quote = article.querySelector('.retweet');
    const quoteContent = quote?.querySelector('.wbpro-feed-reText [class*="_wbtext_"]');
    const quoteAuthor = quote?.querySelector('a[usercard]');
    const quoteTime = Array.from(quote?.querySelectorAll('a[title]') || []).find(a => /^\\d{4}-\\d{2}-\\d{2} /.test(a.title));
    const clean = node => node ? (node.querySelector('.collapse') ? node.innerText.replace(/收起\\s*$/, '') : node.innerText).trim() : '';
    return {
      url: time?.href, date: time?.title,
      author: header?.querySelector('a[aria-label]')?.getAttribute('aria-label'),
      blueVerified: !!header?.querySelector('.woo-icon--vblue'),
      text: clean(content),
      truncated: Array.from(content?.querySelectorAll('a,span') || []).some(e => e.innerText.trim() === '展开'),
      quotedPost: quote ? {
        authorName: quoteAuthor?.innerText.replace(/^@/, ''), authorId: quoteAuthor?.getAttribute('usercard'),
        platformVerified: !!quote.querySelector('.woo-icon--vblue'),
        url: quoteTime?.href, publishedTime: quoteTime?.title,
        text: clean(quoteContent), contentComplete: !!quoteContent && !quoteContent.querySelector('.expand')
      } : null
    };
  })
})`;

const expandExpression = `(() => {
  const buttons = Array.from(document.querySelectorAll('article .wbpro-feed-ogText .expand, article .wbpro-feed-reText .expand')).filter(e => e.innerText.trim() === '展开');
  buttons.forEach(button => button.click());
  return buttons.length;
})()`;
const scrollScreens = Math.max(3, Math.min(18, Number(process.env.SOCIAL_SCROLL_SCREENS) || 3));
const initialReadAttempts = Math.max(3, Math.min(20, Number(process.env.SOCIAL_INITIAL_READ_ATTEMPTS) || 6));

async function proxy(path, body) {
  const response = await fetch(`http://localhost:3456${path}`, {
    ...(body === undefined ? {} : { method: 'POST', body }), signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `浏览器读取返回 ${response.status}`);
  return result;
}

export function isTransientNavigationError(error) {
  return /Execution context was destroyed|Cannot find context with specified id|navigation/iu.test(error?.message || '');
}

async function evaluateAfterNavigation(targetId, expression) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await proxy(`/eval?target=${targetId}`, expression); }
    catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

async function collectAccount(account) {
  const collectedAt = new Date().toISOString();
  let targetId;
  try {
    ({ targetId } = await proxy('/new', account.url));
    if (!targetId) throw new Error('未能创建官方微博读取页面');
    let snapshot;
    for (let attempt = 0; attempt < initialReadAttempts; attempt++) {
      const { value } = await evaluateAfterNavigation(targetId, snapshotExpression);
      snapshot = typeof value === 'string' ? JSON.parse(value) : value;
      if (snapshot?.items?.length) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!snapshot?.items?.length) throw new Error('当前浏览器未读到官方帖文；可能需要登录或页面未加载');
    const readExpanded = async () => {
      const { value: clicked } = await evaluateAfterNavigation(targetId, expandExpression);
      let result;
      for (let attempt = 0; attempt < (clicked ? 10 : 1); attempt++) {
        if (clicked) await new Promise(resolve => setTimeout(resolve, 500));
        const { value } = await evaluateAfterNavigation(targetId, snapshotExpression);
        result = typeof value === 'string' ? JSON.parse(value) : value;
        if (!result?.items?.some(item => item.truncated || item.quotedPost?.contentComplete === false)) break;
      }
      return result;
    };
    snapshot = await readExpanded();
    const items = [...snapshot.items];
    let afterScroll = snapshot;
    for (let screen = 0; screen < scrollScreens; screen++) {
      const known = new Set(items.map(item => item.url).filter(Boolean));
      await proxy(`/scroll?target=${targetId}&direction=bottom`);
      afterScroll = await readExpanded();
      const nextItems = afterScroll?.items || [];
      items.push(...nextItems);
      if (!nextItems.some(item => item.url && !known.has(item.url))) break;
    }
    const candidates = parseOfficialSocialPosts(items, account);
    if (!candidates.length) throw new Error('可见帖文未通过账号、蓝V、日期或完整正文校验');
    return {
      candidates,
      sourceResult: {
        sourceId: account.sourceId, status: 'partial', collectedAt, candidateCount: candidates.length,
        entryUrl: account.url, authorVerified: true,
        accessLimit: snapshot.accessLimit || afterScroll?.accessLimit || null,
        reason: snapshot.accessLimit === 'followers-only' || afterScroll?.accessLimit === 'followers-only'
          ? '已读取可见原帖；账号设置仅向粉丝展示全部微博，当前采集不能覆盖全部发布。'
          : '已读取主页多屏可见原帖及精确时间；主页仍存在置顶和分页限制，不能据此认定已覆盖全天全部发布。'
      }
    };
  } catch (error) {
    return { candidates: [], sourceResult: { sourceId: account.sourceId, status: 'failed', collectedAt, candidateCount: 0, entryUrl: account.url, reason: error.message } };
  } finally {
    if (targetId) await proxy(`/close?target=${targetId}`).catch(() => {});
  }
}

function degradedResult(account, reason) {
  return {
    candidates: [],
    sourceResult: {
      sourceId: account.sourceId, status: 'degraded', collectedAt: new Date().toISOString(), candidateCount: 0,
      entryUrl: account.url, publicLabel: '公开时间线暂不可读 · 可选配置 WEIBO_COOKIE，不阻断发布', reason
    }
  };
}

async function collectAccountWithoutBrowser(account, visitorCookie, ownerCookie, fetchImpl) {
  const attempts = [];
  if (visitorCookie) {
    try {
      const cards = await fetchMobileTimeline(account, visitorCookie, fetchImpl);
      const posts = parseOfficialSocialPosts(mobileCardsToItems(cards, account), account);
      if (posts.length) return { posts, mode: 'visitor' };
      attempts.push('访客会话未读到通过校验的原帖');
    } catch (error) { attempts.push(error.message); }
  } else attempts.push('访客会话未签发');
  if (ownerCookie) {
    try {
      const list = await fetchAjaxTimeline(account, ownerCookie, fetchImpl);
      const posts = parseOfficialSocialPosts(ajaxListToItems(list, account), account);
      if (posts.length) return { posts, mode: 'cookie' };
      attempts.push('WEIBO_COOKIE 未读到通过校验的原帖');
    } catch (error) { attempts.push(error.message); }
  }
  throw new Error(attempts.join('；'));
}

export async function collectOfficialSocial({ fetchImpl = fetch } = {}) {
  const candidates = [];
  const sourceResults = [];
  if (process.env.WEIBO_USE_BROWSER === '1') {
    for (const account of officialSocialAccounts) {
      const result = await collectAccount(account);
      candidates.push(...result.candidates);
      sourceResults.push(result.sourceResult);
    }
    return { candidates, sourceResults };
  }
  let visitorCookie = '';
  try { visitorCookie = await mintWeiboVisitor(fetchImpl); } catch { visitorCookie = ''; }
  const ownerCookie = process.env.WEIBO_COOKIE || '';
  for (const account of officialSocialAccounts) {
    try {
      const { posts, mode } = await collectAccountWithoutBrowser(account, visitorCookie, ownerCookie, fetchImpl);
      candidates.push(...posts);
      sourceResults.push({
        sourceId: account.sourceId, status: 'partial', collectedAt: new Date().toISOString(), candidateCount: posts.length,
        entryUrl: account.url, authorVerified: true, accessMode: mode,
        publicLabel: `已读 ${posts.length} 条公开原帖`,
        reason: '已读取公开时间线中通过账号、蓝V与绝对时间校验的原帖；不代表覆盖全部发布。'
      });
    } catch (error) {
      const result = degradedResult(account, error.message);
      sourceResults.push(result.sourceResult);
    }
  }
  return { candidates, sourceResults };
}
