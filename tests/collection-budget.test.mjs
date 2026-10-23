import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../scripts/async-pool.mjs';
import { boundedTimeout } from '../scripts/browser-collector.mjs';
import { createSourceBudget, shouldReuseArticle } from '../scripts/article-reuse.mjs';

test('mapLimit keeps order and caps in-flight work', async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async value => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return value * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
  assert.equal(maxActive, 2);
});

test('boundedTimeout stops a page read before the stage deadline', () => {
  const deadlineAt = 10_000;
  assert.equal(boundedTimeout(deadlineAt, 5_000, 4_000), 5_000);
  assert.equal(boundedTimeout(deadlineAt, 15_000, 6_000), 4_000);
  assert.equal(boundedTimeout(deadlineAt, 5_000, 9_600), 0);
});

test('article cache reuses a dated body and still refreshes same-day pages', () => {
  const today = '2026-10-19';
  const now = Date.parse('2026-10-19T08:00:00Z');
  const old = {
    contentParagraphs: ['正文'],
    publishedAt: '2026-10-01',
    fetchedAt: '2026-09-01T00:00:00Z'
  };
  assert.equal(shouldReuseArticle(old, { publishedAt: null }, now, today), true);
  const sameDay = {
    contentParagraphs: ['正文'],
    publishedAt: '2026-10-19',
    fetchedAt: '2026-10-19T00:30:00Z'
  };
  assert.equal(shouldReuseArticle(sameDay, { publishedAt: null }, now, today), false);
  assert.equal(shouldReuseArticle(sameDay, { publishedAt: null }, Date.parse('2026-10-19T02:00:00Z'), today), true);
  assert.equal(shouldReuseArticle({ contentParagraphs: [], publishedAt: '2026-10-01' }, {}, now, today), false);
});

test('a source failure budget stops only that source', () => {
  const budget = createSourceBudget(100);
  assert.equal(budget.blocked('news18a-auto'), false);
  budget.charge('news18a-auto', 40, false);
  budget.charge('news18a-auto', 70, false);
  budget.charge('autohome-news', 30, true);
  assert.equal(budget.blocked('news18a-auto'), true);
  assert.equal(budget.blocked('autohome-news'), false);
  budget.skip('news18a-auto');
  budget.skip('news18a-auto');
  assert.deepEqual(budget.snapshot(), [
    { sourceId: 'news18a-auto', failureMs: 110, skipped: 2, stopped: true }
  ]);
});
