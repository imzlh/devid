import { assertEquals } from "@std/assert";
import { readRouteState, writeRouteState } from "../web/src/utils/hash.ts";

function withLocationHash<T>(hash: string, fn: () => T): T {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  const state = { hash };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: state,
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    value: {
      replaceState(_data: unknown, _unused: string, url: string) {
        state.hash = new URL(url, "https://app.example.test/").hash;
      },
    },
  });
  try {
    return fn();
  } finally {
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    } else {
      delete (globalThis as { location?: unknown }).location;
    }
    if (originalHistory) {
      Object.defineProperty(globalThis, "history", originalHistory);
    } else {
      delete (globalThis as { history?: unknown }).history;
    }
  }
}

Deno.test("web hash route parser rejects malformed pages and clamps page numbers", () => {
  assertEquals(
    withLocationHash("#page=search&search=%20test%20&pageNum=999", () =>
      readRouteState()
    ),
    { page: "search", query: "test", pageNum: 50 },
  );
  assertEquals(
    withLocationHash("#page=bad&search=test&pageNum=2", () => readRouteState()),
    null,
  );
  assertEquals(
    withLocationHash("#page=home&pageNum=0", () => readRouteState()),
    { page: "home", query: "", pageNum: 1 },
  );
});

Deno.test("web hash writer ignores malformed state and normalizes search routes", () => {
  withLocationHash("#page=home", () => {
    writeRouteState({ page: "bad", query: "x", pageNum: 2 });
    assertEquals(globalThis.location.hash, "#page=home");

    writeRouteState({ page: "search", query: "  anime  ", pageNum: 999 });
    assertEquals(globalThis.location.hash, "#page=search&search=anime&pageNum=50");

    writeRouteState({ page: "downloads", query: "ignored", pageNum: 3 });
    assertEquals(globalThis.location.hash, "#page=downloads");
  });
});

Deno.test("web hash utilities tolerate non-browser environments", () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  try {
    delete (globalThis as { location?: unknown }).location;
    delete (globalThis as { history?: unknown }).history;
    assertEquals(readRouteState(), null);
    writeRouteState({ page: "home", query: "", pageNum: 1 });
  } finally {
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    }
    if (originalHistory) {
      Object.defineProperty(globalThis, "history", originalHistory);
    }
  }
});
