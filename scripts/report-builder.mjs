import { createHash } from 'node:crypto';
import { monitoringCoverage } from '../data/monitoring-coverage.js';
import { chinaDate, cleanText, mentionedMakers, outsideRankingLeads, resolveStoryBrands } from './content-utils.mjs';

const evidenceLabels = { official: '官方发布', government: '政府公告', media: '媒体报道' };
const order = { government: 0, official: 1, media: 2 };
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const importantPattern = /上市|预售|发布会|官宣|降价|权益|交付|销量|合作|车展|召回|申报|价格|订单/u;
const explicitResponsePattern = /辟谣|澄清|(?:网传|事故|传闻|质疑|争议|投诉|首撞|维权|质量|攻防).{0,24}回应|回应.{0,24}(?:网传|事故|传闻|质疑|争议|投诉|首撞|维权|质量|攻防)/u;
const titlePreamblePattern = /^(?:我们|日前|目前|根据(?:此前)?信息|据(?:悉|报道|了解)|报道称|消息称|官方发布|当地时间|报道(?:\s|[，,：:]))/u;
const titleSourcePattern = /(?:微博视频|公众号文章|官方微博|的微博)/u;
const channelTeaserPattern = /IT早报|大家好[，,\s]*现在是|今天的重要科技资讯|^本期内容我们将为大家带来|咱们明天见/u;
const wireTitlePattern = /^(?:[\u4e00-\u9fffA-Za-z]{0,12})?从(?:官方|相关渠道)(?:获悉|了解到|获取)/u;
export function isTeaserText(text) {
  const value = cleanText(text);
  if (!value) return false;
  if (channelTeaserPattern.test(value)) return true;
  return /^(?:[“"「『])?(?:[\u4e00-\u9fffA-Za-z]{2,10})?从(?:官方|相关渠道)(?:获悉|了解到|获取了?(?:一组)?)[。！？!?]?$/u.test(value);
}
export function titleQualityIssues(title) {
  const value = cleanText(title);
  const issues = [];
  if (!value) issues.push('缺少标题');
  if (value.length > 42 || /…$/u.test(value)) issues.push('标题过长或截断');
  if (titlePreamblePattern.test(value)) issues.push('标题使用原文叙述口吻');
  if (titleSourcePattern.test(value)) issues.push('标题包含来源或载体');
  if (channelTeaserPattern.test(value)) issues.push('标题是频道问候或栏目导语');
  if (wireTitlePattern.test(value)) issues.push('标题保留电头');
  return issues;
}
function isExplicitResponse(text) {
  return explicitResponsePattern.test(text);
}
export function classify(title, evidenceStatus) {
  if (evidenceStatus === 'government') return ['政策', '公告'];
  const tags = [];
  const text = cleanText(title);
  if (isStrictNewCar(text)) tags.push('新车');
  if (/权益|降价|优惠|促销|补贴|预订价/u.test(text)) tags.push('促销');
  if (isExplicitResponse(text)) tags.push('品牌回应');
  if (/交付|销量|用户画像|人群画像|财报|业绩|营收|净利润/u.test(text)) tags.push('市场');
  if (!tags.includes('新车') && isPolicyNotice(text)) tags.push('政策', '行业');
  if (/活动|代言|合作|教师节|车展|展出/u.test(text)) tags.push('营销传播');
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
  return /^(?:友情提示|温馨提示|相关阅读|更多精彩内容|点击编辑头像|扫一扫|关注我们)|如果您有(?:新车)?(?:谍照|爆料)|版权声明|本文版权|版权所有|免责声明|未经授权|未经允许|严禁转载|转载请联系|特别声明|以上作品内容/u.test(paragraph);
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
  const model = source.match(/(?:全新)?(鸿蒙智行|理想|小米|小鹏|蔚来|乐道|比亚迪|零跑|腾势|极氪|岚图|阿维塔|深蓝|启源|吉利银河|特斯拉)\s*((?:[A-Za-z]{1,6}\d{1,3}|TT)(?:\s*(?:GT|Ultra|Max))?)/u);
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
const summaryBudget = 92;
const factCue = /上市|发布|发布会|预售|交付|销量|营收|利润|亏损|财报|优惠|降价|价格|万元|召回|申报|亮相|首秀|官宣|谍照|展出|开售|开幕/u;
function selectedBodyText(article) {
  const paragraphs = usefulSourceParagraphs(article).slice(0, 3);
  const text = paragraphs.join(' ');
  return article.sourceType === 'official-social' ? socialPresentationText(text) : text;
}
function bodySentences(article) {
  return selectedBodyText(article).split(/[。！？!?]/u).map(cleanText)
    .filter(sentence => sentence.length >= 8 && !/免责声明|版权|扫一扫|关注我们/u.test(sentence));
}
function clipAtBoundary(text, budget = summaryBudget) {
  const value = cleanText(text);
  if (!value) return '';
  if (value.length <= budget) return value;
  const pieces = value.match(/[^。！？!?]+[。！？!?]?/gu) || [value];
  let acc = '';
  for (const piece of pieces) {
    const next = acc + piece;
    if (next.length <= budget) { acc = next; continue; }
    if (!acc && piece.length <= budget + 18 && /[。！？!?]$/u.test(piece)) return piece;
    if (acc && next.length <= budget + 18 && /[。！？!?]$/u.test(piece)) return next;
    break;
  }
  if (acc && /[。！？!?]$/u.test(acc)) return acc;
  const head = value.slice(0, budget);
  const clause = Math.max(head.lastIndexOf('，'), head.lastIndexOf('；'), head.lastIndexOf('、'));
  if (clause >= Math.floor(budget * 0.6)) return `${head.slice(0, clause)}…`;
  const near = value.slice(budget).search(/[。！？!?，；、]/u);
  if (near >= 0 && near <= 12) {
    const end = budget + near;
    return /[。！？!?]/.test(value[end]) ? value.slice(0, end + 1) : `${value.slice(0, end)}…`;
  }
  return acc ? `${acc}…` : `${head}…`;
}
function normalizeRelativeTime(text, issueDate) {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/u.test(issueDate || '')) return text;
  const year = Number(issueDate.slice(0, 4));
  const issueMonth = Number(issueDate.slice(5, 7));
  return text.replace(/今年(\d{1,2})月/gu, (full, month) => {
    const value = Number(month);
    if (value < 1 || value > 12 || Math.abs(value - issueMonth) < 2) return full;
    return `${year}年${value}月`;
  });
}
function datedMonths(text, issueDate) {
  const year = Number(issueDate.slice(0, 4));
  const found = [];
  for (const match of String(text || '').matchAll(/(?:(20\d{2})年)?(?:今年)?(\d{1,2})月/gu)) {
    const month = Number(match[2]);
    if (month < 1 || month > 12) continue;
    found.push((match[1] ? Number(match[1]) : year) * 12 + month);
  }
  return found;
}
function staleHook(text, issueDate) {
  const months = datedMonths(text, issueDate);
  if (!months.length || !/^\d{4}-\d{2}-\d{2}$/u.test(issueDate || '')) return false;
  const issue = Number(issueDate.slice(0, 4)) * 12 + Number(issueDate.slice(5, 7));
  return months.every(month => Math.abs(month - issue) >= 2);
}
function polishSentence(sentence) {
  return cleanText(sentence)
    .replace(/^媒体报道[：:]\s*/u, '')
    .replace(/^(?:IT之家|快科技|观点网(?:讯)?|财联社|网通社|新浪汽车|凤凰网汽车|汽车之家|懂车帝|易车网|盖世汽车|盖世具身智能|网易汽车|车质网)\s*(?:\d{1,2}月\d{1,2}日)?(?:消息|电|讯|报道|获悉)?[，,:：\s]*/u, '')
    .replace(/^(?:20\d{2}年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*(?:消息|电|讯|报道))?[，,:：\s]*/u, '')
    .replace(/^【[^】]{1,80}】(?:财联社)?\s*\d{1,2}月\d{1,2}日电[，,:：\s]*/u, '')
    .replace(/^财联社记者从知情人士处获悉[，,:：\s]*/u, '')
    .replace(/^(?:日前|目前|近日|今日)[，,\s]*/u, '')
    .replace(/^(?:我们|[\u4e00-\u9fffA-Za-z]{2,8})?从(?:官方|相关渠道)(?:获悉|了解到|获取了?(?:一组)?)[，,：:\s]*/u, '')
    .replace(/^(?:盖世汽车|IT之家|车质网|汽车之家)承办的/u, '')
    .replace(/^有网友(?:爆料|拍摄|发现)了?[，,\s]*/u, '')
    .replace(/在此(?=同台)/u, '')
    .replace(/的?最新谍照$/u, '谍照曝光')
    .replace(/(?<!曝)谍照$/u, '谍照曝光')
    .replace(/终于(?:正式)?官宣了?/u, '官宣')
    .replace(/将会在当地时间/u, '将于')
    .replace(/全新\s+Roadster\s*跑车/u, '全新Roadster')
    .replace(/(\d)\s*月\s*(\d)\s*日/u, '$1月$2日')
    .replace(/晚上发布$/u, '发布')
    .replace(/，(?:今日|据悉)[\s\S]*$/u, '')
    .trim();
}
function weakTitle(title) {
  const value = cleanText(title);
  if (!value || value.length < 8) return true;
  return /^(?:同时|此外|其中|不过|另外|因此|所以|于是|外观方面|内饰方面|动力方面|配置方面|空间方面|作为了解|作为参考|作为年代|结合此前|据各|从已公开|●|（)/u.test(value)
    || /汽车之家|(?:文|编译)\//u.test(value);
}
function namesNewsSubject(text) {
  if (mentionedMakers(text).length) return true;
  if (/[A-Za-z]{1,12}\s*\d|\d系|工信部|国家标准|4S|车企|经销商|激光雷达|车展|技术展|合作备忘录/u.test(text)) return true;
  return /[\u4e00-\u9fff]{2,8}(?:推出|签署|宣布|开幕)/u.test(text);
}
function stripParentheticals(text) {
  return cleanText(String(text || '').replace(/[（(][^）)]{0,40}[）)]/gu, ''));
}
function stripIncidentalPlaces(text) {
  return cleanText(String(text || '').replace(/在[\u4e00-\u9fff]{2,8}(?:市|省)?[\u4e00-\u9fffA-Za-z]{2,16}(?:大厦|大楼|总部|园区)/gu, (place, offset, source) => {
    const rest = `${source.slice(0, offset)}${source.slice(offset + place.length)}`;
    const placeMakers = mentionedMakers(place);
    return placeMakers.length && placeMakers.every(maker => !mentionedMakers(rest).includes(maker)) ? '' : place;
  }));
}
function isGenericDigestTitle(title) {
  const value = cleanText(title);
  if (/^本期内容我们/u.test(value)) return true;
  return /^(?:本周|本期).{0,16}(?:多款|新车预告|将迎来)/u.test(value)
    && !mentionedMakers(value).length
    && !/[A-Za-z]{1,8}\s*\d/u.test(value);
}
function isBareQuote(sentence) {
  return /^[“"「『]/u.test(cleanText(sentence));
}
function isAttributionOnly(sentence) {
  if (isTeaserText(sentence)) return true;
  const polished = polishSentence(sentence);
  if (!polished || polished.length < 8 || isTeaserText(polished)) return true;
  return /获悉|了解到|获取了一组/u.test(sentence) && !factCue.test(polished) && !namesNewsSubject(polished);
}
function usablePolishedTitle(sentence) {
  const title = stripIncidentalPlaces(stripParentheticals(polishSentence(sentence)));
  if (!title || weakTitle(title) || isTeaserText(title) || isGenericDigestTitle(title) || /^(?:原文介绍|报道称)/u.test(title)) return '';
  const accept = value => value.length >= 8 && value.length <= 42 && !weakTitle(value) && !isTeaserText(value) && !isGenericDigestTitle(value) && !titleQualityIssues(value).length;
  if (accept(title) && !/^(?:但是|但|然而)/u.test(title)) return title;
  const compact = title.replace(/\s+/gu, '');
  if (accept(compact) && !/^(?:但是|但|然而)/u.test(compact)) return compact;
  const parts = title.split(/[，；;：:]/u).map(cleanText).flatMap(part => {
    if (/^(?:但是|但|然而|不过|此外|同时)/u.test(part)) return [];
    if (/^(?:旨在|双方|该|此|这|其|将(?!于)|过去)/u.test(part) && !namesNewsSubject(part)) return [];
    if (/数据显示|获悉|消息称|报道称/u.test(part) && !/\d/u.test(part)) return [];
    if (!factCue.test(part) && /(?:今日宣布|向媒体确认|接受采访时透露|表示|指出)$/u.test(part)) return [];
    if (accept(part)) return [part];
    const compactPart = part.replace(/\s+/gu, '');
    return accept(compactPart) ? [compactPart] : [];
  });
  const longest = list => list.slice().sort((a, b) => b.length - a.length)[0] || '';
  return longest(parts.filter(part => factCue.test(part) && mentionedMakers(part).length))
    || longest(parts.filter(part => factCue.test(part) && namesNewsSubject(part) && !/^(?:亮相|发布|上市|推出|携)/u.test(part)))
    || longest(parts.filter(part => /技术展|车展|合作备忘录|推出|签署|开幕|启幕/.test(part) && !/^(?:亮相|发布|上市|推出|携)/u.test(part)))
    || longest(parts.filter(part => mentionedMakers(part).length && !/^(?:由|为).{0,12}(?:主办|承办|指导)/u.test(part)))
    || longest(parts.filter(part => factCue.test(part)))
    || longest(parts.filter(part => namesNewsSubject(part)))
    || '';
}
function leadSentences(article) {
  const paragraphs = usefulSourceParagraphs(article);
  const text = article.sourceType === 'official-social'
    ? socialPresentationText(paragraphs.slice(0, 3).join(' '))
    : (paragraphs[0] || '');
  return text.split(/[。！？!?]/u).map(cleanText)
    .filter(sentence => sentence.length >= 8 && !/免责声明|版权|扫一扫|关注我们|汽车之家|^（(?:文|编译)/u.test(sentence));
}
function contentTitle(article) {
  const source = selectedBodyText(article);
  if (!source) return '';
  const teslaOffer = source.match(/特斯拉宣布开启限时优惠活动[\s\S]{0,80}?(\d{1,2}月\d{1,2}日)前下单并提车\s*(Model 3\/Model Y)[\s\S]{0,60}?分别享受(\d+(?:\.\d+)?(?:万)?元)和(\d+(?:\.\d+)?(?:万)?元)优惠/u);
  if (teslaOffer) return `特斯拉${teslaOffer[2]}限时优惠至${teslaOffer[1]}，最高优惠${teslaOffer[4]}`;
  if (/丝路驾行挑战/u.test(source) && /(?:签约|合作签约)/u.test(source)) {
    const vehicleCount = source.match(/(?:提供|将提供)\s*(\d+)台车/u)?.[1];
    return `蔚来签约2026丝路驾行挑战${vehicleCount ? `，将提供${vehicleCount}台车及技术支持` : ''}`;
  }
  const ordered = leadSentences(article)
    .filter(sentence => !isTeaserText(sentence) && !isAttributionOnly(sentence) && !isBareQuote(sentence));
  const fact = ordered.find(sentence => factCue.test(sentence));
  const factTitle = fact ? usablePolishedTitle(fact) : '';
  if (factTitle) return factTitle;
  const opening = usablePolishedTitle(ordered[0] || '');
  if (opening) return opening;
  if (ordered.some(sentence => namesNewsSubject(polishSentence(sentence)))) return '';
  if (isCrossBrandDigest(article, article.title || '')) return '';
  const laterSentences = expandedNewsSentences(article)
    .filter(sentence => !isTeaserText(sentence) && !isAttributionOnly(sentence) && !isBareQuote(sentence));
  const later = laterSentences.find(sentence => factCue.test(sentence) && namesNewsSubject(sentence))
    || laterSentences.find(sentence => namesNewsSubject(sentence));
  return later ? usablePolishedTitle(later) : '';
}
function expandedNewsSentences(article) {
  const paragraphs = usefulSourceParagraphs(article).slice(0, 3);
  const text = article.sourceType === 'official-social'
    ? socialPresentationText(paragraphs.join(' '))
    : paragraphs.join(' ');
  return text.split(/[。！？!?]/u).map(cleanText)
    .filter(sentence => sentence.length >= 8 && !/免责声明|版权|扫一扫|关注我们|汽车之家|^（(?:文|编译)/u.test(sentence));
}
function articleText(article) {
  return cleanText([article.title, ...(article.contentParagraphs || [])].join(' '));
}
function concreteSourceHeadline(article) {
  const raw = mediaPresentationTitle(article.title);
  const trimmed = cleanText(raw
    .replace(/[（(][^）)]{0,30}[）)]/gu, '')
    .replace(/20\d{2}年第\d{1,2}周/gu, '本周')
    .replace(/\s{2,}/gu, ' '));
  const basis = articleText(article) || article.title;
  for (const candidate of [trimmed, factualMediaHeadline(article.title)]) {
    if (!candidate || candidate.length < 8 || candidate.length > 42) continue;
    if (weakTitle(candidate) || isTeaserText(candidate) || isGenericDigestTitle(candidate)) continue;
    if (titleQualityIssues(candidate).length) continue;
    if (/[？?]|杀入|最贵|竟然|亏\d|别眨眼/u.test(article.title)) continue;
    if (!titleAligns(candidate, basis) || !namesNewsSubject(candidate)) continue;
    return candidate;
  }
  return '';
}
function alignedHeadline(article) {
  const headline = factualMediaHeadline(article.title);
  const lead = articleText(article) || article.title;
  if (!headline || weakTitle(headline) || titleQualityIssues(headline).length || !titleAligns(headline, lead)) return '';
  if (/[？?]|杀入|最贵|竟然|亏\d|别眨眼/u.test(article.title)) return '';
  return headline;
}
function displayTitle(article, issueDate) {
  const sourceText = (article.contentParagraphs || []).filter(Boolean)[0] || article.title;
  if (article.sourceType === 'official-social') {
    const eventTitle = socialEventTitle(sourceText);
    if (eventTitle) return normalizeRelativeTime(eventTitle, issueDate);
    const lines = String(sourceText).split(/\r?\n/u).map(socialPresentationText).filter(Boolean);
    const qaLine = lines.find(line => /(?:答网友问|用户问答)/u.test(line));
    if (lines[0]?.startsWith('“') && qaLine) {
      const qaTitle = qaLine.split(/[。！？!?]/u).at(-1).trim();
      if (qaTitle) return qaTitle;
    }
  }
  const fromBody = contentTitle(article);
  const headline = alignedHeadline(article) || concreteSourceHeadline(article);
  const fragmentBody = /^(?:旨在|双方|该|此|这|将|过去|盖世|承办)/u.test(fromBody || '');
  if (fromBody && headline && (
    (factCue.test(headline) && !factCue.test(fromBody))
    || (namesNewsSubject(headline) && (!namesNewsSubject(fromBody) || fragmentBody))
  )) return normalizeRelativeTime(headline, issueDate);
  if (fromBody) return normalizeRelativeTime(fromBody, issueDate);
  if (headline) return normalizeRelativeTime(headline, issueDate);
  if (leadSentences(article).length || bodySentences(article).length) return '';
  return '';
}
function titleAligns(title, lead) {
  const basis = cleanText(lead);
  const value = cleanText(title);
  if (!value || !basis) return false;
  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/gu)].map(match => match[0]).filter(number => number.length >= 2);
  return numbers.every(number => basis.includes(number));
}
function compactText(text) {
  return cleanText(text).replace(/[“”"「」『』《》【】（）()[\]，。！？!?、：:；;,.·\s\-—～~]/gu, '');
}
function stripSummaryWire(sentence) {
  const value = cleanText(sentence);
  if (!/获悉|了解到|获取了一组|报道\s+\d{1,2}月/u.test(value)) return value;
  const stripped = value
    .replace(/^(?:(?:日前|目前|近日|今日)[，,\s]*)?(?:IT之家|快科技|观点网|财联社|网通社|新浪汽车|凤凰网汽车|汽车之家|懂车帝|易车网?|盖世汽车|盖世具身智能|网易汽车|车质网)\s*(?:\d{1,2}月\d{1,2}日)?(?:消息|讯|电|报道|获悉)?[，,:：\s]*/u, '')
    .replace(/^(?:(?:日前|目前|近日|今日)[，,\s]*)?(?:[\u4e00-\u9fffA-Za-z]{2,8})?从(?:官方|相关渠道)(?:获悉|了解到|获取了?(?:一组)?)[，,：:\s]*/u, '')
    .replace(/^(?:\d{1,2}月\d{1,2}日)(?:消息|讯|电|报道)?[，,:：\s]*/u, '');
  return stripped.length >= 8 ? stripped : value;
}
function summarySentences(article, expanded) {
  const paragraphs = usefulSourceParagraphs(article);
  const text = article.sourceType === 'official-social'
    ? socialPresentationText((expanded ? paragraphs.slice(0, 3) : paragraphs.slice(0, 1)).join(' ') || article.title || '')
    : (expanded ? paragraphs.slice(0, 3).join(' ') : (paragraphs[0] || article.title || ''));
  return text.split(/[。！？!?]/u).map(cleanText)
    .filter(sentence => sentence.length >= 8 && !/免责声明|版权|扫一扫|关注我们/u.test(sentence))
    .filter(sentence => !isTeaserText(sentence) && !isAttributionOnly(sentence) && !isBareQuote(sentence))
    .map(stripSummaryWire)
    .filter(sentence => sentence.length >= 8 && !isTeaserText(sentence));
}
function packSummary(sentences, issueDate) {
  const opening = [];
  for (const sentence of sentences) {
    const next = opening.length ? `${opening.join('。')}。${sentence}。` : `${sentence}。`;
    if (cleanText(next).length > summaryBudget) break;
    opening.push(sentence);
  }
  const joined = opening.length ? `${opening.join('。')}。` : (sentences[0] || '');
  return normalizeRelativeTime(clipAtBoundary(joined), issueDate);
}
function comparableCopy(text) {
  return cleanText(text).replace(/[。！？!?\s#]/gu, '');
}
function nearlySameCopy(a, b) {
  const left = comparableCopy(a);
  const right = comparableCopy(b);
  return Boolean(left) && left === right;
}
function isDateRange(text) {
  return /(?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*[-–—~至到]\s*(?:\d{4}年)?(?:\d{1,2}月)?\d{1,2}日/u.test(text)
    || /\d{1,2}[./]\d{1,2}\s*[-–—~]\s*\d{1,2}[./]\d{1,2}/u.test(text)
    || /第\s*\d+\s*周/u.test(text);
}
function isRoundup(text) {
  return /多款|其中包括|第\s*\d+\s*周|本周将迎来|[A-Za-z0-9\u4e00-\u9fff]{1,24}\/[A-Za-z0-9\u4e00-\u9fff.]{1,24}等/u.test(text);
}
function isSingleModelNews(text) {
  if (isRoundup(text)) return false;
  if (isDateRange(text) && /预告|前瞻|盘点|一览|导语/u.test(text)) return false;
  const model = /(?:Model\s*[3YXS]|Roadster|(?:比亚迪|吉利|银河|问界|智界|享界|尊界|尚界|理想|蔚来|小米|小鹏|极氪|阿维塔|腾势|岚图|深蓝|零跑|乐道|特斯拉|启源|方程豹|仰望)\s*[A-Za-z0-9\u4e00-\u9fff]{1,16}|[A-Za-z]{1,10}[\w.-]{0,8}\d[\w.-]*|[\u4e00-\u9fff]{1,8}[A-Za-z]{1,6}\d{1,3})/u;
  const event = /上市|预售|发布|首发|亮相|交付|官宣|申报|首秀|降价|权益/u;
  return model.test(text) && event.test(text);
}
function isPreviewTeaserText(text) {
  const value = cleanText(text);
  if (!value) return false;
  if (/本期内容我们(?:将)?为(?:大家|您)带来|本期为您|一周新车|本周将迎来多款|大家可以继续关注我们后续/u.test(value)) return true;
  if (/一起来看/u.test(value) && !isSingleModelNews(value)) return true;
  if (/新车预告/u.test(value) && !isSingleModelNews(value)) return true;
  if (isDateRange(value) && /预告|前瞻|盘点|一览|导语/u.test(value) && !isSingleModelNews(value)) return true;
  return false;
}
function isHardTeaser(text) {
  const value = cleanText(text);
  if (!value) return false;
  if (/本期内容我们(?:将)?为(?:大家|您)带来|本期为您|一周新车|本周将迎来多款|大家可以继续关注我们后续/u.test(value)) return true;
  return isDateRange(value) && /预告|前瞻|盘点|一览|导语/u.test(value) && !isSingleModelNews(value);
}
function isPreviewTeaserArticle(article, editorialTitle = '') {
  const lead = usefulSourceParagraphs(article)[0] || '';
  const shown = [editorialTitle, lead].map(cleanText).filter(Boolean);
  if (shown.some(isSingleModelNews) && shown.every(text => !isHardTeaser(text))) return false;
  return [article?.title, editorialTitle, lead].some(isPreviewTeaserText);
}
function factualPoint(sentence) {
  return factCue.test(sentence) && !isPreviewTeaserText(sentence);
}
function sourceSummary(article, issueDate, titleToAvoid = '') {
  const sentences = summarySentences(article, false);
  const summary = packSummary(sentences, issueDate);
  const duplicate = Boolean(titleToAvoid) && nearlySameCopy(summary, titleToAvoid);
  const teaser = !summary || isTeaserText(summary);
  if (!titleToAvoid || (!duplicate && !teaser)) return summary;
  const laterPoint = list => packSummary(list.filter(sentence => !nearlySameCopy(sentence, titleToAvoid) && factualPoint(sentence) && !isTeaserText(sentence)), issueDate);
  const distinct = laterPoint(sentences);
  if (distinct && !isTeaserText(distinct)) return distinct;
  if (summary && !isTeaserText(summary)) return summary;
  const expanded = summarySentences(article, true);
  const expandedPoint = laterPoint(expanded);
  if (expandedPoint && !isTeaserText(expandedPoint)) return expandedPoint;
  return packSummary(expanded, issueDate) || summary;
}
function isAutomaticallyImportant(article, brands = article.brands) {
  if (article.evidenceStatus === 'government') return true;
  if (!brands?.length) return false;
  const content = [article.title, ...(article.contentParagraphs || [])]
    .join(' ')
    .replace(/#[^#\n]+#/gu, ' ')
    .slice(0, 420);
  return importantPattern.test(content) || isExplicitResponse(content);
}
function highlightCardText(story) {
  return cleanText(`${story?.title || ''} ${story?.summary || ''}`);
}
function withoutLaunchAnniversary(text) {
  return String(text || '').replace(/上市\s*(?:\d+|[一二两三])?\s*周年/gu, ' ');
}
function hasSpecificModel(text) {
  const value = String(text || '')
    .replace(/20\d{2}/gu, ' ')
    .replace(/第\s*\d+\s*批/gu, ' ')
    .replace(/(?:不低于|不少于|不超过|超过|大约|约为|约|近|达|共|为|至|从)\s*\d+(?:\.\d+)?/gu, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/gu, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:万|元|公里|km|kwh|kw|%|台|辆|款|项|亿|家|个|毫米|mm)/giu, ' ');
  return /Model\s*[3YXS]|Roadster|Cybercab|钛\s*\d{1,2}|[A-Za-z]{1,12}\s*-?\s*\d{1,4}|\d{1,2}\s*[A-Za-z]{1,4}|[\u4e00-\u9fff]{2,8}\d{1,4}(?![年月日时分秒])|\d{1,2}系/u.test(value);
}
function isUserPortrait(text) {
  return /用户画像|人群画像/u.test(text);
}
function isPolicyNotice(text) {
  if (/征求意见稿|迎新规|管理办法|标准化工作要点|汽车产品创新设计/u.test(text)) return true;
  if (/(?:发布|出台|实施|公示|印发)[^。]{0,16}国家标准|国家标准[^。]{0,8}(?:发布|出台|实施|公示)/u.test(text)) return true;
  return /(?:工信部|国务院|发改委|市场监管总局).{0,16}(?:通知|新规|意见|标准|办法|公示)/u.test(text);
}
function isEarningsReport(text) {
  return /财报|业绩公告|业绩情况|营收|归母净利润|净利润/u.test(text);
}
function isPartnershipAnnouncement(text) {
  return /签署[^。]{0,20}(?:协议|合作)|战略合作|合作备忘录|合作协议/u.test(text);
}
function isEuropeExpansionPlan(text) {
  return /进入欧洲|登陆欧洲|出海欧洲|欧洲市场|欧洲业务|在欧洲正式落地/u.test(text);
}
function isSalesOrDeliveryReport(text) {
  return /销量|交付数据|交付量|累计交付|锁单|批发量|批发销量|销量快报|交付成绩|交付新车\s*\d|月交付/u.test(text);
}
function isMultiModelRoundup(text) {
  const count = '(?:\\d+|[二三四五六七八九十两])\\s*款';
  return new RegExp(`${count}[^。]{0,8}概念车`, 'u').test(text)
    || new RegExp(`(?:多款|数款|${count})新车`, 'u').test(text)
    || /(?:\d+\s*个品牌).{0,20}(?:\d+\s*款)/u.test(text);
}
function isLineupRelease(text) {
  if (!/(?:[3-9]|[三四五六七八九十])\s*款车型/u.test(text)) return false;
  return !/正式上市|开启预售|开启盲订|开启预订/u.test(leadPortion(text));
}
function namesLaunchSubject(text) {
  if (hasSpecificModel(text) || /全新车型|新车型|官宣新车/u.test(text)) return true;
  if (/全新(?!标杆|高度|升级|体验|战略|定义)/u.test(text)) return true;
  return /(?:SUV|MPV|轿车|轿跑|跑车)/u.test(text);
}
function isAccessoryAppearance(text) {
  return /套装|选装包/u.test(text) && !/上市|预售|盲订|官宣|全新车型|新车型/u.test(text);
}
function leadPortion(text) {
  const value = cleanText(text);
  const end = value.search(/[。！？]/u);
  return (end === -1 ? value : value.slice(0, end)).slice(0, 90);
}
function isSpecificModelSpy(text) {
  return /谍照|申报图/u.test(text) && hasSpecificModel(text) && !/如果您有/u.test(text);
}
function isSpecificModelFiling(text) {
  return /申报|现身/u.test(text) && hasSpecificModel(text) && !/如果您有/u.test(text);
}
function isRegulatoryNotice(text) {
  return isPolicyNotice(text);
}
function isMarketStats(text) {
  return /销量|交付数据|交付量|累计交付|锁单|用户画像|财报|业绩公告|营收|归母净利润|股价|跌停|批发/u.test(text);
}
function isSoftwareOtaOnly(text) {
  if (!/OTA|软件升级|系统升级/u.test(text)) return false;
  return !/上市|预售|开售|发布会|首发|首秀|亮相|登场|谍照|申报图|官图|全新车型|新车型|概念车|官宣新车|正式推出/u.test(withoutLaunchAnniversary(text));
}
function hasVehicleLaunch(text) {
  const value = withoutLaunchAnniversary(text);
  if (/技术日|世界模型/u.test(value) && !/上市|预售|开售|首发|首秀|亮相|谍照|申报|官图|全新车型|官宣/u.test(value)) return false;
  if (/取消[^。]{0,20}(?:发布会|预售|上市)|新车发布计划|发布计划/u.test(value)) return false;
  if (/上市|预售|开售|盲订|开启预订|发布会|全球首发|新车首发|正式首发|首秀|亮相|登场|官图|全新车型|新车型|概念车|开启预约|新车发布(?!计划)|正式推出|即将登场|欧洲发布|海外发布|全球发布/u.test(value)) return true;
  if (/官宣/u.test(value) && /新车|车型|登场|上市|发布|亮相|首秀|SUV|轿车|MPV/u.test(value)) return true;
  if (/将于\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^。]{0,8}发布/u.test(value)) return true;
  if (/全新[^，。]{0,24}发布/u.test(value) && !/发布(?:数据|销量|财报|战略|公告|信息|通知)/u.test(value)) return true;
  if (/正式发布/u.test(value) && /车型|SUV|轿车|MPV|轿跑|概念车|旗舰|新车/u.test(value) && !/发布(?:数据|销量|财报|战略|公告|信息|通知)/u.test(value)) return true;
  if (/推出/u.test(value) && /(?:全新|新款|旗舰|SUV|轿车|MPV|轿跑|车型|概念车)/u.test(value) && !/购车礼遇|金融权益|权益价/u.test(value)) return true;
  return false;
}
function isStrictNewCar(text) {
  const value = cleanText(text);
  if (!value || isSoftwareOtaOnly(value) || isUserPortrait(value) || isAccessoryAppearance(value) || isMultiModelRoundup(value) || isLineupRelease(value)) return false;
  if (/申报车型综览|等在列/u.test(value)) return false;
  const leadLaunch = hasVehicleLaunch(leadPortion(value)) || isSpecificModelSpy(leadPortion(value)) || isSpecificModelFiling(leadPortion(value));
  if ((isSalesOrDeliveryReport(value) || isEarningsReport(value) || isPartnershipAnnouncement(value) || isEuropeExpansionPlan(value)) && !leadLaunch) return false;
  if (isRegulatoryNotice(value) && !leadLaunch && !isSpecificModelFiling(value) && !isSpecificModelSpy(value)) return false;
  const spy = isSpecificModelSpy(value);
  const filing = isSpecificModelFiling(value);
  const launch = hasVehicleLaunch(value);
  if (spy || filing) return true;
  if (!launch || !namesLaunchSubject(value)) return false;
  return true;
}
export function isNewCarHighlight(story) {
  const text = highlightCardText(story);
  if (story?.evidenceStatus === 'government' && !isSpecificModelFiling(text) && !isSpecificModelSpy(text)) return false;
  return isStrictNewCar(text);
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
const mediaQuality = ['汽车之家', '懂车帝', '盖世汽车', '新浪汽车', '易车', '太平洋汽车', '新出行', '凤凰网', '财联社', '每日经济新闻', '网通社', '车质网', 'IT之家', '快科技', '网易', '搜狐'];
function sourceQuality(name = '') {
  const index = mediaQuality.findIndex(item => String(name).includes(item));
  return index === -1 ? mediaQuality.length : index;
}
function compareStoryPriority(a, b) {
  const evidence = (order[a.article.evidenceStatus] ?? 9) - (order[b.article.evidenceStatus] ?? 9);
  if (evidence) return evidence;
  const quality = sourceQuality(a.article.sourceName) - sourceQuality(b.article.sourceName);
  if (quality) return quality;
  const timeA = a.article.publishedTime || a.article.publishedAt || '9999-99-99';
  const timeB = b.article.publishedTime || b.article.publishedAt || '9999-99-99';
  return timeA < timeB ? -1 : timeA > timeB ? 1 : 0;
}
function clusterTitle(text) {
  return cleanText(text).toLowerCase()
    .replace(/[“”"「」『』《》【】（）()[\]，。！？!?、：:；;,.·\s\-—～~]/gu, '')
    .replace(/今日|日前|目前|正式|官方将其?|旗下|全新车型|定位为?|号称/gu, '')
    .replace(/官宣|宣布/gu, '发布')
    .replace(/登场|首发|首秀/gu, '亮相');
}
function titleDice(leftText, rightText) {
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  const grams = value => {
    const counts = new Map();
    const chars = [...value];
    for (let index = 0; index < chars.length - 1; index += 1) {
      const gram = chars[index] + chars[index + 1];
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    return counts;
  };
  const left = grams(leftText);
  const right = grams(rightText);
  let leftTotal = 0;
  let rightTotal = 0;
  let overlap = 0;
  for (const count of left.values()) leftTotal += count;
  for (const count of right.values()) rightTotal += count;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) || 0);
  return leftTotal + rightTotal ? (2 * overlap) / (leftTotal + rightTotal) : 0;
}
function storyEventClass(entry) {
  const cues = [
    ['recall', /召回/u],
    ['response', /辟谣|澄清|回应/u],
    ['filing', /申报|谍照/u],
    ['presale', /预售/u],
    ['launch', /上市/u],
    ['debut', /发布会|首秀|首发|亮相|登场|官宣|宣布|发布/u],
    ['delivery', /交付/u],
    ['price', /降价|优惠|权益/u],
    ['sales', /销量/u]
  ];
  const classifyText = text => {
    let best = null;
    for (const [name, pattern] of cues) {
      const match = pattern.exec(text || '');
      if (match && (!best || match.index < best.index)) best = { name, index: match.index };
    }
    return best?.name || '';
  };
  return classifyText(entry.editorialTitle) || classifyText(mediaPresentationTitle(entry.article.title));
}
function storyModels(entry) {
  const source = cleanText(`${entry.article.title} ${entry.editorialTitle}`);
  const found = new Set();
  const add = value => {
    const token = String(value || '').toLowerCase().replace(/[\s-]+/gu, '');
    if (token.length < 2 || /^\d+(?:kw|kwh|km|mm|kg|gb|mp)?$/iu.test(token)) return;
    if (/^(?:suv|mpv|ev|ota|ads|usb|cltc)$/iu.test(token)) return;
    found.add(token);
  };
  for (const match of source.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z]{1,12}[\s-]?[A-Za-z]?\d{1,4}[A-Za-z]{0,4})(?![A-Za-z0-9])/gu)) add(match[1]);
  for (const match of source.matchAll(/(?:^|[^A-Za-z0-9])(\d{1,2}[A-Za-z]{1,4})(?![A-Za-z0-9])/gu)) add(match[1]);
  for (const match of source.matchAll(/model\s*[3ysx]|roadster|cybercab/giu)) add(match[0]);
  for (const match of source.matchAll(/银河战舰\s*\d{2,4}|梦想家\s*\d{1,2}/gu)) add(match[0]);
  return found;
}
function storyNumbers(entry) {
  return new Set([...cleanText(`${entry.article.title} ${entry.editorialTitle}`).matchAll(/\d+(?:\.\d+)?/gu)].map(match => match[0]));
}
function numberConflict(a, b) {
  const left = storyNumbers(a);
  const right = storyNumbers(b);
  if (!left.size || !right.size) return false;
  if (left.size !== right.size) return true;
  for (const value of left) if (!right.has(value)) return true;
  return false;
}
function titleSimilarity(a, b) {
  return {
    editorialSim: titleDice(clusterTitle(a.editorialTitle), clusterTitle(b.editorialTitle)),
    sourceSim: titleDice(clusterTitle(mediaPresentationTitle(a.article.title)), clusterTitle(mediaPresentationTitle(b.article.title)))
  };
}
function namedReportKey(text) {
  const value = cleanText(text);
  const published = value.match(/([\u4e00-\u9fff]{2,12}?)(?:今日|日前|于\d{1,2}月\d{1,2}日)?(?:发布|公布|披露)\s*((?:20\d{2}\s*年\s*)?\d{1,2}\s*月份?[^，。；;]{0,32}?(?:分析报告|市场报告|销量报告|产销快报|产销报告|报告))/u);
  if (published) {
    const publisher = /^(?:据|从|由|消息)/u.test(published[1]) ? '' : published[1];
    return compactText(`${publisher}${published[2]}`);
  }
  const named = value.match(/((?:20\d{2}\s*年\s*)?\d{1,2}\s*月份?[^，。；;]{0,24}?全国乘用车[^，。；;]{0,16}?报告)/u);
  return named ? compactText(named[1]) : '';
}
function industryReportKey(entry) {
  return namedReportKey([entry.editorialTitle, entry.article?.title, (entry.article?.contentParagraphs || [])[0] || ''].join(' '));
}
function industrySectionEntry(entry) {
  return sectionFor(entry.article, entry.brands, entry.editorialTitle) === 'industry';
}
function sameIndustryEvent(a, b) {
  if (a.issueDate !== b.issueDate || !industrySectionEntry(a) || !industrySectionEntry(b)) return false;
  if (a.note?.eventKey && b.note?.eventKey && a.note.eventKey !== b.note.eventKey) return false;
  const reportA = industryReportKey(a);
  const reportB = industryReportKey(b);
  if (reportA && reportA === reportB) return true;
  const titleA = clusterTitle(a.editorialTitle);
  const titleB = clusterTitle(b.editorialTitle);
  return titleA.length >= 8 && titleA === titleB;
}
function reportFacetRank(entry) {
  const lead = cleanText(`${entry.article?.title || ''} ${(entry.article?.contentParagraphs || [])[0] || ''}`);
  if (/零售|批发/u.test(lead) && !/出口/u.test(lead)) return 0;
  if (/出口/u.test(lead)) return 1;
  return 2;
}
function reportFacetPoint(sentence, sharedTitle) {
  const clauses = polishSentence(sentence).split(/[，,；;]/u).map(cleanText).filter(Boolean);
  const metric = /零售|批发|出口|销量|渗透率|产量/u;
  const index = clauses.findIndex(clause => metric.test(clause) && /\d/u.test(clause) && !nearlySameCopy(clause, sharedTitle));
  if (index === -1) return '';
  const next = clauses[index + 1] || '';
  const point = /^同比|^环比/u.test(next) && clauses[index].length + next.length <= 48 ? `${clauses[index]}，${next}` : clauses[index];
  return nearlySameCopy(point, sharedTitle) ? '' : point;
}
function mergedIndustrySummary(group, issueDate, title) {
  const ordered = group.slice().sort((a, b) => reportFacetRank(a) - reportFacetRank(b) || compareStoryPriority(a, b));
  const points = [];
  const seen = new Set();
  for (const entry of ordered) {
    for (const sentence of summarySentences(entry.article, true)) {
      const point = reportFacetPoint(sentence, title);
      const key = compactText(point);
      if (!point || !key || seen.has(key)) continue;
      seen.add(key);
      points.push(point);
      break;
    }
  }
  return points.length >= 2 ? packSummary(points, issueDate) : '';
}
function mergedIndustryDetails(group) {
  const ordered = group.slice().sort((a, b) => reportFacetRank(a) - reportFacetRank(b) || compareStoryPriority(a, b));
  const seen = new Set();
  const details = [];
  for (const { article } of ordered) {
    for (const paragraph of sourceDetails(article)) {
      const key = compactText(paragraph);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      details.push(paragraph);
      if (details.length >= 6) return details;
    }
  }
  return details;
}
function sameIndustryCluster(group) {
  if (group.length < 2 || !group.every(industrySectionEntry)) return false;
  const reports = group.map(industryReportKey);
  if (reports.every(Boolean) && new Set(reports).size === 1) return true;
  return new Set(group.map(entry => clusterTitle(entry.editorialTitle))).size === 1;
}
function storyTags(article) {
  const classificationText = [article.title, ...(article.contentParagraphs || [])]
    .join(' ')
    .replace(/#[^#\n]+#/gu, ' ')
    .slice(0, 420);
  return classify(classificationText, article.evidenceStatus);
}
function samePublishedEvent(a, b) {
  if (a.issueDate !== b.issueDate) return false;
  if (a.note?.eventKey && b.note?.eventKey && a.note.eventKey !== b.note.eventKey) return false;
  if (sameIndustryEvent(a, b)) return true;
  const sameBrand = (!a.brands.length && !b.brands.length) || a.brands.some(brand => b.brands.includes(brand));
  if (!sameBrand) return false;
  const classA = storyEventClass(a);
  const classB = storyEventClass(b);
  if (classA && classB && classA !== classB) return false;
  const modelsA = storyModels(a);
  const modelsB = storyModels(b);
  const sharedModel = [...modelsA].some(model => modelsB.has(model));
  if (modelsA.size && modelsB.size && !sharedModel) return false;
  const { editorialSim, sourceSim } = titleSimilarity(a, b);
  const similarity = Math.max(editorialSim, sourceSim);
  if (sharedModel && classA && classB && similarity >= 0.35) return true;
  if (numberConflict(a, b)) return false;
  if (sourceSim < 0.45) return false;
  return similarity >= 0.7;
}
function clusterGroups(groups) {
  const items = [...groups.entries()];
  const buckets = new Map();
  items.forEach(([, entries], index) => {
    const sample = entries[0];
    const bucketId = `${sample.issueDate}|${[...sample.brands].sort().join('\u0001')}`;
    const bucket = buckets.get(bucketId) || [];
    bucket.push(index);
    buckets.set(bucketId, bucket);
  });
  const parent = items.map((_, index) => index);
  const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (const indexes of buckets.values()) {
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        const leftEntries = items[indexes[left]][1];
        const rightEntries = items[indexes[right]][1];
        if (leftEntries.some(entry => rightEntries.some(other => samePublishedEvent(entry, other)))) union(indexes[left], indexes[right]);
      }
    }
  }
  const industryIdentity = new Map();
  items.forEach(([, entries], index) => {
    for (const entry of entries) {
      if (!industrySectionEntry(entry)) continue;
      const report = industryReportKey(entry);
      const title = clusterTitle(entry.editorialTitle);
      const identities = [];
      if (report) identities.push(`report:${report}`);
      if (title.length >= 8) identities.push(`title:${title}`);
      for (const identity of identities) {
        const id = `${entry.issueDate}|${identity}`;
        const list = industryIdentity.get(id) || [];
        if (!list.includes(index)) list.push(index);
        industryIdentity.set(id, list);
      }
    }
  });
  for (const indexes of industryIdentity.values()) {
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        const leftEntries = items[indexes[left]][1];
        const rightEntries = items[indexes[right]][1];
        if (leftEntries.some(entry => rightEntries.some(other => sameIndustryEvent(entry, other)))) union(indexes[left], indexes[right]);
      }
    }
  }
  const clustered = new Map();
  items.forEach(([key, entries], index) => {
    const root = find(index);
    const cluster = clustered.get(root) || { keys: [], entries: [] };
    cluster.keys.push(key);
    cluster.entries.push(...entries);
    clustered.set(root, cluster);
  });
  return [...clustered.values()];
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
function isChannelDigest(article) {
  const head = cleanText(`${article.title || ''} ${(article.contentParagraphs || [])[0] || ''}`);
  return /IT早报|大家好[，,\s]*现在是|今天的重要科技资讯/u.test(head);
}
function isPeriodRoundupWithoutEvent(article) {
  const head = cleanText(`${article.title || ''} ${(article.contentParagraphs || [])[0] || ''}`);
  if (!/本期内容我们将为大家带来|财经早报|一周新车预告/u.test(head)) return false;
  if (/财经早报|IT早报/u.test(head)) return true;
  const body = cleanText([article.title, ...(article.contentParagraphs || [])].join(' '));
  return !(mentionedMakers(body).length && /上市|预售|首发|亮相|谍照|申报/u.test(body));
}
function isIndustryPolicy(article, title) {
  const heading = cleanText(`${article.title || ''} ${title || ''}`);
  if (/申报/u.test(heading) && mentionedMakers(heading).length <= 1) return false;
  return /工信部|国家标准|征求意见稿|(?:汽车|行业|产品).{0,8}新规|新规.{0,12}(?:门把手|座椅|创新设计)/u.test(heading);
}
function isCrossBrandDigest(article, title) {
  const heading = cleanText(`${article.title || ''} ${title || ''}`);
  const lead = cleanText(`${heading} ${(article.contentParagraphs || [])[0] || ''}`);
  if (outsideRankingLeads(lead)) return false;
  const digest = /新车预告|本期内容我们将|本周将迎来|同台亮相|中国车企|日系车企|各大车企|多家车企|谍照丨|一周新车|多款重磅|等(?:\s|$)/u;
  if (mentionedMakers(heading).length >= 3) return true;
  if (mentionedMakers(heading).length >= 2 && digest.test(heading)) return true;
  return digest.test(lead) && mentionedMakers(lead).length >= 2;
}
function isSingleVehicleEvent(text) {
  const value = cleanText(text);
  if (/新车预告|同台亮相|多家车企|多款重磅|本期内容/u.test(value)) return false;
  return /(?:车型|SUV|MPV|轿车|[A-Za-z]{1,12}[\s.#-]?\d|\d系)/u.test(value)
    && /上市|预售|谍照|申报|发布会|首发|首秀|亮相|开售|早鸟/u.test(value);
}
function sectionFor(article, brands, title) {
  const head = cleanText(`${article.title || ''} ${(article.contentParagraphs || [])[0] || ''} ${title || ''}`);
  if (outsideRankingLeads(head) && !brands.length) return 'other';
  if (article.evidenceStatus === 'government' || isIndustryPolicy(article, title) || isCrossBrandDigest(article, title)) return 'industry';
  if (brands.length) return 'brand';
  const makers = mentionedMakers(cleanText(`${article.title || ''} ${title || ''}`));
  if (makers.length > 1) return 'industry';
  if (makers.length === 1 || isSingleVehicleEvent(head)) return 'other';
  return 'industry';
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
    if (isChannelDigest(article) || isPeriodRoundupWithoutEvent(article)) {
      reviewQueue.push({ title: article.title, sourceName: article.sourceName, url: article.url, reasons: ['频道问候或无具体车型事件的周期汇总'] });
      continue;
    }
    const brands = resolveStoryBrands(article);
    const editorialTitle = note.title || displayTitle(article, issueDate);
    const titleIssues = titleQualityIssues(editorialTitle);
    if (titleIssues.length) {
      reviewQueue.push({ title: article.title, sourceName: article.sourceName, url: article.url, reasons: [`无法生成符合编辑规范的标题：${titleIssues.join('、')}`] });
      continue;
    }
    if (isPreviewTeaserArticle(article, editorialTitle) && !isCrossBrandDigest(article, editorialTitle)) continue;
    const key = `${issueDate}|${eventKey({ ...article, brands }, note)}`;
    const group = groups.get(key) || [];
    group.push({ article, note, issueDate, editorialTitle, brands });
    groups.set(key, group);
  }
  const reports = {};
  const launches = [];
  for (const cluster of clusterGroups(groups)) {
    const group = cluster.entries.sort(compareStoryPriority);
    const key = cluster.keys.length === 1 ? cluster.keys[0] : cluster.keys.slice().sort().join('||');
    const { article, note, issueDate, editorialTitle, brands } = group[0];
    const id = `story-${hash(key)}`;
    const mergeIndustryCopy = sameIndustryCluster(group);
    let tags = storyTags(article);
    if (mergeIndustryCopy) {
      const merged = [];
      for (const entry of group) for (const tag of storyTags(entry.article)) if (!merged.includes(tag)) merged.push(tag);
      const specific = merged.filter(tag => tag !== '品牌动态');
      tags = specific.length ? specific : merged;
    }
    let details = note.details || (mergeIndustryCopy ? mergedIndustryDetails(group) : sourceDetails(article));
    let summary = note.summary
      ? normalizeRelativeTime(cleanText(note.summary).replace(/^(?:官方发布|政府公告|媒体报道)[：:]\s*/u, ''), issueDate)
      : (mergeIndustryCopy ? mergedIndustrySummary(group, issueDate, editorialTitle) : '') || sourceSummary(article, issueDate, editorialTitle);
    if (!summary || isTeaserText(summary)) {
      reviewQueue.push({ title: article.title, sourceName: article.sourceName, url: article.url, reasons: ['摘要只剩导语或电头'] });
      continue;
    }
    const title = normalizeRelativeTime(editorialTitle, issueDate);
    const cardIsNew = isNewCarHighlight({ title, summary, evidenceStatus: article.evidenceStatus });
    if (cardIsNew) {
      if (!tags.includes('新车')) tags.unshift('新车');
    } else {
      const kept = tags.filter(tag => tag !== '新车');
      if (article.evidenceStatus !== 'government' && isPolicyNotice(`${title} ${summary}`) && !kept.includes('政策')) kept.push('政策', '行业');
      tags.splice(0, tags.length, ...(kept.length ? kept : ['品牌动态']));
    }
    const story = {
      id, tags, title,
      summary,
      detail: details.join('\n\n'),
      details,
      observation: note.observation || followUp(tags),
      sourceName: article.sourceName, sourceUrl: article.url, publishedAt: article.publishedAt, issueDate,
      publishedTime: article.publishedTime || article.publishedAt,
      brands,
      evidenceStatus: article.evidenceStatus, evidenceLabel: evidenceLabels[article.evidenceStatus],
      editorialStatus: note.details ? 'prepared' : 'source-record',
      sourceLinks: [...new Map(group.map(({ article: item }) => [item.url, { name: item.sourceName, url: item.url, publishedAt: item.publishedAt, label: evidenceLabels[item.evidenceStatus] }])).values()],
      important: group.some(item => isPreviewTeaserArticle(item.article, item.editorialTitle)) ? false
        : group.some(item => item.note.important === true) ? true
          : group.some(item => item.note.important === false) ? false
            : group.some(item => isAutomaticallyImportant(item.article, item.brands)) && !staleHook(`${editorialTitle} ${summary}`, issueDate)
    };
    const date = issueDate;
    const report = reports[date] ||= { dateLabel: `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`, windowLabel: windowLabel(date), highlights: [], brands: {}, otherBrands: [], industry: [], updatedAt: now.toISOString() };
    if (story.important) report.highlights.push(story);
    const section = sectionFor(article, brands, story.title);
    if (section === 'brand') {
      for (const brand of brands) (report.brands[brand] ||= []).push(story);
    } else if (section === 'other') report.otherBrands.push(story);
    else report.industry.push(story);
    for (const { article: launchArticle, note: launchNote } of group) for (const launch of launchNote.launches || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(launch.date)) throw new Error(`上市日期无效：${launch.model}`);
      launches.push({ ...launch, origin: 'note', month: launch.month || launch.date.slice(0, 7), id: `launch-${hash(`${launch.brand}|${launch.model}|${launch.date}`)}`,
        dateText: `${Number(launch.date.slice(5, 7))}月${Number(launch.date.slice(8, 10))}日`,
        statusLabel: { launched: '已上市', confirmed: '已官宣', estimated: '预计上市' }[launch.status],
        sourceName: launchArticle.sourceName, sourceUrl: launchArticle.url, evidenceLabel: evidenceLabels[launchArticle.evidenceStatus],
        publishedAt: launchArticle.publishedAt, storyId: id, detail: launchNote.details?.join('\n\n') || sourceDetails(launchArticle).join('\n\n'), observation: launchNote.observation || followUp(classify(`${launchArticle.title} ${(launchArticle.contentParagraphs || []).join(' ')}`, launchArticle.evidenceStatus)) });
    }
    for (const row of deriveLaunchFromGroup(story, group)) launches.push(row);
  }
  for (const report of Object.values(reports)) {
    report.brands = Object.fromEntries(monitoringCoverage.map(({ brand }) => [brand, report.brands[brand]]).filter(([, items]) => items));
    for (const list of [report.highlights, report.otherBrands, report.industry, ...Object.values(report.brands)]) list.sort((a, b) => b.publishedTime.localeCompare(a.publishedTime));
    report.highlights.sort((a, b) => Number(isNewCarHighlight(b)) - Number(isNewCarHighlight(a)));
  }
  return { reports: Object.fromEntries(Object.entries(reports).sort(([a], [b]) => b.localeCompare(a))), launches: mergeLaunches(launches, []), reviewQueue };
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

const launchStatusLabels = { launched: '已上市', confirmed: '已官宣', estimated: '预计上市' };
const launchStatusRank = { launched: 3, confirmed: 2, estimated: 1 };
const launchOriginRank = { curated: 4, note: 3, derived: 1, auto: 0 };
const launchEvidenceRank = { '政府公告': 3, '官方发布': 2, '媒体报道': 1 };
const displayBrands = [
  ['吉利银河', /吉利银河|银河战舰|银河星舰|银河\s*[A-Za-z]\d/iu],
  ['方程豹', /方程豹|钛\s*\d/u],
  ['仰望', /仰望/u],
  ['腾势', /腾势/u],
  ['问界', /问界/u],
  ['智界', /智界/u],
  ['享界', /享界/u],
  ['尊界', /尊界/u],
  ['尚界', /尚界/u],
  ['红旗', /红旗|天工\s*0?\d/u],
  ['远程', /星享|吉利远程|远程汽车/u],
  ['smart', /smart|精灵\s*#/iu],
  ['理想', /理想/u],
  ['小鹏', /小鹏|MONA/iu],
  ['蔚来', /蔚来|(?:^|[^A-Za-z])ET\s*\d/iu],
  ['乐道', /乐道/u],
  ['极氪', /极氪/u],
  ['小米', /小米/u],
  ['岚图', /岚图|梦想家/u],
  ['阿维塔', /阿维塔/u],
  ['深蓝', /深蓝/u],
  ['启源', /启源/u],
  ['零跑', /零跑/u],
  ['iCAR', /iCAR/iu],
  ['猛士', /猛士/u],
  ['智己', /智己/u],
  ['别克', /别克|君越/u],
  ['宝马', /宝马/u],
  ['奔驰', /奔驰/u],
  ['大众', /大众|ID\.?\s*ERA/iu],
  ['特斯拉', /特斯拉|Tesla|Cybercab|Roadster/iu],
  ['坦克', /坦克/u],
  ['纵横', /纵横/u],
  ['现代', /现代|艾尼氪/u],
  ['雪铁龙', /雪铁龙/u],
  ['林肯', /林肯/u],
  ['比亚迪', /比亚迪|海洋网/u],
  ['吉利', /吉利/u]
];
const brandFamily = {
  方程豹: '比亚迪', 仰望: '比亚迪', 腾势: '比亚迪',
  问界: '鸿蒙智行', 智界: '鸿蒙智行', 享界: '鸿蒙智行', 尊界: '鸿蒙智行', 尚界: '鸿蒙智行',
  红旗: '一汽', 吉利银河: '吉利', 远程: '吉利', 乐道: '蔚来'
};
const modelPatterns = [
  [/((?:20\d{2}\s*款)\s*[\u4e00-\u9fff]{0,10}\s*[A-Za-z]{0,10}\s*\d{1,4}[A-Za-z]{0,4})/iu],
  [/(MONA\s*[A-Za-z]\s*\d{2,3})/iu],
  [/(星享\s*[A-Za-z]?\s*\d{1,2}\s*[A-Za-z]?)/iu],
  [/(银河战舰\s*\d{2,4})/u],
  [/(银河星舰\s*\d{1,2})/u],
  [/(iCAR\s*[A-Za-z]?\s*\d{2,4})/iu],
  [/(猛士\s*[A-Za-z]?\s*\d{2,4})/iu],
  [/(ID\.?\s*ERA\s*\d\s*[A-Za-z]?)/iu],
  [/((?:红旗\s*)?天工\s*\d{2})/u],
  [/(方程豹?\s*钛\s*\d{1,2})/u],
  [/(方程豹?\s*鲨鱼(?:\s*皮卡)?)/u],
  [/(方程豹?\s*方程\s*[A-Za-z]+)/iu],
  [/(艾尼氪\s*[A-Za-z]\d{0,2})/iu],
  [/((?:第[一二三四五]代|全新一代|新一代|全新|新款)?\s*别克\s*(?:全新)?\s*君越)/u],
  [/(梦想家\s*\d{0,2})/u],
  [/((?:全新一代|新一代|第[一二三四五]代)\s*(?:比亚迪\s*)?(?:唐|汉|宋|秦))/u],
  [/(元\s*UP(?:\s*[\u4e00-\u9fff]{2,6}版)?)/iu],
  [/((?:新一代\s*)?Roadster)/iu],
  [/(Cybercab)/iu],
  [/(Model\s*[3YXS])/iu],
  [/((?:问界|智界|享界|尊界|尚界|极氪|蔚来|乐道|小鹏|小米|腾势|岚图|阿维塔|深蓝|启源|零跑|理想|红旗|银河|方程豹|仰望|智己|坦克|宝马|奔驰|大众|林肯|雪铁龙|纵横|风行)\s*[A-Za-z]{1,8}\s*[#.]?\s*\d{1,4}[A-Za-z]{0,4})/iu],
  [/(雪铁龙\s*\d[A-Za-z]{1,4})/iu],
  [/(坦克\s*\d{2,4})/u],
  [/(澎程\s*N\s*\d{2}(?:\s*(?:Pro|Max|探索版))?)/iu],
  [/(精灵\s*#\s*\d{1,2})/iu],
  [/([A-Za-z]{1,8}\s*[#.]?\s*\d{1,4}[A-Za-z]{0,4})/u],
  [/(钛\s*\d{1,2})/u]
];

function padDatePart(value) {
  return String(value).padStart(2, '0');
}
function formatDayText(iso) {
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}
function isPlaceholderPrice(value) {
  return !value || /价格待公布|以品牌公告为准|待公布/u.test(value);
}
function scrubLaunchNoise(text) {
  return cleanText(text)
    .replace(/\d+(?:\.\d+)?\s*万?\s*(?:-|—|－|~|至)\s*\d+(?:\.\d+)?\s*万元(?:起)?/gu, ' ')
    .replace(/\d+(?:\.\d+)?\s*万元(?:起)?/gu, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:万|元|公里|km|kwh|kw|%|台|辆|款|项|亿|家|个|毫米|mm|英寸|米)/giu, ' ')
    .replace(/(?:20\d{2}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日/gu, ' ')
    .replace(/20\d{2}\s*年/gu, ' ')
    .replace(/第\s*\d+\s*批/gu, ' ')
    .replace(/\d{1,2}\s*:\d{2}/gu, ' ');
}
function scrubModelSource(text) {
  return cleanText(scrubLaunchNoise(text).replace(/(?:正式上市|正式迎来上市|迎来正式上市|今日上市|现已上市|已经上市|已正式上市|官宣上市|即将登场|即将上市|谍照曝光|内饰谍照|申报图|全球首发|全球首秀|首次亮相|实车首次亮相|实车亮相|开启预售|开启盲订|开启预订|官宣|亮相|首秀|登场|上市|曝光|发布)/gu, ' '));
}
function acceptableModel(value) {
  const model = cleanText(value).replace(/^[—\-–|丨\s]+|[—\-–|丨\s]+$/gu, '');
  if (model.length < 2 || model.length > 32) return '';
  if (!/[A-Za-z\u4e00-\u9fff]/u.test(model)) return '';
  if (/^(?:SUV|MPV|轿车|新车|车型|首款|旗下)$/iu.test(model)) return '';
  if (/^[A-Z]{2,6}\s*\d{3,}$/u.test(model)) return '';
  return model.replace(/\s+/gu, ' ');
}
function extractModelName(title, summary) {
  for (const source of [title, summary]) {
    const text = scrubModelSource(source);
    for (const [pattern] of modelPatterns) {
      const match = text.match(pattern)?.[1];
      const model = acceptableModel(match);
      if (model) return model;
    }
  }
  return '';
}
function extractLaunchBrand(text, model, brands = []) {
  if (/Model\s*[3YXS]|Cybercab|Roadster/iu.test(model)) return /特斯拉|Tesla/iu.test(text) ? '特斯拉' : '';
  const source = `${text} ${model}`;
  for (const [brand, pattern] of displayBrands) {
    if (pattern.test(source)) return brand;
  }
  if (brands.length === 1) return brands[0];
  return mentionedMakers(source)[0] || brands[0] || '';
}
function completedLaunch(text) {
  const masked = withoutLaunchAnniversary(text)
    .replace(/(?:将于|将在|预计于|预计|计划于|计划|有望于|有望|拟于)[^。；;]{0,64}上市/gu, ' ')
    .replace(/即将(?:正式)?上市|即将登场/gu, ' ')
    .replace(/不(?:是|算|把|要|应|能|将)[^。；;]{0,32}上市/gu, ' ')
    .replace(/(?:并未|尚未|没有|未)[^。；;]{0,16}(?:确认|公布|写成)?[^。；;]{0,12}上市/gu, ' ');
  return /(?:正式上市|正式迎来上市|迎来正式上市|今日上市|现已上市|已经上市|已正式上市|官宣上市)(?!时间|日期|节点|与否)/u.test(masked);
}
function hasCalendarEvent(text) {
  const value = withoutLaunchAnniversary(text);
  if (/谍照|申报图/u.test(value) && hasSpecificModel(value)) return true;
  if (/申报/u.test(value) && hasSpecificModel(value) && !/征求意见|新规|综览|管理办法/u.test(value)) return true;
  if (/(?:正式上市|正式迎来上市|迎来正式上市|今日上市|现已上市|已经上市|已正式上市|官宣上市)/u.test(value)) return true;
  if (/官宣/u.test(value) && /新车|车型|登场|上市|亮相|首秀|SUV|轿车|MPV|跑车/u.test(value)) return true;
  if (/亮相|首秀|即将登场|即将上市/u.test(value) && (hasSpecificModel(value) || namesLaunchSubject(value))) return true;
  if (/开启预售|开启盲订|开启预订/u.test(value)) return true;
  if (/(?:将于|将在|预计|计划|有望|拟于)[^。]{0,32}上市/u.test(value)) return true;
  if (/(?:第?\s*[一二三四1-4]\s*季度|四季度|今年底|年底|年内)[^。]{0,8}上市/u.test(value)) return true;
  return false;
}
export function qualifiesForLaunchCalendar(text) {
  const value = cleanText(text);
  if (!value) return false;
  if (isTeaserText(value) || isPreviewTeaserText(value) || isHardTeaser(value)) return false;
  if (/IT早报|一周新车|新车预告|周预告|频道导语|大家好[，,\s]*现在是|本期内容我们/u.test(value)) return false;
  if (isPartnershipAnnouncement(value) || isEarningsReport(value) || isUserPortrait(value)) return false;
  if (/海外上市|欧洲上市/u.test(value) && !/国内[^。]{0,8}上市/u.test(value)) return false;
  if (/新车谍照\s*[丨|]/u.test(value)) return false;
  if (/携\s*(?:[两俩二三四五六七八九十]|\d+)\s*款/u.test(value)) return false;
  if (!isStrictNewCar(value)) return false;
  return hasCalendarEvent(value);
}
function inferLaunchStatus(text) {
  if (completedLaunch(text)) return 'launched';
  if (/(?:将于|将在|预计|计划|有望|拟于)[^。]{0,64}上市/u.test(text) || /(?:第?\s*[一二三四1-4]\s*季度|四季度|今年底|年底|年内)[^。]{0,8}上市/u.test(text)) return 'estimated';
  if (/官宣|开启预售|开启盲订|开启预订|即将登场|即将上市/u.test(text)) return 'confirmed';
  if (/亮相|首秀|登场/u.test(text) && !/谍照/u.test(text)) return 'confirmed';
  return 'estimated';
}
function inferLaunchKind(text, status, model) {
  const futureLaunch = /(?:将于|将在|预计|计划|有望)[^。]{0,64}上市/u.test(text);
  const namedLaunchDay = /\d{1,2}\s*月\s*\d{1,2}\s*日[^。]{0,16}上市/u.test(text);
  if (/谍照/u.test(text) && status !== 'launched' && !namedLaunchDay) return '谍照';
  if (/申报/u.test(text) && status !== 'launched' && !namedLaunchDay && !/(?:正式上市|官宣上市)/u.test(text)) return '申报';
  if (status === 'launched') {
    if (/换代|全新一代|新一代|第五代|第四代/u.test(text)) return '换代上市';
    if (/20\d{2}\s*款/u.test(`${model} ${text}`)) return '年款上市';
    if (/新增|加推/u.test(text) && /版/u.test(text)) return '新增版本';
    return '新车上市';
  }
  if (/全球首发|全球首秀/u.test(text) && !futureLaunch) return '全球首发';
  if (/亮相|首秀/u.test(text) && !futureLaunch && !/即将登场/u.test(text)) return '亮相';
  if (/20\d{2}\s*款/u.test(`${model} ${text}`) && /上市/u.test(text)) return '年款上市';
  if (status === 'estimated') return '计划上市';
  return '官宣';
}
function readPriceAmount(slice) {
  const listed = slice.match(/分别为\s*(\d+(?:\.\d+)?)\s*万元\s*(?:和|、|及)\s*(\d+(?:\.\d+)?)\s*万元/u);
  if (listed) return `${listed[1]}-${listed[2]}万元`;
  const rangedWan = slice.match(/(\d+(?:\.\d+)?)\s*万元\s*(?:-|—|－|~|至)\s*(\d+(?:\.\d+)?)\s*万元(起)?/u);
  if (rangedWan) return `${rangedWan[1]}-${rangedWan[2]}万元${rangedWan[3] || ''}`;
  const ranged = slice.match(/(\d+(?:\.\d+)?)\s*万?\s*(?:-|—|－|~|至)\s*(\d+(?:\.\d+)?)\s*万元(起)?/u);
  if (ranged) return `${ranged[1]}-${ranged[2]}万元${ranged[3] || ''}`;
  const single = slice.match(/(\d+(?:\.\d+)?)\s*万元(起)?/u);
  if (single) return `${single[1]}万元${single[2] || ''}`;
  return '';
}
function sanePrice(value) {
  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/gu)].map(match => Number(match[0]));
  return numbers.length > 0 && numbers.every(number => number >= 2 && number <= 500);
}
function extractLaunchPrice(text) {
  const current = text.split(/[。！？!?]/u).filter(sentence => !/此前|曾经|曾于|已经于|20(?:1\d|2[0-5])\s*年/u.test(sentence)).join('。');
  const labels = [
    ['', /官方指导价\s*(?:为|是)?/u],
    ['', /指导价\s*(?:为|是)?/u],
    ['', /(?:全国统一)?零售价\s*(?:为|是)?/u],
    ['', /售价\s*(?:为|是)?/u],
    ['', /上市价\s*(?:为|是)?/u],
    ['', /预售价\s*(?:为|是)?/u],
    ['限时焕新价', /(?:上市)?限时焕新价\s*(?:为|是)?/u],
    ['限时先享价', /(?:上市)?限时先享价\s*(?:为|是)?/u],
    ['限时权益价', /限时权益价\s*(?:为|是)?/u],
    ['限时专享价', /限时专享价\s*(?:为|是)?/u]
  ];
  for (const [prefix, pattern] of labels) {
    const start = current.search(pattern);
    if (start < 0) continue;
    const amount = readPriceAmount(current.slice(start, start + 64));
    if (!amount || !sanePrice(amount)) continue;
    return prefix ? `${prefix}${amount}` : amount;
  }
  return '';
}
function extractPowertrain(text) {
  const powers = [];
  if (/三种动力|多动力/u.test(text)) powers.push('多动力');
  else {
    if (/纯电/u.test(text)) powers.push('纯电');
    if (/增程/u.test(text)) powers.push('增程');
    if (/插电|插混|PHEV/iu.test(text)) powers.push('插混');
    if (!powers.length && /燃油|汽油/u.test(text)) powers.push('燃油');
  }
  let body = '';
  if (/硬派|越野/u.test(text)) body = '越野SUV';
  else if (/皮卡/u.test(text)) body = '皮卡';
  else if (/MPV/iu.test(text)) body = 'MPV';
  else if (/商务/u.test(text)) body = '商务车';
  else if (/轿跑/u.test(text)) body = '轿跑';
  else if (/跑车/u.test(text)) body = '跑车';
  else if (/SUV/iu.test(text)) body = 'SUV';
  else if (/轿车/u.test(text)) body = '轿车';
  if (!powers.length && !body) return '动力形式待公布';
  if (!powers.length) return body;
  if (!body) return powers.join(' / ');
  if (powers.length === 1) return `${powers[0]} ${body}`;
  return `${powers.join(' / ')} ${body}`;
}
function quarterNumber(token = '') {
  if (/1|一/.test(token)) return 1;
  if (/2|二/.test(token)) return 2;
  if (/3|三/.test(token)) return 3;
  if (/4|四/.test(token)) return 4;
  return 0;
}
function quarterLabel(index) {
  return ['', '第一季度', '第二季度', '第三季度', '第四季度'][index] || '';
}
function resolveMonthDay(yearText, month, day, publishedAt, future) {
  let year = yearText ? Number(yearText) : Number((publishedAt || '').slice(0, 4)) || 2026;
  let iso = `${year}-${padDatePart(month)}-${padDatePart(day)}`;
  if (!yearText && future && publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) && iso < publishedAt) {
    year += 1;
    iso = `${year}-${padDatePart(month)}-${padDatePart(day)}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return '';
  return iso;
}
function nearestDateBefore(text, eventRe) {
  const found = [];
  for (const match of text.matchAll(eventRe)) {
    const before = text.slice(Math.max(0, match.index - 36), match.index);
    const dates = [...before.matchAll(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu)];
    const nearest = dates.at(-1);
    if (!nearest) continue;
    const prefix = before.slice(Math.max(0, nearest.index - 8));
    found.push({
      year: nearest[1],
      month: nearest[2],
      day: nearest[3],
      event: match[0],
      future: /将于|将在|预计|计划|有望|拟于|定于|确认于/u.test(prefix),
      historical: /已于|此前|曾经|曾于|已经于/u.test(prefix),
      directed: /将于|将在|定于|确认于|拟于/u.test(prefix)
    });
  }
  return found;
}
function extractLaunchSchedule(text, publishedAt, status, kind) {
  const future = status !== 'launched';
  if (publishedAt && /昨[日天][^。]{0,16}(?:正式|官宣)?上市|(?:正式|官宣)?上市[^。]{0,8}昨[日天]/u.test(text)) {
    const date = previousDate(publishedAt);
    return { date, dateText: formatDayText(date), month: date.slice(0, 7), dateInferred: false };
  }
  if (publishedAt && /今[日天][^。]{0,12}(?:正式|官宣)?上市/u.test(text)) {
    return { date: publishedAt, dateText: formatDayText(publishedAt), month: publishedAt.slice(0, 7), dateInferred: false };
  }
  const launchDates = nearestDateBefore(text, /(?:国内|正式|完成|官宣)?上市/gu).filter(item => !item.historical).map(item => ({
    iso: resolveMonthDay(item.year, item.month, item.day, publishedAt, future || item.future),
    domestic: /国内/.test(item.event)
  })).filter(item => item.iso);
  const chosen = launchDates.find(item => item.domestic) || launchDates.at(-1);
  if (chosen) return { date: chosen.iso, dateText: formatDayText(chosen.iso), month: chosen.iso.slice(0, 7), dateInferred: false };
  if (status !== 'launched') {
    const appearance = nearestDateBefore(text, /(?:全球首发|全球首秀|首秀|亮相|登场)/gu).filter(item => item.directed && !item.historical).at(-1);
    if (appearance && !/(?:将于|将在|预计|计划)[^。]{0,64}上市/u.test(text)) {
      const iso = resolveMonthDay(appearance.year, appearance.month, appearance.day, publishedAt, true);
      if (iso) return { date: iso, dateText: formatDayText(iso), month: iso.slice(0, 7), dateInferred: false };
    }
  }
  if (status !== 'launched') {
    const scheduled = nearestDateBefore(text, /(?:开启全球预售|开启预售|开启预订|开启盲订|上新)/gu).filter(item => item.directed && !item.historical).at(-1);
    if (scheduled) {
      const iso = resolveMonthDay(scheduled.year, scheduled.month, scheduled.day, publishedAt, true);
      if (iso) return { date: iso, dateText: formatDayText(iso), month: iso.slice(0, 7), dateInferred: false };
    }
  }
  const quarter = text.match(/(?:(20\d{2})\s*年\s*)?(?:(今年|明年)\s*)?(?:第\s*)?([一二三四1-4])\s*季度/u);
  if (quarter) {
    const index = quarterNumber(quarter[3]);
    const year = quarter[1] ? Number(quarter[1]) : (quarter[2] === '明年' ? (Number((publishedAt || '').slice(0, 4)) || 2026) + 1 : (Number((publishedAt || '').slice(0, 4)) || 2026));
    if (index) {
      const month = `${year}-${padDatePart((index - 1) * 3 + 1)}`;
      return { dateText: `${quarterLabel(index)}（具体日期待官宣）`, month, dateInferred: false };
    }
  }
  const part = text.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(上旬|中旬|下旬|底)/u);
  if (part) {
    const year = part[1] || (publishedAt || '').slice(0, 4) || '2026';
    const month = `${year}-${padDatePart(part[2])}`;
    return { dateText: `${Number(part[2])}月${part[3]}（具体日期待官宣）`, month, dateInferred: false };
  }
  if (/今年底|年底|年内/u.test(text)) {
    const year = (publishedAt || '').slice(0, 4) || '2026';
    return { dateText: '年底（具体日期待官宣）', month: `${year}-12`, dateInferred: false };
  }
  if (status === 'launched' && publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) {
    return { date: publishedAt, dateText: formatDayText(publishedAt), month: publishedAt.slice(0, 7), dateInferred: true };
  }
  const month = (publishedAt || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  if (kind === '谍照') return { dateText: '谍照曝光（上市日期待官宣）', month, dateInferred: false };
  if (kind === '申报') return { dateText: '申报（上市日期待官宣）', month, dateInferred: false };
  if (kind === '亮相' || kind === '全球首发') return { dateText: '已亮相（上市日期待官宣）', month, dateInferred: false };
  return { dateText: '即将登场（具体日期待官宣）', month, dateInferred: false };
}
function launchObservation(status, kind, dateInferred) {
  if (dateInferred) return '原文未写明具体上市日，暂按报道日期归档；未写明的价格不估算。';
  if (status === 'launched') return '由日报新车事件自动写入；价格与上市日只取原文可追溯表述。';
  if (kind === '谍照' || kind === '申报') return '谍照或申报不是正式上市，未公布的价格与日期保持待定。';
  if (status === 'estimated') return '尚未看到正式上市报道，日历只保留原文写出的时间窗口。';
  return '已官宣但未形成可追溯的正式上市日；未公布价格记为待公布。';
}
function buildLaunchRecord(parts) {
  const title = cleanText(parts.title);
  const summary = cleanText(parts.summary);
  const detail = cleanText(parts.detail);
  const card = cleanText(`${title} ${summary}`);
  if (!parts.sourceUrl || !qualifiesForLaunchCalendar(card)) return null;
  const model = extractModelName(title, summary);
  const brand = extractLaunchBrand(card, model, parts.brands || []);
  if (!model || !brand) return null;
  const corpus = cleanText(`${card} ${detail}`);
  const status = inferLaunchStatus(corpus);
  const kind = inferLaunchKind(corpus, status, model);
  const schedule = extractLaunchSchedule(corpus, parts.publishedAt, status, kind);
  if (!schedule?.dateText || !/^\d{4}-\d{2}$/.test(schedule.month || '')) return null;
  const priceText = extractLaunchPrice(corpus) || (status === 'launched' ? '以品牌公告为准' : '价格待公布');
  const when = schedule.date || schedule.dateText;
  return {
    id: `launch-${hash(`${brandFamily[brand] || brand}|${launchModelKey(brand, model)}|${when}`)}`,
    origin: 'auto',
    month: schedule.month,
    ...(schedule.date ? { date: schedule.date } : {}),
    dateText: schedule.dateText,
    brand,
    model,
    kind,
    powertrain: extractPowertrain(corpus),
    priceText,
    status,
    statusLabel: launchStatusLabels[status],
    sourceName: parts.sourceName || '来源',
    sourceUrl: parts.sourceUrl,
    evidenceLabel: parts.evidenceLabel || '媒体报道',
    publishedAt: parts.publishedAt || schedule.month,
    detail: (detail || summary || title).slice(0, 420),
    observation: launchObservation(status, kind, schedule.dateInferred)
  };
}
function deriveLaunchFromGroup(story, group) {
  const candidates = [];
  const add = parts => {
    const row = buildLaunchRecord(parts);
    if (row) candidates.push(row);
  };
  add({
    title: story.title,
    summary: story.summary,
    detail: story.detail,
    brands: story.brands,
    sourceName: story.sourceName,
    sourceUrl: story.sourceUrl,
    evidenceLabel: story.evidenceLabel,
    publishedAt: story.publishedAt || story.issueDate
  });
  for (const entry of group || []) {
    const paragraphs = entry.article?.contentParagraphs || [];
    add({
      title: entry.article?.title || entry.editorialTitle || story.title,
      summary: paragraphs[0] || story.summary,
      detail: paragraphs.slice(0, 4).join('\n\n'),
      brands: entry.brands?.length ? entry.brands : story.brands,
      sourceName: entry.article?.sourceName,
      sourceUrl: entry.article?.url,
      evidenceLabel: evidenceLabels[entry.article?.evidenceStatus] || story.evidenceLabel,
      publishedAt: entry.article?.publishedAt || story.publishedAt
    });
  }
  return mergeLaunches(candidates, []);
}
export function deriveLaunchFromStory(story) {
  return deriveLaunchFromGroup(story, [])[0] || null;
}
function launchModelKey(brand, model) {
  let value = cleanText(model).toLowerCase().replace(/[\s#.·•\-]/gu, '');
  value = value.replace(/(?:全新一代|新一代|第五代|第四代|第[一二三四五]代|全新|新款)/gu, '').replace(/^20\d{2}款/u, '');
  const brandToken = cleanText(brand).toLowerCase().replace(/\s+/gu, '');
  if (brandToken && value.startsWith(brandToken) && value.length > brandToken.length + 1) value = value.slice(brandToken.length);
  const stripped = value.replace(/^(?:吉利银河|方程豹|比亚迪|红旗|理想|小鹏|蔚来|问界|智界|极氪|岚图|阿维塔|深蓝|启源|腾势|零跑|乐道|特斯拉|别克|宝马|大众|智己|远程)/iu, '');
  if (stripped && stripped !== value && /[a-z0-9\u4e00-\u9fff]/iu.test(stripped)) value = stripped;
  return value;
}
function sameLaunchVehicle(left, right) {
  const leftKey = launchModelKey(left.brand, left.model);
  const rightKey = launchModelKey(right.brand, right.model);
  if (!leftKey || !rightKey || leftKey !== rightKey) return false;
  const leftBrand = brandFamily[left.brand] || left.brand;
  const rightBrand = brandFamily[right.brand] || right.brand;
  return leftBrand === rightBrand || left.brand === right.brand || leftBrand === right.brand || rightBrand === left.brand;
}
function launchWindowToken(launch) {
  const text = launch.dateText || '';
  const year = (launch.month || launch.date || '').slice(0, 4);
  if (/第?四季度|Q4/iu.test(text)) return `${year}-Q4`;
  if (/第?三季度|Q3/iu.test(text)) return `${year}-Q3`;
  if (/第?二季度|Q2/iu.test(text)) return `${year}-Q2`;
  if (/第?[一1]季度|Q1/iu.test(text)) return `${year}-Q1`;
  const part = text.match(/(\d{1,2})\s*月\s*(上旬|中旬|下旬|底)/u);
  if (part) return `${year}-${part[1]}-${part[2]}`;
  if (/年底|年内/u.test(text)) return `${year}-year-end`;
  return '';
}
function launchWindowContains(launch, isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const [year, month, day] = isoDate.split('-').map(Number);
  const token = launchWindowToken(launch);
  const windowYear = Number((launch.month || isoDate).slice(0, 4));
  if (token.endsWith('-Q1')) return year === windowYear && month >= 1 && month <= 3;
  if (token.endsWith('-Q2')) return year === windowYear && month >= 4 && month <= 6;
  if (token.endsWith('-Q3')) return year === windowYear && month >= 7 && month <= 9;
  if (token.endsWith('-Q4')) return year === windowYear && month >= 10 && month <= 12;
  const part = (launch.dateText || '').match(/(\d{1,2})\s*月\s*(上旬|中旬|下旬|底)/u);
  if (part) {
    if (year !== windowYear || month !== Number(part[1])) return false;
    if (part[2] === '上旬') return day <= 10;
    if (part[2] === '中旬') return day >= 11 && day <= 20;
    return day >= 21;
  }
  if (token.endsWith('year-end')) return year === windowYear && month >= 10;
  return false;
}
function isOpenLaunchWindow(launch) {
  if (launch.date || launchWindowToken(launch)) return false;
  return /即将|待官宣|已亮相|谍照|申报|日期待|待公布/u.test(launch.dateText || '');
}
function launchTimingsCompatible(left, right) {
  const leftOpen = isOpenLaunchWindow(left);
  const rightOpen = isOpenLaunchWindow(right);
  if (leftOpen !== rightOpen) {
    const open = leftOpen ? left : right;
    const other = leftOpen ? right : left;
    const otherMonth = other.date?.slice(0, 7) || other.month;
    if (open.month && otherMonth && open.month !== otherMonth) return false;
  }
  if (left.date && right.date) return left.date === right.date;
  if (left.date && !right.date) return isOpenLaunchWindow(right) || launchWindowContains(right, left.date);
  if (right.date && !left.date) return isOpenLaunchWindow(left) || launchWindowContains(left, right.date);
  const leftToken = launchWindowToken(left);
  const rightToken = launchWindowToken(right);
  if (leftToken && rightToken) return leftToken === rightToken;
  if (isOpenLaunchWindow(left) || isOpenLaunchWindow(right)) return true;
  return (left.dateText || '') === (right.dateText || '');
}
function launchSpecificity(launch) {
  const timing = launch.date ? 120 : (launchWindowToken(launch) ? 20 : 0);
  return (launchStatusRank[launch.status] || 0) * 100
    + timing
    + (launchOriginRank[launch.origin] || 0) * 10
    + (launchEvidenceRank[launch.evidenceLabel] || 0) * 3
    + (isPlaceholderPrice(launch.priceText) ? 0 : 1);
}
function normalizeLaunch(launch, origin) {
  const month = launch.month || launch.date?.slice(0, 7);
  const dateText = launch.dateText || (launch.date ? formatDayText(launch.date) : '');
  return { ...launch, month, dateText, origin: launch.origin || origin };
}
function presentLaunch(launch) {
  const { origin, dateInferred, ...rest } = launch;
  if (!rest.date) delete rest.date;
  return rest;
}
function preferredModel(rows) {
  return rows.map(row => row.model).filter(model => model && model.length <= 40).sort((a, b) => b.length - a.length)[0];
}
function clusterLaunchRows(rows) {
  const groups = [];
  const byVehicle = new Map();
  for (const row of rows) {
    const key = `${brandFamily[row.brand] || row.brand}|${launchModelKey(row.brand, row.model)}`;
    const list = byVehicle.get(key) || [];
    list.push(row);
    byVehicle.set(key, list);
  }
  for (const list of byVehicle.values()) {
    const concrete = [];
    const open = [];
    for (const row of list) (isOpenLaunchWindow(row) ? open : concrete).push(row);
    const vehicleGroups = [];
    for (const row of concrete) {
      const group = vehicleGroups.find(items => items.some(item => sameLaunchVehicle(item, row) && launchTimingsCompatible(item, row)));
      if (group) group.push(row);
      else vehicleGroups.push([row]);
    }
    if (!vehicleGroups.length) {
      groups.push(list);
      continue;
    }
    for (const row of open) {
      const best = vehicleGroups.slice().sort((a, b) => Math.max(...b.map(launchSpecificity)) - Math.max(...a.map(launchSpecificity)))[0];
      best.push(row);
    }
    groups.push(...vehicleGroups);
  }
  return groups;
}
function mergeLaunchGroup(rows) {
  const ranked = rows.slice().sort((a, b) => launchSpecificity(b) - launchSpecificity(a));
  const winner = { ...ranked[0] };
  const model = preferredModel(rows);
  if (model) winner.model = model;
  if (isPlaceholderPrice(winner.priceText)) {
    const priced = ranked.find(item => !isPlaceholderPrice(item.priceText));
    if (priced) winner.priceText = priced.priceText;
  }
  if (!winner.date) {
    const dated = ranked.find(item => item.date && launchTimingsCompatible(winner, item));
    if (dated) {
      winner.date = dated.date;
      winner.dateText = dated.dateText || winner.dateText;
      winner.month = dated.month || dated.date.slice(0, 7);
      if (launchStatusRank[dated.status] > launchStatusRank[winner.status]) {
        winner.status = dated.status;
        winner.statusLabel = dated.statusLabel || launchStatusLabels[dated.status];
      }
    }
  }
  if (!winner.statusLabel) winner.statusLabel = launchStatusLabels[winner.status];
  return presentLaunch(winner);
}
export function mergeLaunches(derived, curated = []) {
  const rows = [
    ...(derived || []).map(item => normalizeLaunch(item, 'derived')),
    ...(curated || []).map(item => normalizeLaunch(item, 'curated'))
  ].filter(item => item && item.model && item.dateText && /^\d{4}-\d{2}$/.test(item.month || ''));
  const seen = new Set();
  const merged = clusterLaunchRows(rows).map(mergeLaunchGroup).sort((a, b) => (a.month || '').localeCompare(b.month || '') || (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31') || a.model.localeCompare(b.model, 'zh-CN'));
  for (const launch of merged) {
    if (!launch.id || seen.has(launch.id)) launch.id = `launch-${hash(`${launch.brand}|${launch.model}|${launch.date || launch.dateText}|${launch.sourceUrl}`)}`;
    seen.add(launch.id);
  }
  return merged;
}
