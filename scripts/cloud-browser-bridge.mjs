import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const port = Number(process.env.BROWSER_BRIDGE_PORT || 3456);
const pages = new Map();
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });

function bodyOf(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
function reply(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
function watchClient(response) {
  let cancelled = false;
  let onClose;
  const done = new Promise(resolve => {
    onClose = () => {
      if (!response.writableEnded) {
        cancelled = true;
        resolve();
      }
    };
    response.on('close', onClose);
  });
  return {
    done,
    isCancelled: () => cancelled,
    stop() { response.off('close', onClose); }
  };
}
async function releasePage(targetId, page) {
  pages.delete(targetId);
  await page.close().catch(() => {});
}
async function openPage(url, response) {
  const page = await browser.newPage();
  const targetId = randomUUID();
  pages.set(targetId, page);
  const client = watchClient(response);
  try {
    await Promise.race([
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
      client.done.then(() => Promise.reject(new Error('客户端已取消')))
    ]);
  } catch (error) {
    if (client.isCancelled() || error?.message === '客户端已取消') {
      client.stop();
      await releasePage(targetId, page);
      throw new Error('客户端已取消');
    }
  }
  client.stop();
  if (client.isCancelled()) {
    await releasePage(targetId, page);
    throw new Error('客户端已取消');
  }
  return targetId;
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return reply(response, 200, { status: 'ok', connected: true, browser: { id: 'cloud-chromium', label: 'Cloud Chromium' }, sessions: pages.size });
    if (request.method === 'POST' && url.pathname === '/new') return reply(response, 200, { targetId: await openPage(await bodyOf(request), response) });
    const targetId = url.searchParams.get('target');
    const page = pages.get(targetId);
    if (!page) return reply(response, 404, { error: '浏览器页面不存在或已关闭' });
    if (request.method === 'POST' && url.pathname === '/eval') {
      const source = await bodyOf(request);
      const client = watchClient(response);
      try {
        const value = await Promise.race([
          page.evaluate(async code => await eval(code), source),
          client.done.then(() => Promise.reject(new Error('客户端已取消')))
        ]);
        client.stop();
        return reply(response, 200, { value });
      } catch (error) {
        client.stop();
        if (client.isCancelled() || error?.message === '客户端已取消') await releasePage(targetId, page);
        return reply(response, 500, { error: error.message });
      }
    }
    if (request.method === 'GET' && url.pathname === '/scroll') {
      const direction = url.searchParams.get('direction');
      const y = Number(url.searchParams.get('y')) || 0;
      await page.evaluate(({ direction: mode, y: offset }) => window.scrollTo(0, mode === 'bottom' ? document.body.scrollHeight : window.scrollY + offset), { direction, y });
      return reply(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/close') {
      pages.delete(targetId);
      await page.close();
      return reply(response, 200, { ok: true });
    }
    return reply(response, 404, { error: '未支持的浏览器桥接请求' });
  } catch (error) { return reply(response, 500, { error: error.message }); }
});
async function shutdown() {
  await Promise.allSettled([...pages.values()].map(page => page.close()));
  await browser.close();
  server.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.listen(port, '127.0.0.1', () => console.log(`云端浏览器桥接已启动：http://127.0.0.1:${port}`));
