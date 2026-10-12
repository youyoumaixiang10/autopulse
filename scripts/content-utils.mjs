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
  ['小米', /小米|雷军/u], ['小鹏', /小鹏|何小鹏|\bXPeng\b/iu], ['岚图', /岚图/u], ['阿维塔', /阿维塔|\bAVATR\b/iu], ['深蓝', /深蓝/u],
  ['腾势', /腾势/u], ['吉利银河', /吉利银河|银河(?:\s*[A-Z]\d|TT|星|战舰)/iu], ['特斯拉', /特斯拉|Tesla|Cybercab/iu], ['启源', /启源/u]
];
const outsideMakers = [
  ['奇瑞', /奇瑞/u], ['长城', /长城汽车|哈弗|魏牌|坦克/u], ['上汽', /上汽集团|上汽大众|荣威/u],
  ['广汽', /广汽|埃安|传祺|昊铂/u], ['一汽', /一汽|红旗|奔腾/u], ['宝马', /宝马/u], ['奔驰', /奔驰/u],
  ['大众', /大众/u], ['丰田', /丰田|雷克萨斯/u], ['本田', /本田/u], ['哪吒', /哪吒/u], ['极狐', /极狐/u]
];
const rankingCue = /批发|销量|排名|上险|出口|交付量/u;
function earliest(text, list) {
  let best = null;
  for (const [name, pattern] of list) {
    const match = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`).exec(text);
    if (match && (!best || match.index < best.index)) best = { name, index: match.index };
  }
  return best;
}
const makerLexicon = [
  ['上汽大众', /上汽大众/u], ['一汽大众', /一汽[-·\s]?大众/u],
  ['吉利银河', /吉利银河|银河(?:\s*[A-Za-z]\d|TT|星舰|战舰)/iu],
  ['鸿蒙智行', /鸿蒙智行|问界|智界|享界|尊界|尚界/u],
  ['比亚迪', /比亚迪|方程豹|仰望|海洋网/u], ['零跑', /零跑/u], ['蔚来', /蔚来|\bNIO\b/iu],
  ['乐道', /乐道|\bONVO\b/iu], ['理想', /理想(?:汽车|\s*[iIL]\d|\s*MEGA)|李想|\bLi Auto\b/iu],
  ['极氪', /极氪|\bZEEKR\b/iu], ['小米', /小米|雷军/u], ['小鹏', /小鹏|何小鹏|\bXPeng\b/iu],
  ['岚图', /岚图/u], ['阿维塔', /阿维塔|\bAVATR\b/iu], ['深蓝', /深蓝/u], ['腾势', /腾势/u],
  ['特斯拉', /特斯拉|Tesla|Cybercab/iu], ['启源', /启源/u],
  ['奇瑞', /奇瑞|星途/u], ['捷途', /捷途/u], ['长城', /长城汽车|哈弗|魏牌|坦克/u],
  ['上汽', /上汽集团|荣威|名爵/u], ['广汽', /广汽|埃安|传祺|昊铂/u], ['一汽', /一汽|红旗|奔腾/u],
  ['东风', /东风|风行/u], ['远程', /远程星享|吉利远程|远程汽车/u], ['宝马', /宝马|\bBMW\b/iu],
  ['奔驰', /奔驰/u], ['大众', /大众/u], ['丰田', /丰田|雷克萨斯/u], ['本田', /本田/u],
  ['林肯', /林肯/u], ['别克', /别克/u], ['凯迪拉克', /凯迪拉克/u], ['智己', /智己/u],
  ['赛力斯', /赛力斯/u], ['哪吒', /哪吒/u], ['极狐', /极狐/u], ['吉利', /吉利/u],
  ['smart', /smart/iu], ['极星', /极星|Polestar/iu]
];
export const identifyBrands = text => matchers.filter(([, pattern]) => pattern.test(text)).map(([brand]) => brand);
export function mentionedMakers(text) {
  const source = cleanText(text);
  const found = [];
  for (const [name, pattern] of makerLexicon) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of source.matchAll(new RegExp(pattern.source, flags))) {
      found.push({ name, start: match.index, end: match.index + match[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const item of found) {
    if (kept.some(other => item.start < other.end && item.end > other.start)) continue;
    kept.push(item);
  }
  return [...new Set(kept.map(item => item.name))];
}
export function outsideRankingLeads(text) {
  const head = cleanText(text);
  if (!rankingCue.test(head)) return false;
  const outside = earliest(head, outsideMakers);
  if (!outside) return false;
  const focus = earliest(head, matchers);
  return !focus || outside.index < focus.index;
}
export function assignReportedBrands(source, detail) {
  if (source?.sourceType === 'official-social') return [...(source.brands || [])];
  const title = cleanText(detail?.title || '');
  const paragraphs = detail?.contentParagraphs || [];
  const head = cleanText(`${title} ${paragraphs[0] || ''}`);
  if (outsideRankingLeads(head)) return [];
  const matched = identifyBrands([title, ...paragraphs.slice(0, 2)].join(' '));
  if (source?.sourceType === 'vertical-media') return matched;
  return matched.length ? matched : [...(source?.brands || [])].slice(0, 1);
}
export function resolveStoryBrands(article) {
  if (article?.sourceType === 'official-social') return [...(article.brands || [])];
  const paragraphs = article?.contentParagraphs || [];
  const head = cleanText(`${article?.title || ''} ${paragraphs[0] || ''}`);
  if (outsideRankingLeads(head)) return [];
  const matched = identifyBrands([article?.title, ...paragraphs.slice(0, 2)].join(' '));
  if (article?.sourceType === 'vertical-media') return matched;
  if (!(article?.brands || []).length && matched.length) return matched;
  return [...(article?.brands || [])];
}
export const isIndustryNews = text => /政策|工信部|国务院|商务部|发改委|市场监管|中汽协|乘联|车展|关税|反补贴|召回|行业|产业链|动力电池|汽车.*(?:出口|补贴|销量|标准|数据)|充电(?:桩|网)|换电(?:站|网)/u.test(text);
