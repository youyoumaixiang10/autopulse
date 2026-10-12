# Owner quality rules / 日报质量规则

Owner 歪歪, 2026-10-12. Future agents must follow these rules when changing the daily brief: clustering, tags, titles, section placement, industry signal cards, card CSS, or `npm run run-daily`.

Do not weaken a rule to fit a source, a model, or a layout idea. Bugfixes stay inside the rule. These rules override local taste.

## 1. Cluster by event, not channel / 按事件聚类

One event is one card. Official site, Weibo, and vertical media that report the same event are extra sources. List them only in the detail (`sourceLinks`). Do not emit one card per channel, account, or outlet.

同一事件只出一张卡片。多信源只出现在详情里，不按频道或账号拆卡。

## 2. Highlights: new cars first; strict `新车` / 当天重要摘要

In `当天重要摘要`, put new-car events first.

Tag `新车` only for a specific model's launch, unveil, 上市, 官宣, 谍照, or 申报.

Do not tag `新车` for user portraits (用户画像), sales or delivery (销量 / 交付), policy (政策), OTA or software-only upgrades, or partnerships (合作).

## 3. Not a single brand → 行业信息

A story that is not one brand goes to `行业信息` (`industry`), not `其他品牌` (`otherBrands`).

That includes cross-brand roundups, multi-maker previews, policy, and industry shows. `其他品牌` is only a single non-focus brand, or one named model from that brand.

## 4. Titles name the subject and the event / 标题

Use one title style: a concrete subject plus what happened (which brand or model, and the event).

Drop channel lead-ins and empty wire openers. Do not publish 导语, `IT早报`, greetings such as 「大家好，现在是…」, or a bare 「从相关渠道获悉」 with no fact.

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

新车一览只收严格新车事件，并在每次日报运行时自动写入。价格和上市日必须来自原文；人工日历在同等状态下优先。

## Where this lives

- Clustering: `eventKey`, `samePublishedEvent`, `clusterGroups` in `scripts/report-builder.mjs`
- Strict `新车`: `isStrictNewCar`, `isNewCarHighlight`
- Launch calendar: `qualifiesForLaunchCalendar`, `deriveLaunchFromStory`, `mergeLaunches`
- Section: `sectionFor` (`brand` / `other` / `industry`)
- Titles: `titleQualityIssues`, `isTeaserText`
- Daily OpenAI gate: `scripts/daily-run-gate.mjs`, `.github/workflows/daily-report.yml`
