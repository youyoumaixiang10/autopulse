import { createHash } from 'node:crypto';
import { cleanText, readJson, writeJson } from './content-utils.mjs';
import { isOpenAiQuotaError } from './daily-run-gate.mjs';

const dir = new URL('../runtime/', import.meta.url);
const cacheFile = new URL('editorial-titles.json', dir);
const statusFile = new URL('title-editor-status.json', dir);
const enabled = process.env.TITLE_EDITOR_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY);
if (!enabled) {
  writeJson(statusFile, { state: 'skipped', reason: '使用本地标题规则' });
  console.log('标题使用本地规则生成，不调用付费模型。');
  process.exit(0);
}

const hash = value => createHash('sha256').update(value).digest('hex');
const cache = readJson(cacheFile, { items: {} });
const articles = Object.values(readJson(new URL('articles.json', dir), {}));
const candidates = articles.filter(article => article.publishedAt && !article.reviewReasons?.length && article.contentParagraphs?.length)
  .map(article => ({
    article,
    inputHash: hash(JSON.stringify([article.title, article.brands, article.contentParagraphs.slice(0, 3)]))
  }))
  .filter(({ article, inputHash }) => cache.items[article.url]?.inputHash !== inputHash);

function usableTitle(value) {
  const title = cleanText(value);
  if (title.length < 8 || title.length > 42) return '';
  if (/新浪|网通社|凤凰网|汽车之家|懂车帝|易车|IT之家|财联社|观点网|快科技/u.test(title)) return '';
  return title;
}

async function rewrite(batch) {
  const input = batch.map(({ article }) => ({
    url: article.url,
    brands: article.brands,
    sourceHeadline: article.title,
    verifiedText: article.contentParagraphs.slice(0, 3).map(cleanText).join('\n')
  }));
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TITLE_MODEL || 'gpt-5-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是汽车行业日报编辑。只根据已核验正文，为每条内容写一条8到42字的中文资讯标题。标题必须包含明确主体、动作和关键事实或时间；去掉媒体名、栏目名、广告口号、感叹号和夸张修辞。不得引入正文没有的事实。若正文不足以支持标题，返回空字符串。' },
        { role: 'user', content: JSON.stringify({ items: input }) + '\n只输出 JSON：{"items":[{"url":"...","title":"..."}]}' }
      ]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`标题模型返回 ${response.status}: ${detail}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);
  return new Map((parsed.items || []).map(item => [item.url, usableTitle(item.title)]).filter(([, title]) => title));
}

let created = 0;
const failures = [];
for (let start = 0; start < candidates.length; start += 12) {
  const batch = candidates.slice(start, start + 12);
  try {
    const titles = await rewrite(batch);
    for (const { article, inputHash } of batch) {
      const title = titles.get(article.url);
      if (!title) continue;
      cache.items[article.url] = { title, inputHash, updatedAt: new Date().toISOString() };
      created++;
    }
  } catch (error) {
    failures.push(error.message);
    if (/标题模型返回 429\b/u.test(error.message) || isOpenAiQuotaError(error.message)) {
      console.log(isOpenAiQuotaError(error.message) ? '标题模型不可用，已改用本地规则标题。' : '标题模型返回 429，已停止后续批次并改用本地规则标题。');
      break;
    }
  }
}
writeJson(cacheFile, cache);
writeJson(statusFile, { state: failures.length ? 'partial' : 'completed', created, cached: candidates.length - created, failures, completedAt: new Date().toISOString() });
console.log(`标题生成：新增 ${created} 条；${failures.length ? `${failures.length} 批失败，保留原有标题。` : '完成。'}`);
