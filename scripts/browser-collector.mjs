import { lookup } from 'node:dns/promises';
import { get as httpsGet } from 'node:https';

async function createBrowserPage(url) {
  const created = await fetch('http://localhost:3456/new', { method: 'POST', body: url, signal: AbortSignal.timeout(35000) });
  const { targetId } = await created.json();
  if (!targetId) throw new Error('无法创建新闻读取页面');
  return targetId;
}

async function evaluate(targetId, expression, timeout = 25000) {
  const response = await fetch(`http://localhost:3456/eval?target=${targetId}`, { method: 'POST', body: expression, signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (result.error || !response.ok) throw new Error(result.error || '浏览器读取失败');
  return result.value;
}

async function closeBrowserPage(targetId) {
  await fetch(`http://localhost:3456/close?target=${targetId}`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
}

function requestHtml(url, address, redirectsLeft, sockets) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpsGet({
      host: address || target.hostname,
      servername: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: {
        host: target.hostname,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        accept: 'text/html'
      },
      timeout: 20000
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) { reject(new Error('页面重定向过多')); return; }
        resolve(requestHtml(new URL(response.headers.location, url).href, null, redirectsLeft - 1, sockets));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    sockets.push(request);
    request.on('timeout', () => request.destroy(new Error('连接超时')));
    request.on('error', reject);
  }).then(html => {
    if (typeof html === 'string') return html;
    if (html.status < 200 || html.status >= 300) throw new Error(`页面返回 ${html.status}`);
    if (!/<html[\s>]/i.test(html.body) && !/__NEXT_DATA__/i.test(html.body)) throw new Error('直接请求未返回可解析页面');
    return html.body;
  });
}

export async function fetchPageHtml(url, lookupImpl = lookup) {
  let addresses = [];
  try {
    addresses = (await lookupImpl(new URL(url).hostname, { all: true, family: 4 })).map(record => record.address);
  } catch { addresses = []; }
  const sockets = [];
  const attempts = (addresses.length ? [...new Set(addresses)] : [null]).map(address => requestHtml(url, address, 3, sockets));
  try { return await Promise.any(attempts); }
  catch (error) { throw error?.errors?.[0] || error; }
  finally { for (const socket of sockets) socket.destroy(); }
}

export async function readHtmlWithFallback(url, { accept, browser = collectBrowserHtml, http = fetchPageHtml } = {}) {
  let browserError;
  try {
    const html = await browser(url);
    if (!accept || accept(html)) return html;
    browserError = new Error('浏览器页面未包含可解析列表');
  } catch (error) { browserError = error; }
  try {
    const html = await http(url);
    if (!accept || accept(html)) return html;
    throw new Error('直接请求未包含可解析列表');
  } catch (error) {
    throw new Error(`${browserError?.message || '浏览器读取失败'}；直接请求也失败：${error.message}`);
  }
}

export async function collectBrowserHtml(url) {
  const targetId = await createBrowserPage(url);
  try {
    for (let attempt = 0; attempt < 28; attempt++) {
      const value = await evaluate(targetId, 'JSON.stringify({ ready: document.readyState, bodyLength: document.body?.innerText.length || 0 })');
      const state = typeof value === 'string' ? JSON.parse(value) : value;
      if (state.ready !== 'loading' && state.bodyLength) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const html = await evaluate(targetId, 'document.documentElement.outerHTML', 50000);
    if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) throw new Error('浏览器未返回可解析页面');
    return html;
  } finally {
    await closeBrowserPage(targetId);
  }
}

export async function collectBrowserLinks(url, pathPrefix) {
  const targetId = await createBrowserPage(url);
  try {
    const expression = `JSON.stringify(Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.innerText.trim() })).filter(item => item.href.includes(${JSON.stringify(pathPrefix)}) && item.text.length > 10))`;
    for (let attempt = 0; attempt < 16; attempt++) {
      const value = await evaluate(targetId, expression);
      const links = typeof value === 'string' ? JSON.parse(value) : value;
      if (Array.isArray(links) && links.length) return links;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('等待页面加载后仍未读到新闻列表');
  } finally {
    await closeBrowserPage(targetId);
  }
}
