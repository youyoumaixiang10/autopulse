import { load } from 'cheerio';
import { cleanText, safeUrl } from './content-utils.mjs';

const selectors = {
  'avatr-news': '[class*="News_page-box__content"]',
  'li-auto-news': '#article',
  'byd-news': '.cmp-news__detail-content .news-text',
  'miit': '#con_con',
  'onvo-about': '[class*="_id__content"]',
  'autohome-news': '[class*="Article_Wrap_Box"], #articleContent, .article-content',
  'autohome-industry': '[class*="Article_Wrap_Box"], #articleContent, .article-content',
  'sina-auto': '.article-content',
  'ithome-auto': '.post_content',
  'caijing-auto': '.article-content',
  'gasgoo-auto': '.contentDetailed, .article-content',
  'pcauto-news': '.artText, .article-content, #content',
  'sohu-auto': '#mp-editor, .text, article',
  'netease-auto': '.post_body, #endText, .post_text',
  'ifeng-auto': '.text-3w, .article-content, article',
  'news18a-auto': '.news-content, .article-content, article',
  'yiche-news': '.news-detail, .article-content, article',
  'cailianpress-auto': '.detail-telegraph, .detail-content, article',
  'dongchedi-news': 'article, .article-content'
};

export function extractArticle(html, candidate) {
  const $ = load(html);
  let props = {};
  try { props = JSON.parse($('#__NEXT_DATA__').text() || '{}').props?.pageProps || {}; } catch { /* Use the article DOM when embedded data is absent. */ }
  const media = props.articleInfoInfo?.content;
  const onvo = props.newsItem;
  const meta = name => $(`meta[name="${name}"], meta[property="${name}"]`).attr('content');
  const bodyHtml = media?.content || onvo?.content;
  const body = bodyHtml ? load(bodyHtml)('body') : $(selectors[candidate.sourceId] || 'article, main').first();
  body.find('script,style,nav,footer,form').remove();
  body.find('br').replaceWith(' ');
  const paragraphs = body.find('p').map((_, element) => cleanText($(element).text())
    .replace(/^\[汽车之家[^\]]*\]\s*/u, '')
    .replace(/\(参数\|询价\)/gu, '')).get().filter(text => text.length >= 15);
  const paragraphFallback = paragraphs.length ? paragraphs : [cleanText(body.text())].filter(text => text.length >= 30);
  const sinaDate = candidate.sourceId === 'sina-auto'
    ? $('.main-content').first().text().match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/u)?.[0]
    : null;
  const ithomeDate = candidate.sourceId === 'ithome-auto'
    ? $('.fl.content').first().text().match(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}:\d{2}/u)?.[0]?.replace(/\/(\d)(?=\/)/u, '/0$1').replace(/\/(\d)\s/u, '/0$1 ')
    : null;
  const caijingDate = candidate.sourceId === 'caijing-auto'
    ? $('.article').first().text().match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/u)?.[0]
    : null;
  const rawDate = sinaDate || ithomeDate || caijingDate || media?.publishDate || onvo?.publish_time_str || meta('PubDate') || meta('article:published_time') || $('.cmp-news__detail-date').text().match(/\d{4}-\d{2}-\d{2}[\s\d:]*/)?.[0] || candidate.publishedAt;
  const publishedAt = String(rawDate || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null;
  const title = cleanText(media?.title || onvo?.title || meta('ArticleTitle') || candidate.title);
  const links = body.find('a[href]').map((_, element) => ({ title: cleanText($(element).text()), url: safeUrl($(element).attr('href'), candidate.url) })).get().filter(link => link.title && link.url);
  return {
    title, publishedAt, publishedTime: rawDate || null,
    contentParagraphs: [...new Set(paragraphFallback)],
    author: media?.authorName || meta('Author') || '',
    mediaOriginal: media?.type === '原创',
    linkedSources: [...new Map(links.map(link => [link.url, link])).values()]
  };
}
