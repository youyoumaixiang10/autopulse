import test from 'node:test';
import assert from 'node:assert/strict';
import { ajaxListToItems, isWeiboBlueV, mintWeiboVisitor, mobileCardsToItems, weiboAbsoluteTime } from '../scripts/weibo-public.mjs';
import { officialSocialAccounts, parseOfficialSocialPosts } from '../scripts/social-collector.mjs';

const liAuto = officialSocialAccounts[0];

test('public weibo timestamps and blue-v posts become the existing official post shape', () => {
  assert.equal(weiboAbsoluteTime('Thu Sep 10 12:20:00 +0800 2026'), '2026-09-10 12:20');
  assert.equal(weiboAbsoluteTime('5分钟前'), '');
  assert.equal(isWeiboBlueV({ verified: true, verified_type: 2 }), true);
  assert.equal(isWeiboBlueV({ verified: true, verified_type: 0 }), false);
  const [item] = mobileCardsToItems([{
    mblog: {
      mblogid: 'RhrxoBtxF', created_at: 'Thu Sep 10 12:20:00 +0800 2026', text: '全新理想i9<br>9月16日发布',
      user: { id: 6001272153, screen_name: '理想汽车', verified: true, verified_type: 2 }
    }
  }], liAuto);
  const [post] = parseOfficialSocialPosts([item], liAuto);
  assert.equal(post.url, 'https://weibo.com/6001272153/RhrxoBtxF');
  assert.equal(post.publishedAt, '2026-09-10');
  assert.match(post.contentParagraphs[0], /全新理想i9/);
  assert.equal(mobileCardsToItems([{ mblog: { mblogid: 'abc', created_at: 'Thu Sep 10 12:20:00 +0800 2026', isLongText: true, text: '未展开', user: { screen_name: '理想汽车', verified: true, verified_type: 2 } } }], liAuto).length, 0);
});

test('owner cookie timeline uses text_raw and visitor mint reads the public sub cookie', async () => {
  const [item] = ajaxListToItems([{
    mblogid: 'RhtzaiFNI', created_at: 'Thu Sep 10 17:30:00 +0800 2026', text_raw: '腾势发布新车权益',
    user: { id: 2664689831, screen_name: '腾势汽车', verified: true, verified_type: 2 }
  }], officialSocialAccounts[1]);
  assert.equal(parseOfficialSocialPosts([item], officialSocialAccounts[1])[0].authorName, '腾势汽车');
  const fetchImpl = async url => {
    if (String(url).includes('genvisitor')) return { ok: true, headers: { getSetCookie: () => [] }, text: async () => 'cb({"data":{"tid":"abc"}})' };
    return { ok: true, headers: { getSetCookie: () => ['SRF=1'] }, text: async () => 'cross_domain({"data":{"sub":"SUBVALUE","subp":"SUBPVALUE"}})' };
  };
  const cookie = await mintWeiboVisitor(fetchImpl);
  assert.match(cookie, /SUB=SUBVALUE/);
  assert.match(cookie, /SUBP=SUBPVALUE/);
});
