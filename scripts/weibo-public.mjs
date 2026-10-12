const mobileUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

export function weiboAbsoluteTime(createdAt) {
  const match = String(createdAt || '').match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):\d{2} \+0800 (\d{4})$/u);
  if (!match || !months[match[1]]) return '';
  const date = `${match[5]}-${months[match[1]]}-${match[2].padStart(2, '0')}`;
  const parsed = new Date(`${date}T${match[3]}:${match[4]}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) return '';
  return `${date} ${match[3]}:${match[4]}`;
}

export function weiboPlainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;|&#160;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\u200b/gu, '')
    .trim();
}

export function isWeiboBlueV(user) {
  return user?.verified === true && [1, 2, 3, 4, 5, 6, 7].includes(Number(user.verified_type));
}

function postItem(account, status, text) {
  const mblogid = status?.mblogid || status?.bid;
  const date = weiboAbsoluteTime(status?.created_at);
  if (!mblogid || !date || !text) return null;
  const quoted = status?.retweeted_status;
  return {
    url: `https://weibo.com/${account.uid}/${mblogid}`,
    date,
    author: status.user?.screen_name,
    blueVerified: isWeiboBlueV(status.user),
    text,
    truncated: false,
    ...(quoted ? {
      quotedPost: {
        authorName: quoted.user?.screen_name || '',
        authorId: String(quoted.user?.id || ''),
        platformVerified: isWeiboBlueV(quoted.user),
        url: quoted.mblogid ? `https://weibo.com/${quoted.user?.id}/${quoted.mblogid}` : '',
        publishedTime: weiboAbsoluteTime(quoted.created_at),
        text: weiboPlainText(quoted.text_raw || quoted.text),
        contentComplete: !quoted.isLongText
      }
    } : {})
  };
}

export function mobileCardsToItems(cards, account) {
  return (cards || []).map(card => {
    const status = card?.mblog || card;
    if (!status) return null;
    const text = weiboPlainText(status.longTextContent || status.text);
    if (status.isLongText && !status.longTextContent) return null;
    return postItem(account, status, text);
  }).filter(Boolean);
}

export function ajaxListToItems(list, account) {
  return (list || []).map(status => postItem(account, status, weiboPlainText(status?.text_raw || status?.longText?.longTextContent || status?.text))).filter(Boolean);
}

function absorbCookies(jar, response) {
  for (const cookie of response.headers.getSetCookie?.() || []) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

export function xsrfFromCookie(cookie) {
  return String(cookie || '').match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/u)?.[1] || '';
}

export async function mintWeiboVisitor(fetchImpl = fetch) {
  const jar = new Map();
  const headers = { 'user-agent': mobileUa, accept: '*/*' };
  const gen = await fetchImpl('https://passport.weibo.com/visitor/genvisitor?cb=cb', { headers, signal: AbortSignal.timeout(15000) });
  absorbCookies(jar, gen);
  const tid = (await gen.text()).match(/"tid":"([^"]+)"/u)?.[1];
  if (!gen.ok || !tid) throw new Error('微博访客会话未签发');
  const cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  const incarnate = await fetchImpl(`https://passport.weibo.com/visitor/visitor?a=incarnate&t=${encodeURIComponent(tid)}&w=2&c=095&gc=&cb=cross_domain&from=weibo`, {
    headers: { ...headers, cookie }, signal: AbortSignal.timeout(15000)
  });
  absorbCookies(jar, incarnate);
  const body = await incarnate.text();
  const payload = body.match(/"sub":"([^"]+)"[\s\S]*?"subp":"([^"]+)"/u);
  if (!incarnate.ok || !payload) throw new Error('微博访客身份未完成');
  jar.set('SUB', payload[1]);
  jar.set('SUBP', payload[2]);
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

export async function fetchMobileTimeline(account, cookie, fetchImpl = fetch) {
  const response = await fetchImpl(`https://m.weibo.cn/api/container/getIndex?type=uid&value=${account.uid}&containerid=107603${account.uid}`, {
    headers: {
      'user-agent': mobileUa, cookie, accept: 'application/json, text/plain, */*',
      referer: `https://m.weibo.cn/u/${account.uid}`, 'x-requested-with': 'XMLHttpRequest'
    },
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== 1 || !Array.isArray(payload.data?.cards)) throw new Error('微博公开时间线未返回帖文');
  return payload.data.cards;
}

export async function fetchAjaxTimeline(account, cookie, fetchImpl = fetch) {
  const response = await fetchImpl(`https://weibo.com/ajax/statuses/mymblog?uid=${account.uid}&page=1&feature=0`, {
    headers: {
      'user-agent': desktopUa, cookie, accept: 'application/json, text/plain, */*',
      referer: `https://weibo.com/u/${account.uid}`, 'x-requested-with': 'XMLHttpRequest',
      'x-xsrf-token': xsrfFromCookie(cookie)
    },
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== 1 || !Array.isArray(payload.data?.list)) throw new Error('微博登录态时间线未返回帖文');
  return payload.data.list;
}
