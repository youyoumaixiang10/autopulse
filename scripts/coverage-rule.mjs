const healthy = result => result?.status === 'ok' || (result?.status === 'no-recent-updates' && result.listRead === true);
const available = result => healthy(result) || result?.status === 'partial';

export function brandCoverageState({ officialStatuses = [], socialStatuses = [], discoveryStatuses = [] } = {}) {
  const officialReady = officialStatuses.some(healthy);
  const discoveryReady = discoveryStatuses.some(available);
  if (officialReady && discoveryReady) return 'complete';
  if (officialReady || discoveryReady || socialStatuses.some(available)) return 'partial';
  return 'unavailable';
}

export function freePathReady({ brands = [], policy = [] } = {}) {
  return brands.some(brand => (brand.officialStatuses || []).some(healthy)) || policy.some(healthy);
}
