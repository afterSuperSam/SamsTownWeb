const TOWN_FOUNDED_UTC = Date.UTC(2020, 6, 6);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// 按北京时间的自然日计算已同行天数，不受访问者所在时区影响。
export function getTownAgeDays(now = new Date()): number {
  const beijingDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayUtc = Date.UTC(beijingDate.getUTCFullYear(), beijingDate.getUTCMonth(), beijingDate.getUTCDate());
  return Math.max(0, Math.floor((todayUtc - TOWN_FOUNDED_UTC) / DAY_IN_MS));
}
