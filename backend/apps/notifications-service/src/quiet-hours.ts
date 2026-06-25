/**
 * True if `hour` falls inside the quiet window [start, end). Supports
 * wrap-around windows (e.g. 22 -> 8 spans midnight).
 */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) {
    return false;
  }
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
