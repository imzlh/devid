export function parsePositiveInteger(value: unknown, fallback = 1): number {
  const parsed = typeof value === "number" ? value : parseIntNumberLike(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 1;
}

export function parseOptionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : parseFloatNumberLike(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIntNumberLike(value: unknown): number {
  const match = String(value ?? "").match(/[+-]?\d+/);
  return match ? parseInt(match[0], 10) : NaN;
}

function parseFloatNumberLike(value: unknown): number {
  const match = String(value ?? "").match(/[+-]?(?:\d+\.?\d*|\.\d+)/);
  return match ? Number(match[0]) : NaN;
}
