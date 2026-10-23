import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOfficialSocial, isTransientNavigationError, officialSocialAccounts, parseOfficialSocialPosts } from '../scripts/social-collector.mjs';
import { sourceRegistry } from '../data/sources.js';

const liAuto = officialSocialAccounts[0];
const denza = officialSocialAccounts[1];
const fixture = {
  url: 'https://weibo.com/6001272153/RhrxoBtxF', date: '2026-09-10 12:20', author: '理想汽车', blueVerified: true,
  text: '🚘全新理想i9，一台更像家的旗舰。\n全新形态，旗舰体验，家的温度。\n9月16日 19:30，我们不见不散。'
};

test('retries only transient browser navigation failures', () => {
  assert.equal(isTransientNavigationError(new Error('Execution context was destroyed, most likely because of a navigation')), true);
  assert.equal(isTransientNavigationError(new Error('官方账号名称不匹配')), false);
});

test('reads exact source time and complete visible text from the fixed verified account', () => {
  const [post] = parseOfficialSocialPosts([fixture, fixture], liAuto);
  assert.equal(post.publishedAt, '2026-09-10');
  assert.equal(post.publishedTime, '2026-09-10T12:20:00+08:00');
  assert.equal(post.authorId, '6001272153');
  assert.equal(post.authorVerified, true);
  assert.deepEqual(post.contentParagraphs, [fixture.text]);
  assert.equal(parseOfficialSocialPosts([fixture, fixture], liAuto).length, 1);
});

test('does not convert pinned old posts to the collection day', () => {
  const posts = parseOfficialSocialPosts([{ ...fixture, date: '2025-09-26 10:30', url: 'https://weibo.com/6001272153/Q6k7LdSAF' }], liAuto);
  assert.equal(posts[0].publishedAt, '2025-09-26');
});

test('rejects mismatched accounts, missing verification, relative dates, invalid dates and truncated text', () => {
  const invalid = [
    { ...fixture, author: '理想汽车车友' },
    { ...fixture, blueVerified: false },
    { ...fixture, url: 'https://weibo.com/123456/RhrxoBtxF' },
    { ...fixture, date: '6小时前' },
    { ...fixture, date: '2026-02-30 12:20' },
    { ...fixture, truncated: true },
    { ...fixture, text: '正文仍未读完 ...展开', truncated: false }
  ];
  assert.deepEqual(parseOfficialSocialPosts(invalid, liAuto), []);
});

test('has only the registered official accounts, each with a verified numeric identity', () => {
  const registered = sourceRegistry.filter(source => source.sourceType === 'official-social');
  assert.equal(officialSocialAccounts.length, 16);
  assert.equal(new Set(officialSocialAccounts.map(account => account.uid)).size, 16);
  for (const account of officialSocialAccounts) {
    assert.match(account.uid, /^\d+$/);
    assert.equal(registered.find(source => source.id === account.sourceId)?.url, account.url);
  }
  assert.deepEqual(officialSocialAccounts.slice(-4).map(account => [account.name, account.uid]), [
    ['极氪Zeekr', '7576049404'], ['吉利银河', '7794864065'], ['长安启源', '3194397971'], ['鸿蒙智行', '3032210184']
  ]);
});

test('does not misattribute a co-created post owned by another UID', () => {
  const avatr = officialSocialAccounts.find(account => account.sourceId === 'avatr-weibo');
  assert.deepEqual(parseOfficialSocialPosts([{
    ...fixture, author: '阿维塔', url: 'https://weibo.com/7051114584/R97SspgTE'
  }], avatr), []);
});

test('keeps quoted content separate from the official author text', () => {
  const quotedPost = { authorName: '另一位发布者', text: '引用原帖内容', contentComplete: false };
  const [post] = parseOfficialSocialPosts([{ ...fixture, quotedPost }], liAuto);
  assert.deepEqual(post.contentParagraphs, [fixture.text]);
  assert.equal(post.postKind, 'repost');
  assert.deepEqual(post.quotedPost, quotedPost);
});

test('public weibo accounts stay covered and share a small concurrency limit', async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const fetchImpl = async (url, options) => {
    const href = String(url);
    if (href.includes('genvisitor')) return { ok: true, headers: { getSetCookie: () => [] }, text: async () => 'cb({"data":{"tid":"abc"}})' };
    if (href.includes('visitor?')) return { ok: true, headers: { getSetCookie: () => [] }, text: async () => 'cross_domain({"data":{"sub":"SUBVALUE","subp":"SUBPVALUE"}})' };
    if (!href.includes('m.weibo.cn/api/container/getIndex')) throw new Error(`unexpected ${href}`);
    assert.ok(options.signal instanceof AbortSignal);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 30));
    active--;
    seen.push(new URL(href).searchParams.get('value'));
    return { ok: true, json: async () => ({ ok: 1, data: { cards: [] } }) };
  };
  const previous = process.env.WEIBO_COOKIE;
  delete process.env.WEIBO_COOKIE;
  try {
    const result = await collectOfficialSocial({ fetchImpl });
    assert.equal(result.sourceResults.length, officialSocialAccounts.length);
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(seen.sort(), officialSocialAccounts.map(account => account.uid).sort());
    assert.ok(maxActive > 1 && maxActive <= 4);
    assert.ok(result.sourceResults.every(item => item.status === 'degraded'));
  } finally {
    if (previous === undefined) delete process.env.WEIBO_COOKIE;
    else process.env.WEIBO_COOKIE = previous;
  }
});

test('reads Denza exact post URL and ignores unrelated header links', () => {
  const posts = parseOfficialSocialPosts([{
    url: 'https://weibo.com/2664689831/RhtzaiFNI', date: '2026-09-10 17:30', author: '腾势汽车', blueVerified: true,
    text: '那些年，老师的超能力\n成为了#腾势Z9S#的真实力\n以科技为伴，与你共赴美好\n祝所有老师们#教师节#快乐'
  }], denza);
  assert.equal(posts[0].sourceId, 'denza-weibo');
  assert.equal(posts[0].authorId, '2664689831');
});
