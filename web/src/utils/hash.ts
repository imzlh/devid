import type { PageKey } from "../types/api.ts";

export interface RouteState {
  page: PageKey;
  query: string;
  pageNum: number;
}

const validPages = new Set<PageKey>([
  "home",
  "search",
  "recent",
  "downloads",
  "sources",
]);
const MAX_RESTORED_PAGE = 50;
const MAX_QUERY_LENGTH = 200;

function normalizePageNum(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : /^\d+$/.test(String(value ?? "").trim())
    ? Number(String(value).trim())
    : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_RESTORED_PAGE);
}

function normalizeQuery(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_QUERY_LENGTH)
    : "";
}

function normalizePage(value: unknown): PageKey | null {
  return typeof value === "string" && validPages.has(value as PageKey)
    ? value as PageKey
    : null;
}

function currentHash(): string {
  return typeof globalThis.location?.hash === "string"
    ? globalThis.location.hash.replace(/^#/, "")
    : "";
}

function routeHistory():
  | { replaceState(data: unknown, unused: string, url?: string | URL | null): void }
  | null {
  const history = (globalThis as { history?: unknown }).history;
  if (!history || typeof history !== "object") return null;
  const replaceState = (history as { replaceState?: unknown }).replaceState;
  return typeof replaceState === "function"
    ? history as {
      replaceState(data: unknown, unused: string, url?: string | URL | null): void;
    }
    : null;
}

export function readRouteState(): RouteState | null {
  const raw = currentHash();
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const page = normalizePage(params.get("page"));
  if (!page) return null;

  return {
    page,
    query: normalizeQuery(params.get("search")),
    pageNum: normalizePageNum(params.get("pageNum")),
  };
}

export function writeRouteState(state: RouteState | unknown): void {
  if (!state || typeof state !== "object") return;
  const raw = state as Partial<RouteState>;
  const page = normalizePage(raw.page);
  if (!page) return;

  const params = new URLSearchParams();
  params.set("page", page);
  const query = normalizeQuery(raw.query);
  if (query && page === "search") {
    params.set("search", query);
  }
  const pageNum = normalizePageNum(raw.pageNum);
  if ((page === "home" || page === "search") && pageNum > 1) {
    params.set("pageNum", String(pageNum));
  }

  const next = params.toString();
  const history = routeHistory();
  if (currentHash() !== next && history) {
    history.replaceState(null, "", `#${next}`);
  }
}
