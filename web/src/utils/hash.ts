import type { PageKey } from "../types/api";

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

export function readRouteState(): RouteState | null {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const page = params.get("page") as PageKey | null;
  if (!page || !validPages.has(page)) return null;

  const pageNum = Number(params.get("pageNum") || "1");
  return {
    page,
    query: params.get("search") || "",
    pageNum: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function writeRouteState(state: RouteState): void {
  const params = new URLSearchParams();
  params.set("page", state.page);
  if (state.query && state.page === "search") {
    params.set("search", state.query);
  }
  if ((state.page === "home" || state.page === "search") && state.pageNum > 1) {
    params.set("pageNum", String(state.pageNum));
  }

  const next = params.toString();
  if (window.location.hash.replace(/^#/, "") !== next) {
    window.history.replaceState(null, "", `#${next}`);
  }
}
