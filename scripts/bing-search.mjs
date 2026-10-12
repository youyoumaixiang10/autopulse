export function decodeBingHref(href) {
  try {
    const url = new URL(href, 'https://www.bing.com');
    const encoded = url.searchParams.get('u');
    if (encoded?.startsWith('a1')) {
      const decoded = Buffer.from(encoded.slice(2), 'base64').toString('utf8');
      if (/^https?:\/\//u.test(decoded)) return decoded;
    }
    if (url.hostname.endsWith('bing.com')) return '';
    return url.href;
  } catch { return ''; }
}

export function citeToUrl(cite) {
  const compact = String(cite || '').replace(/\s*›\s*/gu, '/').replace(/\s+/gu, '');
  if (!/^https?:\/\//u.test(compact)) return '';
  try { return new URL(compact).href; } catch { return ''; }
}

export function parseBingResults(html) {
  const results = [];
  const seen = new Set();
  const blocks = String(html || '').matchAll(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/giu);
  for (const block of blocks) {
    const chunk = block[1];
    const href = chunk.match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["']/iu)?.[1] || '';
    const title = chunk.match(/<h2\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/iu)?.[1]?.replace(/<[^>]+>/gu, '').trim() || '';
    const cite = chunk.match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/iu)?.[1]?.replace(/<[^>]+>/gu, '') || '';
    const url = decodeBingHref(href) || citeToUrl(cite);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url });
  }
  return results;
}
