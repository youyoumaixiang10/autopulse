const sixHoursMs = 6 * 60 * 60 * 1000;

// Media candidates often arrive without a publish date. Once the article body
// has been read, the cached date is what decides whether the page is still
// "today" and worth fetching again.
export function shouldReuseArticle(existing, item, now = Date.now(), today) {
  if (!existing?.contentParagraphs?.length) return false;
  const publishedAt = existing.publishedAt || item?.publishedAt || '';
  if (publishedAt && publishedAt < today) return true;
  const fetchedAt = Date.parse(existing.fetchedAt || '');
  return Number.isFinite(fetchedAt) && now - fetchedAt < sixHoursMs;
}

export function createSourceBudget(budgetMs = 90_000) {
  const spent = new Map();
  const skipped = new Map();
  return {
    blocked(sourceId) {
      return (spent.get(sourceId) || 0) >= budgetMs;
    },
    charge(sourceId, elapsedMs, useful) {
      if (useful) return spent.get(sourceId) || 0;
      const next = (spent.get(sourceId) || 0) + Math.max(0, elapsedMs);
      spent.set(sourceId, next);
      return next;
    },
    skip(sourceId) {
      skipped.set(sourceId, (skipped.get(sourceId) || 0) + 1);
    },
    snapshot() {
      const ids = new Set([...spent.keys(), ...skipped.keys()]);
      return [...ids].map(sourceId => ({
        sourceId,
        failureMs: spent.get(sourceId) || 0,
        skipped: skipped.get(sourceId) || 0,
        stopped: (spent.get(sourceId) || 0) >= budgetMs
      })).filter(item => item.failureMs || item.skipped);
    }
  };
}
