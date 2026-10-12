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
function samePublishedEvent(a, b) {
  if (a.issueDate !== b.issueDate) return false;
  if (a.note?.eventKey && b.note?.eventKey && a.note.eventKey !== b.note.eventKey) return false;
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
    const classificationText = [article.title, ...(article.contentParagraphs || [])]
      .join(' ')
      .replace(/#[^#\n]+#/gu, ' ')
      .slice(0, 420);
    const tags = classify(classificationText, article.evidenceStatus);
    const details = note.details || sourceDetails(article);
    let summary = note.summary
      ? normalizeRelativeTime(cleanText(note.summary).replace(/^(?:官方发布|政府公告|媒体报道)[：:]\s*/u, ''), issueDate)
      : sourceSummary(article, issueDate, editorialTitle);
    if (!summary || isTeaserText(summary)) {
      reviewQueue.push({ title: article.title, sourceName: article.sourceName, url: article.url, reasons: ['摘要只剩导语或电头'] });
      continue;
    }
    const lead = `${editorialTitle} ${summary}`;
    const story = {
      id, tags, title: normalizeRelativeTime(editorialTitle, issueDate),
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
