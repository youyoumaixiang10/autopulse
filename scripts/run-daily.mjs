import { spawn } from 'node:child_process';
import { openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sourceRegistry } from '../data/sources.js';
import { readJson, writeJson } from './content-utils.mjs';
import { assessDailyRun } from './daily-run-gate.mjs';

const dir = new URL('../runtime/', import.meta.url);
mkdirSync(dir, { recursive: true });
const lock = new URL('daily.lock', dir);
let descriptor;
try { descriptor = openSync(lock, 'wx'); }
catch (error) { if (error.code === 'EEXIST') { console.error('已有采集任务正在运行。'); process.exit(1); } throw error; }
const startedAt = new Date().toISOString();
const steps = [];
async function run(script) {
  const started = Date.now();
  console.log(`[daily] 开始 ${script}`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { cwd: new URL('../', import.meta.url), stdio: 'inherit', windowsHide: true });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`${script} 未成功完成（${code}）`)));
    });
  } finally {
    const durationMs = Date.now() - started;
    steps.push({ script, completedAt: new Date().toISOString(), durationMs });
    console.log(`[daily] 结束 ${script} ${durationMs}ms`);
  }
}
try {
  // Each collector preserves earlier successful content. A failure in one layer does not erase another.
  const failures = [];
  for (const script of ['collect-pilot.mjs', 'collect-discovery.mjs', 'collect-openai-web-discovery.mjs', 'collect-search-discovery.mjs']) {
    try { await run(script); } catch (error) { failures.push(error.message); }
  }
  await run('enrich-content.mjs');
  try { await run('title-editor.mjs'); } catch (error) { failures.push(error.message); }
  await run('reconcile-launch-calendar.mjs');
  await run('build-daily-report.mjs');
  await run('validate-content.mjs');
  await run('check-coverage.mjs');
  const sourceResults = ['candidates.json', 'discovery-candidates.json', 'search-candidates.json'].flatMap(file => readJson(new URL(file, dir), {}).sourceResults || []);
  const sourceMap = new Map(sourceResults.map(result => [result.sourceId, result]));
  const sources = sourceRegistry.map(source => {
    const result = sourceMap.get(source.id);
    const count = result?.candidateCount ?? result?.itemCount ?? result?.count ?? 0;
    let label = result?.publicLabel || '待接入';
    if (result) {
      if (!result.publicLabel) {
        if (['failed', 'error', 'empty'].includes(result.status)) label = '读取异常';
        else if (result.status === 'degraded') label = '公开时间线暂不可读 · 不阻断发布';
        else if (result.status === 'partial') label = `已读 ${count} 条 · 读取范围有限`;
        else if (result.status === 'no-recent-updates') label = `列表可读 · 最近发布 ${result.latestPublishedAt}`;
        else label = `已读 ${count} 条`;
      }
    }
    return { id: source.id, name: source.name, brands: source.brands, status: result?.status || 'pending', label };
  });
  const enrichment = readJson(new URL('enrichment-status.json', dir), {});
  const limited = sources.some(source => ['partial', 'pending', 'failed', 'error', 'empty'].includes(source.status));
  const openai = readJson(new URL('openai-search-candidates.json', dir), null);
  // Optional layers (Weibo visitor/cookie miss, media fallback misses, OpenAI billing) stay warnings.
  // Weibo "degraded" is visible on the site and must not stop the daily publish.
  // The run fails only when a required step crashes or no official/government list was readable.
  const assessment = assessDailyRun({ failures, sourceResults, sources: sourceRegistry, openai });
  const completedAt = new Date().toISOString();
  writeJson(new URL('run-status.json', dir), {
    startedAt, completedAt, state: assessment.publish && !assessment.warnings.length ? 'completed' : 'partial', failures,
    blocking: assessment.blocking, warnings: assessment.warnings,
    enrichmentFailures: enrichment.failures || [], steps, sourceResults
  });
  writeJson(new URL('public-status.json', dir), { completedAt, label: limited ? '持续更新中，部分来源尚未完整读取' : '本轮更新完成', sources });
  for (const warning of assessment.warnings) console.warn(`::warning::${warning}`);
  if (!assessment.publish) {
    for (const item of assessment.blocking) console.error(`::error::${item}`);
    console.error('本轮采集不完整，已停止发布。');
    process.exitCode = 1;
  } else {
    console.log(assessment.warnings.length ? '本轮已归档可用内容。可选来源未完整读取，不阻断发布。' : '本轮采集与归档完成；个别原文读取失败已进入待核实队列。');
  }
} catch (error) {
  writeJson(new URL('run-status.json', dir), { startedAt, completedAt: new Date().toISOString(), state: 'failed', reason: error.message, steps });
  console.error(error.message);
  process.exitCode = 1;
} finally { closeSync(descriptor); unlinkSync(lock); }
