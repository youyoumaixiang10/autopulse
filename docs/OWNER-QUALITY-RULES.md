# Owner quality rules / 日报质量规则

Owner 歪歪, 2026-10-12. Future agents must follow these rules when changing the daily brief: clustering, tags, titles, section placement, industry signal cards, card CSS, or `npm run run-daily`.

Do not weaken a rule to fit a source, a model, or a layout idea. Bugfixes stay inside the rule. These rules override local taste.

## 1. Cluster by event, not channel / 按事件聚类

One event is one card. Official site, Weibo, and vertical media that report the same event are extra sources. List them only in the detail (`sourceLinks`). Do not emit one card per channel, account, or outlet.

同一事件只出一张卡片。多信源只出现在详情里，不按频道或账号拆卡。

## 2. Highlights: new cars first; strict `新车` / 当天重要摘要

In `当天重要摘要`, put new-car events first. Prefer news from the issue window. A concrete event day more than 14 days before the issue — a September date on an October 15 issue, for example — stays out of `当天重要摘要` unless the story is still breaking (召回, 辟谣, or an accident investigation).

Tag `新车` only for a specific model's launch, unveil, 上市, 官宣, 谍照, or 申报.

Do not tag `新车` for user portraits (用户画像), sales or delivery (销量 / 交付), policy (政策), OTA or software-only upgrades, or partnerships (合作).

## 3. Not a single brand → 行业信息

A story that is not one brand goes to `行业信息` (`industry`), not `其他品牌` (`otherBrands`).

That includes cross-brand roundups, multi-maker previews, policy, and industry shows. `其他品牌` is only a single non-focus brand, or one named model from that brand.

## 4. Titles name the subject and the event / 标题

Use one title style: a concrete subject plus what happened (which brand or model, and the event).

Drop channel lead-ins and empty wire openers. Do not publish 导语, `IT早报`, greetings such as 「大家好，现在是…」, a bare 「从相关渠道获悉」 or 「记者从知情人士处获悉」, a column credit such as 「汽势Auto-First丨作者」, an author byline, an opinion opener such as 「不知道大家感觉到没有」, or a column label such as 「时评」「社评」「快评」.

A title is one complete event sentence: subject, verb, and object. If the headline is only a stub, regenerate it from the body. If the summary repeats a non-event title, or is only a byline, greeting, or opinion opener, rewrite it from a later factual sentence. A highlight with no concrete event after that rewrite stays out of `当天重要摘要`. A highlight title and its summary must be the same concrete event. Do not leave a spam, ad, or complaint template under a car title, and do not merge unrelated models into one highlight because they share a theme such as 预售.

## 5. Industry signal cards / 行业 SIGNAL 卡

On an industry signal card, the source line and the summary must not repeat the same text.

The same report is one card. Do not keep a second card because another outlet carried the same piece.

## 6. Do not redesign the cards / 卡片外观

Do not change card visual format or CSS except to fix a bug. Keep the existing lead, brand, and industry card structure.

## 7. No paid OpenAI on the daily run / 日报不依赖付费 OpenAI

`npm run run-daily` and the scheduled workflow must publish without a paid OpenAI call. Titles and clustering stay on local rules.

OpenAI web discovery stays optional and off unless it is explicitly enabled. A missing key, a billing error, or a rate limit must not block the daily publish.

## 8. 新车一览 follows the same 新车 events / 新车一览自动更新

`新车一览` is filled from qualifying 新车 stories on each daily run. Do not hand-edit `data/launch-calendar.json` for every new car.

A row is allowed only for a specific model's 上市, 官宣, 亮相, 谍照, or 申报 (预售 counts as 官宣 when no formal launch day is stated). Use the same strict `新车` line as rule 2: do not add 用户画像, 销量, 政策, OTA, 合作, or 频道导语 / 周预告.

Unknown prices stay `价格待公布` or `以品牌公告为准`. Do not invent a price or a launch day. Curated calendar rows still win when the status is equally specific.

The 上市日 column shows only a concrete launch day, in the existing `10月10日` form, or `待定`. Fuzzy windows such as 年底, 季度, 旬, 谍照曝光, and 已亮相 stay in `windowText` and the row detail. Month filters still use `month` (年底 buckets to December).

Status keys stay `launched|confirmed|estimated`. Labels: `已上市` is a formal 上市; `已官宣` is 官宣, 预售盲订, 即将登场, or 亮相·首秀 without a formal launch day; `未官宣` is a planned window or a weak signal such as 谍照 or 申报 with no official announce. Do not label an announced-but-unlaunched car as `未官宣`.

新车一览只收严格新车事件，并在每次日报运行时自动写入。价格和上市日必须来自原文；人工日历在同等状态下优先。上市日列只显示具体上市日或待定。

## Where this lives

- Clustering: `eventKey`, `samePublishedEvent`, `clusterGroups` in `scripts/report-builder.mjs`
- Strict `新车`: `isStrictNewCar`, `isNewCarHighlight`
- Launch calendar: `qualifiesForLaunchCalendar`, `deriveLaunchFromStory`, `mergeLaunches`
- Section: `sectionFor` (`brand` / `other` / `industry`)
- Titles and summaries: `titleQualityIssues`, `isTeaserText`, column / byline / opinion / wire-stub checks
- Highlight recency: `storyIsStale`, commentary leads, `highlightAgeRank`
- Daily OpenAI gate: `scripts/daily-run-gate.mjs`, `.github/workflows/daily-report.yml`
