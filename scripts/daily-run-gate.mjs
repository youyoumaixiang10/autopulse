const optionalStep = /collect-openai-web-discovery|collect-discovery|collect-search-discovery|title-editor/u;

export function isOpenAiQuotaError(message = '') {
  return /insufficient_quota|credit_balance_exhausted|no credits remaining|余额不足/iu.test(message);
}

export const OPENAI_BILLING_ACTION = '仓库 Secret OPENAI_API_KEY 已配置，但该密钥所属 OpenAI 账号没有剩余额度。请打开 https://platform.openai.com/settings/organization/billing/ 充值，然后在 Actions 页面手动重跑「更新汽车日报」。充值前网页检索和标题改写会跳过，已核验内容仍会发布。';

export function openaiOwnerWarning(record) {
  if (!record || record.providerStatus === 'completed') return '';
  const reason = record.fatalReason || record.reason || record.queryRuns?.find(run => run.reason)?.reason || '';
  if (record.providerStatus === 'unavailable' || /未配置/u.test(reason)) {
    return '未配置仓库 Secret OPENAI_API_KEY。网页检索和标题改写已跳过；在仓库 Settings → Secrets and variables → Actions 中添加该密钥后，手动重跑「更新汽车日报」。已核验内容仍会发布。';
  }
  if (isOpenAiQuotaError(reason) || (record.queryRuns || []).some(run => isOpenAiQuotaError(run.reason || ''))) return OPENAI_BILLING_ACTION;
  if (record.providerStatus === 'partial' || reason) {
    return `OpenAI 网页检索未完成（${String(reason || record.providerStatus).replace(/\s+/gu, ' ').slice(0, 240)}）。请检查仓库 Secret OPENAI_API_KEY 是否有效。这不阻断已核验内容发布。`;
  }
  return '';
}

function sourceType(sourcesById, result) {
  return sourcesById.get(result.sourceId)?.sourceType || '';
}

function brief(value) {
  return String(value || '').replace(/\s+/gu, ' ').slice(0, 180);
}

export function isCoreReadable(result) {
  if (!result) return false;
  if (result.status === 'ok') return true;
  if (result.status === 'no-recent-updates' && result.listRead === true) return true;
  const count = result.candidateCount ?? result.count ?? result.itemCount ?? 0;
  return result.status === 'partial' && (result.listRead === true || count > 0);
}

export function assessDailyRun({ failures = [], sourceResults = [], sources = [], openai = null } = {}) {
  const sourcesById = new Map(sources.map(source => [source.id, source]));
  const blocking = failures.filter(message => !optionalStep.test(message));
  const warnings = [];
  const openaiWarning = openaiOwnerWarning(openai);
  if (openaiWarning) warnings.push(openaiWarning);
  for (const message of failures.filter(item => optionalStep.test(item))) warnings.push(message);

  const unhealthy = result => ['failed', 'error', 'empty'].includes(result.status);
  const social = sourceResults.filter(result => sourceType(sourcesById, result) === 'official-social' && unhealthy(result));
  if (social.length) {
    const reason = brief(social[0].reason || social[0].error || social[0].status);
    warnings.push(`官方微博 ${social.length} 个账号未采集（${reason}）。GitHub 托管浏览器没有微博登录态，工作流也没有可注入的微博登录密钥；这些账号保持未覆盖，不阻断已核验官网内容发布。`);
  }
  const media = sourceResults.filter(result => sourceType(sourcesById, result) === 'vertical-media' && unhealthy(result));
  if (media.length) {
    warnings.push(`媒体来源未完整读取：${media.map(result => `${result.sourceId}（${brief(result.reason || result.error || result.status)}）`).join('；')}。`);
  }
  const official = sourceResults.filter(result => ['official', 'government'].includes(sourceType(sourcesById, result)) && unhealthy(result));
  if (official.length) {
    warnings.push(`部分官网或政策页读取异常：${official.map(result => `${result.sourceId}（${brief(result.reason || result.error || result.status)}）`).join('；')}。`);
  }

  const coreResults = sourceResults.filter(result => ['official', 'government'].includes(sourceType(sourcesById, result)));
  if (!coreResults.some(isCoreReadable)) {
    blocking.push('官方与政策来源本轮都没有读到可用列表，日报不会发布。请根据上方各来源原因修复后，在 Actions 页面手动重跑「更新汽车日报」。');
  }
  return { publish: blocking.length === 0, blocking, warnings };
}
