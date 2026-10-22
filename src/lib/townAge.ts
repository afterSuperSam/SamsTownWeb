const TOWN_FOUNDED_UTC = Date.UTC(2020, 6, 6);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Compare calendar dates instead of clock times so the count is timezone-safe.
export function getTownAgeDays(now = new Date()): number {
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((todayUtc - TOWN_FOUNDED_UTC) / DAY_IN_MS));
}
