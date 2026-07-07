import { assertEquals } from "@std/assert";
import {
  clearRecentVideos,
  getProgressPercent,
  getRecentVideos,
  saveProgress,
} from "../web/src/utils/progress.ts";

const STORAGE_KEY = "vdown:web:progress";

Deno.test("web progress store filters malformed recent video URLs", () => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bad: {
          time: 30,
          duration: 120,
          updatedAt: Date.now(),
          video: {
            id: "bad",
            source: "source-a",
            title: "Bad",
            url: "javascript:alert(1)",
            thumbnail: "javascript:alert(1)",
          },
        },
        good: {
          time: 40,
          duration: 120,
          updatedAt: Date.now(),
          video: {
            id: "good",
            source: "source-a",
            title: "Good",
            url: " https://site.example.test/watch ",
            thumbnail: "javascript:alert(1)",
          },
        },
      }),
    );

    assertEquals(getRecentVideos(), [
      {
        id: "good",
        source: "source-a",
        title: "Good",
        url: "https://site.example.test/watch",
        thumbnail: "",
        duration: undefined,
        views: undefined,
        uploadTime: undefined,
        contentType: undefined,
      },
    ]);
    assertEquals(getProgressPercent("good"), 33);
  } finally {
    clearRecentVideos();
  }
});

Deno.test("web progress save ignores invalid video URLs", () => {
  try {
    saveProgress(
      {
        id: "bad-save",
        source: "source-a",
        title: "Bad Save",
        url: "javascript:alert(1)",
        thumbnail: "",
      },
      30,
      120,
    );

    assertEquals(getRecentVideos(), []);
  } finally {
    clearRecentVideos();
  }
});
