import test from 'node:test';
import assert from 'node:assert/strict';
import { brandCoverageState, freePathReady } from '../scripts/coverage-rule.mjs';

test('a brand is complete from official and media lists without Weibo or OpenAI', () => {
  assert.equal(brandCoverageState({
    officialStatuses: [{ status: 'ok' }],
    socialStatuses: [{ status: 'failed' }],
    discoveryStatuses: [{ status: 'partial' }]
  }), 'complete');
});

test('the free daily path is ready when any official or government list is readable', () => {
  assert.equal(freePathReady({
    brands: [{ officialStatuses: [{ status: 'no-recent-updates', listRead: true }] }],
    policy: [{ status: 'failed' }]
  }), true);
  assert.equal(freePathReady({
    brands: [{ officialStatuses: [{ status: 'failed' }] }],
    policy: [{ status: 'error' }]
  }), false);
});
