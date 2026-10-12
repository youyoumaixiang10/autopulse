import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDailyRun, isOpenAiQuotaError } from '../scripts/daily-run-gate.mjs';

const sources = [
  { id: 'nio-official', sourceType: 'official' },
  { id: 'byd-news', sourceType: 'official' },
  { id: 'miit', sourceType: 'government' },
  { id: 'li-auto-weibo', sourceType: 'official-social' },
  { id: 'dongchedi-news', sourceType: 'vertical-media' },
  { id: 'autohome-news', sourceType: 'vertical-media' }
];

test('publishes when official lists are readable despite Weibo and OpenAI quota failures', () => {
  const decision = assessDailyRun({
    failures: ['collect-openai-web-discovery.mjs 未成功完成（1）'],
    openai: { providerStatus: 'partial', fatalReason: 'OpenAI Web Search HTTP 429: credit_balance_exhausted' },
    sources,
    sourceResults: [
      { sourceId: 'nio-official', status: 'ok', count: 11 },
      { sourceId: 'byd-news', status: 'no-recent-updates', listRead: true, itemCount: 168 },
      { sourceId: 'miit', status: 'ok', count: 1 },
      { sourceId: 'li-auto-weibo', status: 'failed', reason: '当前浏览器未读到官方帖文；可能需要登录或页面未加载' },
      { sourceId: 'dongchedi-news', status: 'failed', reason: '懂车帝首页缺少公开列表数据' },
      { sourceId: 'autohome-news', status: 'empty' }
    ]
  });
  assert.equal(decision.publish, true);
  assert.deepEqual(decision.blocking, []);
  assert.match(decision.warnings.join('\n'), /OPENAI_API_KEY/);
  assert.match(decision.warnings.join('\n'), /platform\.openai\.com\/settings\/organization\/billing/);
  assert.match(decision.warnings.join('\n'), /官方微博 1 个账号/);
  assert.match(decision.warnings.join('\n'), /autohome-news/);
});

test('stops publication when no official or government list is readable', () => {
  const decision = assessDailyRun({
    sources,
    sourceResults: [
      { sourceId: 'nio-official', status: 'error', reason: 'timeout' },
      { sourceId: 'byd-news', status: 'failed', error: 'The operation was aborted due to timeout' },
      { sourceId: 'miit', status: 'empty', reason: '未读到列表条目' },
      { sourceId: 'li-auto-weibo', status: 'failed', reason: '当前浏览器未读到官方帖文；可能需要登录或页面未加载' }
    ]
  });
  assert.equal(decision.publish, false);
  assert.match(decision.blocking.join('\n'), /官方与政策来源本轮都没有读到可用列表/);
  assert.match(decision.warnings.join('\n'), /byd-news/);
});

test('a required collector crash blocks publication even if an older list looked readable', () => {
  const decision = assessDailyRun({
    failures: ['collect-pilot.mjs 未成功完成（1）', 'title-editor.mjs 未成功完成（1）'],
    sources,
    sourceResults: [{ sourceId: 'nio-official', status: 'ok', count: 4 }]
  });
  assert.equal(decision.publish, false);
  assert.match(decision.blocking.join('\n'), /collect-pilot\.mjs/);
  assert.doesNotMatch(decision.blocking.join('\n'), /title-editor/);
});

test('detects exhausted OpenAI credit from the API error body', () => {
  assert.equal(isOpenAiQuotaError('OpenAI Web Search HTTP 429: {"error":{"code":"credit_balance_exhausted"}}'), true);
  assert.equal(isOpenAiQuotaError('标题模型返回 400: bad request'), false);
});
