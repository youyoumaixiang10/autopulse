import { issueSearchDates, readJson, writeJson } from './content-utils.mjs';
import { OPENAI_BILLING_ACTION, isOpenAiQuotaError } from './daily-run-gate.mjs';
import { candidatesFromResponse, discoveryJobs, hasStructuredOutput, searchJob, structuredArticles } from './openai-web-discovery.mjs';

const dir = new URL('../runtime/', import.meta.url);
const file = new URL('openai-search-candidates.json', dir);
const previous = readJson(file, { candidates: [] });
const discoveryVersion = 7;
const jobs = discoveryJobs();
const targetDates = issueSearchDates();
const sameIssue = previous.discoveryVersion === discoveryVersion && JSON.stringify(previous.targetDates || []) === JSON.stringify(targetDates);
const priorRuns = sameIssue ? new Map((previous.queryRuns || []).map(run => [run.id, run])) : new Map();
const queryRuns = sameIssue ? [...(previous.queryRuns || [])] : [];
const collected = [];
let fatalReason = '';

if (!process.env.OPENAI_API_KEY) {
  writeJson(file, {
    collectedAt: new Date().toISOString(), discoveryVersion, providerStatus: 'unavailable', reason: 'OPENAI_API_KEY 未配置',
    targetDates, jobs: jobs.map(job => ({ id: job.id, brand: job.brand })), queryRuns: [], candidates: previous.candidates || []
  });
  console.warn('OpenAI 网页检索未运行：OPENAI_API_KEY 未配置。');
  process.exit(0);
}

const quotaBlocked = sameIssue && previous.fatalReason;
const pendingJobs = quotaBlocked ? [] : jobs.filter(job => priorRuns.get(job.id)?.status !== 'completed');
let nextJob = 0;
function saveRun(run) {
  const index = queryRuns.findIndex(item => item.id === run.id);
  if (index === -1) queryRuns.push(run); else queryRuns[index] = run;
}
async function worker() {
  while (nextJob < pendingJobs.length && !fatalReason) {
    const job = pendingJobs[nextJob++];
    try {
      const response = await searchJob(job);
      if (response.status !== 'completed' || !hasStructuredOutput(response)) {
        throw new Error(`网页检索未返回完整结构化结果（${response.status || 'unknown'}）`);
      }
      const candidates = candidatesFromResponse(response, job);
      collected.push(...candidates);
      saveRun({ id: job.id, brand: job.brand, status: 'completed', sourceCount: candidates.length, structuredCount: structuredArticles(response).length, responseId: response.id });
    } catch (error) {
      saveRun({ id: job.id, brand: job.brand, status: 'failed', sourceCount: 0, reason: error.message });
      if (/insufficient_quota|credit_balance_exhausted|no credits remaining/iu.test(error.message)) fatalReason = error.message;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(6, pendingJobs.length || 1) }, worker));
if (fatalReason) {
  for (const job of pendingJobs.slice(nextJob)) {
    saveRun({ id: job.id, brand: job.brand, status: 'failed', sourceCount: 0, reason: 'OpenAI API 余额不足，本轮未继续请求' });
  }
}

const retained = sameIssue ? (previous.candidates || []) : [];
const candidates = [...new Map([...retained, ...collected].map(item => [item.url, item])).values()];
const failed = queryRuns.filter(run => run.status === 'failed');
writeJson(file, {
  collectedAt: new Date().toISOString(), discoveryVersion, targetDates, providerStatus: failed.length ? 'partial' : 'completed', fatalReason: fatalReason || previous.fatalReason || '',
  model: process.env.SEARCH_MODEL || 'gpt-5.5', queryRuns, candidates,
  publicationRule: '网页检索仅用于发现原文；原文发布日期、正文与来源通过后才进入日报。'
});
const completed = queryRuns.length - failed.length;
console.log(quotaBlocked
  ? 'OpenAI 网页检索：本期已因余额不足暂停，等待充值后下一期再试。'
  : `OpenAI 网页检索：完成 ${completed}/${queryRuns.length} 个品牌与行业任务，发现 ${collected.length} 条已登记来源线索。`);
if (failed.length && failed.length === queryRuns.length) {
  const reason = fatalReason || failed.find(run => run.reason)?.reason || '';
  console.warn(isOpenAiQuotaError(reason) || quotaBlocked
    ? OPENAI_BILLING_ACTION
    : `OpenAI 网页检索失败原因：${String(reason).replace(/\s+/gu, ' ').slice(0, 300)}。请检查仓库 Secret OPENAI_API_KEY。已核验内容仍会发布。`);
}
