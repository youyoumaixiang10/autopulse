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
async function openPage(url) {
  const page = await browser.newPage();
  const targetId = randomUUID();
  pages.set(targetId, page);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch { /* caller verifies readiness */ }
  return targetId;
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return reply(response, 200, { status: 'ok', connected: true, browser: { id: 'cloud-chromium', label: 'Cloud Chromium' }, sessions: pages.size });
    if (request.method === 'POST' && url.pathname === '/new') return reply(response, 200, { targetId: await openPage(await bodyOf(request)) });
    const targetId = url.searchParams.get('target');
    const page = pages.get(targetId);
    if (!page) return reply(response, 404, { error: '浏览器页面不存在或已关闭' });
    if (request.method === 'POST' && url.pathname === '/eval') return reply(response, 200, { value: await page.evaluate(async source => await eval(source), await bodyOf(request)) });
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
