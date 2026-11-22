// Fixed work units keep output reproducible for a given resource class.
// Revision 1 carries forward the established Medium timing and search limits.
export const V3_POLICY_REVISION = 'automatic-1';
const AUTOMATIC = { visits: 8000, limit: 4, patience: 2, breadth: 2 };

// Historical policies remain available to direct generator callers for replay.
const LEGACY_SEARCH = {
  low: { visits: 0, limit: 1, patience: 1, breadth: 1 },
  medium: AUTOMATIC,
  high: { visits: 32000, limit: 10, patience: 4, breadth: 3 },
  ultra: { visits: 64000, limit: 24, patience: 7, breadth: 3 },
  max: { visits: 128000, limit: 48, patience: 12, breadth: 3 }
};

function searchPolicy(effort) {
  if (effort === undefined) return AUTOMATIC;
  if (!Object.hasOwn(LEGACY_SEARCH, effort)) throw Error('Unknown V3 effort.');
  return LEGACY_SEARCH[effort];
}

export function timingBreadth(effort) {
  return searchPolicy(effort).breadth;
}

export function effortBudget(effort, events, resourceClass = 'standard') {
  const policy = searchPolicy(effort);
  const visits = policy.visits * (resourceClass === 'compact' ? 0.4 : 1);
  return {
    limit: Math.min(policy.limit, 1 + Math.floor(visits / Math.max(events, 1))),
    patience: policy.patience
  };
}
