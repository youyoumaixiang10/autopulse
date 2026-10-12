import { createHash } from 'node:crypto';
import { monitoringCoverage } from '../data/monitoring-coverage.js';
import { chinaDate, cleanText } from './content-utils.mjs';

const evidenceLabels = { official: '官方发布', government: '政府公告', media: '媒体报道' };
const order = { government: 0, official: 1, media: 2 };
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const importantPattern = /上市|预售|发布会|官宣|降价|权益|交付|销量|合作|车展|召回|申报|价格|订单/u;
const explicitResponsePattern = /辟谣|澄清|(?:网传|事故|传闻|质疑|争议|投诉|首撞|维权|质量|攻防).{0,24}回应|回应.{0,24}(?:网传|事故|传闻|质疑|争议|投诉|首撞|维权|质量|攻防)/u;
const titlePreamblePattern = /^(?:我们|日前|目前|根据(?:此前)?信息|据(?:悉|报道|了解)|报道称|消息称|官方发布|当地时间)/u;
const titleSourcePattern = /(?:微博视频|公众号文章|官方微博|的微博)/u;
export function titleQualityIssues(title) {
  const value = cleanText(title);
  const issues = [];
  if (!value) issues.push('缺少标题');
  if (value.length > 42 || /…$/u.test(value)) issues.push('标题过长或截断');
  if (titlePreamblePattern.test(value)) issues.push('标题使用原文叙述口吻');
  if (titleSourcePattern.test(value)) issues.push('标题包含来源或载体');
  return issues;
}
function isExplicitResponse(text) {
  return explicitResponsePattern.test(text);
}
export function classify(title, evidenceStatus) {
  if (evidenceStatus === 'government') return ['政策', '公告'];
  const tags = [];
  if (/上市|预售|申报|新车|发布会/u.test(title)) tags.push('新车');
  if (/权益|降价|优惠|促销|补贴|预订价/u.test(title)) tags.push('促销');
  if (isExplicitResponse(title)) tags.push('品牌回应');
  if (/交付|销量/u.test(title)) tags.push('市场');
  if (/活动|代言|合作|教师节|车展|展出/u.test(title)) tags.push('营销传播');
  return tags.length ? tags : ['品牌动态'];
}
function followUp(tags) {
  if (tags.includes('政策')) return '跟进正式文件、适用范围与执行时间，区分公示稿和生效要求。';
  if (tags.includes('新车')) return '继续核对销售版本、正式价格与时间安排，区分预售、上市和交付。';
  if (tags.includes('促销')) return '核对权益有效期、车型与地区限制，并区分现金优惠、金融费用和置换条件。';
  if (tags.includes('市场')) return '核对统计周期与口径，将单月数据和累计数据分别比较。';
  return '关注这次信息面向的人群、活动节点与后续官方更新。';
}
function isEditorialBoilerplate(paragraph) {
  return /^(?:友情提示|温馨提示|相关阅读|更多精彩内容|点击编辑头像|扫一扫|关注我们)|如果您有(?:新车)?(?:谍照|爆料)/u.test(paragraph);
}
function usefulSourceParagraphs(article) {
  return (article.contentParagraphs || []).map(cleanText).filter(paragraph => paragraph && !isEditorialBoilerplate(paragraph));
}
function sourceDetails(article) {
  const paragraphs = usefulSourceParagraphs(article).slice(0, 3);
  return paragraphs.map(paragraph => `${paragraph.slice(0, 260)}${paragraph.length > 260 ? '…' : ''}`);
}
function socialPresentationText(text) {
  return cleanText(text).replace(/#([^#\n]+)#/gu, '$1 ').replace(/\s{2,}/gu, ' ').trim();
}
function mediaPresentationTitle(title) {
  const mediaNames = '新浪财经|新浪科技|新浪网|新浪汽车|网通社|凤凰网汽车|凤凰网|汽车之家|懂车帝|易车网|IT之家|财联社|观点网';
  return cleanText(title)
    .replace(new RegExp(`^[【[]\\s*(?:${mediaNames})(?:快报|报道|资讯)?\\s*[】]\\s*`, 'u'), '')
    .replace(new RegExp(`(?:\\s*[_|｜]\\s*(?:${mediaNames}))+\\s*$`, 'u'), '')
    .replace(new RegExp(`\\s+-\\s*(?:${mediaNames})\\s*$`, 'u'), '')
    .trim();
}
function factualMediaHeadline(title) {
  const cleaned = mediaPresentationTitle(title)
    .replace(/^(?:终于要来了|经典两座回归)[？?!！]?\s*/u, '')
    .replace(/^天生跑车基因\s*一文看懂\s*/u, '')
    .replace(/\b最新(?=谍照|申报图)/gu, '')
    .replace(/[！!]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();
  if (cleaned.length <= 42) return cleaned;
  const clauses = cleaned.split(/[？?。；;]/u).map(cleanText).filter(Boolean);
  const factual = clauses
    .map((clause, index) => ({
      clause,
      score: (/(?:上市|发布|首秀|亮相|交付|预售|申报|谍照|政策|召回|销量|价格|权益|OTA)/u.test(clause) ? 3 : 0)
        + (/\d/u.test(clause) ? 1 : 0)
        - index * 0.1
    }))
    .filter(({ clause }) => clause.length <= 42)
    .sort((a, b) => b.score - a.score)[0]?.clause;
  return factual || '';
}
function socialEventTitle(text) {
  const source = socialPresentationText(text);
  const debut = source.match(/首发\s*((?:[\u4e00-\u9fff]{1,8})?[A-Za-z]{1,4}\d{1,3}[A-Za-z]{0,4}(?:\s*(?:纯电|插混|增程|GT|Ultra|Max))?)/u);
  const agent = source.match(/超级智能体\s*[「“"]?([^」”"\s，。]{2,12})/u);
  if (debut && agent) return `${debut[1]}将首发“${agent[1]}”超级智能体服务`;
  const model = source.match(/(?:全新)?(鸿蒙智行|理想|小米|蔚来|乐道|比亚迪|零跑|腾势|极氪|岚图|阿维塔|深蓝|启源|吉利银河|特斯拉)\s*((?:[A-Za-z]{1,6}\d{1,3}|TT)(?:\s*(?:GT|Ultra|Max))?)/u);
  const date = source.match(/(\d{1,2}月\d{1,2}日)(?:\s*(\d{1,2}:\d{2}))?/u);
  if (!model) return '';
  const name = `${model[1]} ${model[2].replace(/\s+/gu, ' ')}`;
  const launchPrice = source.match(/上市[^。\n]{0,36}?(?:限时(?:先享)?价|售价)\s*(\d+(?:\.\d+)?\s*万元起?)/u);
  if (launchPrice) return `${name} 上市，限时${launchPrice[1].replace(/\s+/gu, '')}`;
  if (/中国香港\s*1[—–-]8月/u.test(source) && /销量\s*NO\.?(?:1|一)/iu.test(source)) return `${name} 在香港1—8月MPV销量居首`;
  if (/大定用户画像/u.test(source)) {
    const femaleShare = source.match(/女性用户占比\s*(\d+%)/u)?.[1];
    return `${name} 发布大定用户画像${femaleShare ? `，女性用户占比${femaleShare}` : ''}`;
  }
  if (!date) return '';
  const when = `${date[1]}${date[2] ? ` ${date[2]}` : ''}`;
  if (/产品发布会/u.test(source)) return `${name} 产品发布会定档 ${when}`;
  if (/发布会/u.test(source)) return `${name} 发布会定档 ${when}`;
  if (/预售/u.test(source)) return `${name} 预售节点定于 ${when}`;
  if (/上市/u.test(source)) return `${name} 上市节点定于 ${when}`;
  return '';
}
function contentTitle(article) {
  const raw = (article.contentParagraphs || []).map(cleanText).filter(Boolean).join(' ');
  if (!raw) return '';
  const source = article.sourceType === 'official-social' ? socialPresentationText(raw) : raw;
  const teslaOffer = source.match(/特斯拉宣布开启限时优惠活动[\s\S]{0,80}?(\d{1,2}月\d{1,2}日)前下单并提车\s*(Model 3\/Model Y)[\s\S]{0,60}?分别享受(\d+(?:\.\d+)?(?:万)?元)和(\d+(?:\.\d+)?(?:万)?元)优惠/u);
  if (teslaOffer) return `特斯拉${teslaOffer[2]}限时优惠至${teslaOffer[1]}，最高优惠${teslaOffer[4]}`;
  if (/丝路驾行挑战/u.test(source) && /(?:签约|合作签约)/u.test(source)) {
    const vehicleCount = source.match(/(?:提供|将提供)\s*(\d+)台车/u)?.[1];
    return `蔚来签约2026丝路驾行挑战${vehicleCount ? `，将提供${vehicleCount}台车及技术支持` : ''}`;
  }
  const candidates = source.split(/[。！？!?]/u).map(cleanText)
    .filter(sentence => sentence.length >= 8 && !/免责声明|版权|扫一扫|关注我们/u.test(sentence));
  let title = candidates.map((sentence, index) => ({
    sentence,
    score: (/(?:上市|发布|发布会|预售|车展|价格|交付|合作|签约|回应|推出|上线|展示|举办|宣布|优惠|降价)/u.test(sentence) ? 2 : 0)
      + (article.brands || []).reduce((score, brand) => score + (sentence.includes(brand) ? 2 : 0), 0)
      - index * 0.1
  })).sort((a, b) => b.score - a.score)[0]?.sentence || '';
  title = title
    .replace(/^媒体报道[：:]\s*/u, '')
    .replace(/^(?:IT之家|快科技|观点网(?:讯)?|财联社|网通社|新浪汽车|凤凰网汽车|汽车之家|懂车帝|易车网)\s*(?:\d{1,2}月\d{1,2}日)?(?:消息|电|讯)?[，,:：\s]*/u, '')
    .replace(/^(?:20\d{2}年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*(?:消息|电|讯))?[，,:：\s]*/u, '')
    .replace(/^【[^】]{1,80}】(?:财联社)?\s*\d{1,2}月\d{1,2}日电[，,:：\s]*/u, '')
    .replace(/^财联社记者从知情人士处获悉[，,:：\s]*/u, '')
    .replace(/^(?:日前|目前|近日|今日)[，,\s]*/u, '')
    .replace(/^我们从(?:官方|相关渠道)?(?:获悉|了解到)[，,\s]*/u, '')
    .replace(/^有网友(?:爆料|拍摄|发现)了?[，,\s]*/u, '')
    .replace(/的?最新谍照$/u, '谍照曝光')
    .replace(/终于(?:正式)?官宣了?/u, '官宣')
    .replace(/将会在当地时间/u, '将于')
    .replace(/全新\s+Roadster\s+跑车/u, '全新Roadster')
    .replace(/(\d)\s*月\s*(\d)\s*日/u, '$1月$2日')
    .replace(/晚上发布$/u, '发布')
    .replace(/，(?:今日|其中|据悉|新车)[\s\S]*$/u, '')
    .trim();
  if (!title || /^(?:原文介绍|报道称)/u.test(title)) return '';
  if (title.length <= 42) return title;
  const compact = title.replace(/\s+/gu, '');
  return compact.length <= 42 ? compact : '';
}
function displayTitle(article) {
  const sourceText = (article.contentParagraphs || []).filter(Boolean)[0] || article.title;
  if (article.sourceType === 'official-social') {
    const eventTitle = socialEventTitle(sourceText);
    if (eventTitle) return eventTitle;
    const lines = String(sourceText).split(/\r?\n/u).map(socialPresentationText).filter(Boolean);
    const qaLine = lines.find(line => /(?:答网友问|用户问答)/u.test(line));
    if (lines[0]?.startsWith('“') && qaLine) {
      const qaTitle = qaLine.split(/[。！？!?]/u).at(-1).trim();
      if (qaTitle) return qaTitle;
    }
  }
  return contentTitle(article) || factualMediaHeadline(article.title);
}
function sourceSummary(article, evidenceLabel) {
  const sourceText = usefulSourceParagraphs(article)[0] || '';
  const text = article.sourceType === 'official-social' ? socialPresentationText(sourceText || article.title) : sourceText || article.title;
  return `${evidenceLabel}：${text.slice(0, 92)}${text.length > 92 ? '…' : ''}`;
}
function isAutomaticallyImportant(article) {
  if (article.evidenceStatus === 'government') return true;
  if (!article.brands?.length) return false;
  const content = [article.title, ...(article.contentParagraphs || [])]
    .join(' ')
    .replace(/#[^#\n]+#/gu, ' ')
    .slice(0, 420);
  return importantPattern.test(content) || isExplicitResponse(content);
}
function eventKey(article, note) {
  if (note.eventKey) return note.eventKey;
  const text = [article.title, ...(article.contentParagraphs || []).slice(0, 1)].join(' ');
  const socialText = article.sourceType === 'official-social' ? socialPresentationText(text) : '';
  const socialDebut = socialText.match(/首发\s*((?:[\u4e00-\u9fff]{1,8})?[A-Za-z]{1,4}\d{1,3}[A-Za-z]{0,4}(?:\s*(?:纯电|插混|增程|GT|Ultra|Max))?)/u);
  if (socialDebut && article.brands?.length) return `${article.brands[0]}|${socialDebut[1].toLowerCase().replace(/\s+/gu, '')}|首发`;
  const rawEvent = text.match(/上市|预售|发布会|首秀|亮相|发布|交付|回购/u)?.[0];
  const event = /发布会|首秀|亮相|发布/u.test(rawEvent || '') ? '发布' : rawEvent;
  const brand = article.brands?.find(item => new RegExp(`${item.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*[A-Za-z]{1,4}\\d{0,3}`, 'u').test(text));
  const brandedModel = brand && text.match(new RegExp(`${brand.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*[A-Za-z]{1,4}\\d{0,3}(?:\\s*(?:GT|Ultra))?`, 'u'))?.[0];
  const roadster = text.match(/(?:新一代|全新)?\s*Roadster/iu)?.[0];
  const model = roadster ? 'Roadster'
    : brandedModel || text.match(/[\u4e00-\u9fff]{1,8}[A-Za-z]{1,4}\d{0,3}(?:\s*(?:GT|Ultra))?/u)?.[0]
    || text.match(/Model\s*[3YXS]|Cybercab/iu)?.[0];
  return event && model && article.brands?.length ? `${brand || article.brands[0]}|${model.toLowerCase().replace(/\s+/gu, '')}|${event}` : article.url;
}
function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
function windowLabel(date) {
  const previous = previousDate(date);
  return `${Number(previous.slice(5, 7))}月${Number(previous.slice(8, 10))}日 08:00 — ${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 08:00`;
}

export function ensureIssueRange(reports, startDate, endDate, now = new Date()) {
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(current.getTime()) || !Number.isFinite(end.getTime()) || current > end) return reports;
  while (current <= end) {
    const date = current.toISOString().slice(0, 10);
    reports[date] ||= {
      dateLabel: `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`,
      windowLabel: windowLabel(date),
      highlights: [], brands: {}, otherBrands: [], industry: [], updatedAt: now.toISOString()
    };
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return Object.fromEntries(Object.entries(reports).sort(([a], [b]) => b.localeCompare(a)));
}
export function reportIssueDate(article) {
  const time = String(article.publishedTime || '');
  const match = time.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):\d{2}/u);
  if (!match) return article.publishedAt;
  return Number(match[2]) >= 8 ? nextDate(match[1]) : match[1];
}
export function buildReports(articles, notes, now = new Date()) {
  const today = chinaDate(now);
  const groups = new Map();
  const reviewQueue = [];
  for (const article of articles) {
    const reasons = [...(article.reviewReasons || [])];
    const issueDate = reportIssueDate(article);
    if (!article.publishedAt || article.publishedAt > today || !article.contentParagraphs?.length) reasons.push('尚未具备完整的日期与原文');
    if (article.sourceType === 'official-social' && article.contentComplete === false) reasons.push('原帖正文未完整读取');
    if (!article.evidenceStatus) reasons.push('信息来源待核验');
    if (reasons.length) { reviewQueue.push({ title: article.title, sourceName: article.sourceName, url: article.url, reasons: [...new Set(reasons)] }); continue; }
    if (issueDate > today) continue;
    const note = notes[article.url] || {};
    if (note.exclude) continue;
    const editorialTitle = note.title || displayTitle(article);
    const titleIssues = titleQualityIssues(editorialTitle);
    if (titleIssues.length) {
      reviewQueue.push({ title: article.title, sourceName: article.sourceName, url: article.url, reasons: [`无法生成符合编辑规范的标题：${titleIssues.join('、')}`] });
      continue;
    }
    const key = `${issueDate}|${eventKey(article, note)}`;
    const group = groups.get(key) || [];
    group.push({ article, note, issueDate, editorialTitle });
    groups.set(key, group);
  }
  const reports = {};
  const launches = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => (order[a.article.evidenceStatus] ?? 9) - (order[b.article.evidenceStatus] ?? 9));
    const { article, note, issueDate, editorialTitle } = group[0];
    const id = `story-${hash(key)}`;
    const classificationText = [article.title, ...(article.contentParagraphs || [])]
      .join(' ')
      .replace(/#[^#\n]+#/gu, ' ')
      .slice(0, 420);
    const tags = classify(classificationText, article.evidenceStatus);
    const details = note.details || sourceDetails(article);
    const story = {
      id, tags, title: editorialTitle,
      summary: note.summary || sourceSummary(article, evidenceLabels[article.evidenceStatus]),
      detail: details.join('\n\n'),
      details,
      observation: note.observation || followUp(tags),
      sourceName: article.sourceName, sourceUrl: article.url, publishedAt: article.publishedAt, issueDate,
      publishedTime: article.publishedTime || article.publishedAt,
      brands: article.brands || [],
      evidenceStatus: article.evidenceStatus, evidenceLabel: evidenceLabels[article.evidenceStatus],
      editorialStatus: note.details ? 'prepared' : 'source-record',
      sourceLinks: group.map(({ article: item }) => ({ name: item.sourceName, url: item.url, publishedAt: item.publishedAt, label: evidenceLabels[item.evidenceStatus] })),
      important: note.important ?? isAutomaticallyImportant(article)
    };
    const date = issueDate;
    const report = reports[date] ||= { dateLabel: `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`, windowLabel: windowLabel(date), highlights: [], brands: {}, otherBrands: [], industry: [], updatedAt: now.toISOString() };
    if (story.important) report.highlights.push(story);
    if (article.brands?.length) {
      for (const brand of article.brands) (report.brands[brand] ||= []).push(story);
    } else {
      const topicText = `${article.title} ${(article.contentParagraphs || []).join(' ')}`;
      const vehicleTopic = /新车|车型|车展|上市|预售|早鸟|订金|试驾|车身|续航|动力/u.test(topicText);
      const industryTopic = /政策|法规|工信部|产业链|供应链|行业|协会|市场|销量|出口|召回|电池|充电/u.test(topicText);
      if (article.evidenceStatus === 'government' || (article.industry && industryTopic && !vehicleTopic)) report.industry.push(story);
      else report.otherBrands.push(story);
    }
    for (const { article: launchArticle, note: launchNote } of group) for (const launch of launchNote.launches || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(launch.date)) throw new Error(`上市日期无效：${launch.model}`);
      launches.push({ ...launch, id: `launch-${hash(`${launch.brand}|${launch.model}|${launch.date}`)}`,
        dateText: `${Number(launch.date.slice(5, 7))}月${Number(launch.date.slice(8, 10))}日`,
        statusLabel: { launched: '已上市', confirmed: '已官宣', estimated: '预计上市' }[launch.status],
        sourceName: launchArticle.sourceName, sourceUrl: launchArticle.url, evidenceLabel: evidenceLabels[launchArticle.evidenceStatus],
        publishedAt: launchArticle.publishedAt, storyId: id, detail: launchNote.details?.join('\n\n') || sourceDetails(launchArticle).join('\n\n'), observation: launchNote.observation || followUp(classify(`${launchArticle.title} ${(launchArticle.contentParagraphs || []).join(' ')}`, launchArticle.evidenceStatus)) });
    }
  }
  for (const report of Object.values(reports)) {
    report.brands = Object.fromEntries(monitoringCoverage.map(({ brand }) => [brand, report.brands[brand]]).filter(([, items]) => items));
    for (const list of [report.highlights, report.otherBrands, report.industry, ...Object.values(report.brands)]) list.sort((a, b) => b.publishedTime.localeCompare(a.publishedTime));
  }
  return { reports: Object.fromEntries(Object.entries(reports).sort(([a], [b]) => b.localeCompare(a))), launches, reviewQueue };
}
export function validateReports(reports, launches) {
  for (const [date, report] of Object.entries(reports)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日报日期无效');
    for (const story of [...report.highlights, ...report.otherBrands, ...report.industry, ...Object.values(report.brands).flat()]) {
      if (!story.id || !story.title || !story.summary || !story.detail || !story.evidenceLabel) throw new Error(`条目缺少可读内容：${story.title}`);
      const titleIssues = titleQualityIssues(story.title);
      if (titleIssues.length) throw new Error(`标题不符合编辑规范：${story.title}（${titleIssues.join('、')}）`);
      if (new URL(story.sourceUrl).protocol !== 'https:') throw new Error('条目原文链接必须为HTTPS');
      if (story.issueDate !== date) throw new Error('条目归档日与日报周期不一致');
    }
  }
  for (const launch of launches) {
    if (!launch.sourceUrl || !launch.model || !['launched', 'confirmed', 'estimated'].includes(launch.status)) throw new Error('新车记录缺少来源或状态');
    if (!/^\d{4}-\d{2}$/.test(launch.month || launch.date?.slice(0, 7) || '')) throw new Error('新车记录缺少有效月份');
    if (!launch.dateText) throw new Error('新车记录缺少时间说明');
    if (launch.date && !/^\d{4}-\d{2}-\d{2}$/.test(launch.date)) throw new Error('新车记录日期无效');
  }
}

export function mergeLaunches(derived, curated) {
  const byKey = new Map();
  for (const launch of [...derived, ...curated]) {
    const month = launch.month || launch.date?.slice(0, 7);
    const key = `${launch.brand}|${launch.model}|${launch.date || launch.dateText}`;
    byKey.set(key, { ...launch, month, dateText: launch.dateText || `${Number(launch.date.slice(5, 7))}月${Number(launch.date.slice(8, 10))}日` });
  }
  return [...byKey.values()].sort((a, b) => (a.month || '').localeCompare(b.month || '') || (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31') || a.model.localeCompare(b.model, 'zh-CN'));
}
