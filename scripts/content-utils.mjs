import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const cleanText = text => String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
export const chinaDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const previousDate = date => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};
export const issueSearchDates = (now = new Date()) => {
  const current = chinaDate(now);
  return [previousDate(current), current];
};
export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function writeJson(file, data) {
  const path = file instanceof URL ? fileURLToPath(file) : resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporary, path);
}
export async function fetchHtml(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = response.headers.get('content-type') || '';
  const prefix = new TextDecoder().decode(bytes.slice(0, 2048));
  const encoding = (header.match(/charset=["']?([\w-]+)/i) || prefix.match(/charset=["']?([\w-]+)/i))?.[1] || 'utf-8';
  return new TextDecoder(/gbk|gb2312/i.test(encoding) ? 'gb18030' : encoding).decode(bytes);
}
export function safeUrl(value, base) {
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

const matchers = [
  ['鸿蒙智行', /鸿蒙智行|问界|智界|享界|尊界|尚界/u], ['比亚迪', /比亚迪|方程豹|仰望/u],
  ['零跑', /零跑/u], ['蔚来', /蔚来|\bNIO\b/iu], ['乐道', /乐道|\bONVO\b/iu],
  ['理想', /理想(?:汽车|\s*[iIL]\d|\s*MEGA)|李想|\bLi Auto\b/iu], ['极氪', /极氪|\bZEEKR\b/iu],
  ['小米', /小米|雷军/u], ['岚图', /岚图/u], ['阿维塔', /阿维塔|\bAVATR\b/iu], ['深蓝', /深蓝/u],
  ['腾势', /腾势/u], ['吉利银河', /吉利银河|银河(?:\s*[A-Z]\d|TT|星|战舰)/iu], ['特斯拉', /特斯拉|Tesla|Cybercab/iu], ['启源', /启源/u]
];
export const identifyBrands = text => matchers.filter(([, pattern]) => pattern.test(text)).map(([brand]) => brand);
export const isIndustryNews = text => /政策|工信部|国务院|商务部|发改委|市场监管|中汽协|乘联|车展|关税|反补贴|召回|行业|产业链|动力电池|汽车.*(?:出口|补贴|销量|标准|数据)|充电(?:桩|网)|换电(?:站|网)/u.test(text);
