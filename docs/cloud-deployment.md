# 云端日报运行方式

日报由 GitHub Actions 每天北京时间 08:05 运行。它先启动项目自带的无头 Chromium，再执行采集、原文日期与正文核验、去重、日报生成和内容校验，最后把静态网站发布到 GitHub Pages。

日报统计周期固定为前一天 08:00 至当天 08:00。来源读取受限或原文无法核验时，本轮仍会发布已核验内容，并在网站中提示来源覆盖状态。

首次上线只需：

1. 将此目录推送到一个 GitHub 仓库。
2. 在仓库 Settings → Pages 中将 Source 设为 GitHub Actions。
3. 仓库 Secret 名称是 `OPENAI_API_KEY`（Settings → Secrets and variables → Actions）。它用于标题改写，也用于 OpenAI 网页检索。密钥缺失，或该密钥所属账号没有剩余额度时，这两步会跳过并在日志里给出充值地址：https://platform.openai.com/settings/organization/billing/ 。这不会让「更新汽车日报」失败，已核验的官网和政策内容仍会发布。
4. 官方微博在 GitHub 托管浏览器里通常要求登录。工作流没有微博登录密钥可配；这些账号未读到帖文时只记警告，不阻断发布。
5. 在 Actions 页面手动运行一次“更新汽车日报”，确认 Pages 地址生成。

之后不需要打开电脑；GitHub 的定时任务会自行运行。需要补跑时，打开 Actions →「更新汽车日报」→ Run workflow。只有官网和政策列表都没读到，或核验/生成步骤本身失败时，该工作流才会以失败结束并停止发布。
