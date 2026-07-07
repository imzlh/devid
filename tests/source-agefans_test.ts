import { assertEquals, assertExists } from "@std/assert";
import { DOMParser, type Element } from "dom";
import AGEFans, {
  normalizeAgefansInfoLabel,
  parseAgefansYear,
} from "../src/sources/agefans.ts";
import type { IVideoItem } from "../src/types/index.ts";

type TestableAGEFans = {
  baseUrl: string;
  extractFromHtml(el: Element): IVideoItem | null;
  extractCataVideoFromHtml(el: Element): IVideoItem | null;
};

function parseElement(html: string, selector: string): Element {
  const doc = new DOMParser().parseFromString(html, "text/html");
  assertExists(doc);
  const element = doc.querySelector(selector);
  assertExists(element);
  return element;
}

Deno.test("AGEFans normalizes info labels and invalid years", () => {
  assertEquals(normalizeAgefansInfoLabel("动画种类："), "动画种类");
  assertEquals(normalizeAgefansInfoLabel("剧情类型: "), "剧情类型");
  assertEquals(parseAgefansYear("2024-01-01"), 2024);
  assertEquals(parseAgefansYear("not a date"), undefined);
});

Deno.test("AGEFans extracts multi-digit episode counts from home cards", () => {
  const source = new AGEFans() as unknown as TestableAGEFans;
  source.baseUrl = "https://age.example";
  const element = parseElement(
    `
    <article class="video_item">
      <a href="/detail/season-12">Title</a>
      <img data-original="/cover.jpg">
      <div class="video_item--info">第 12 集</div>
    </article>
    `,
    ".video_item",
  );

  const item = source.extractFromHtml(element);
  assertExists(item);
  assertEquals(item.id, "season-12");
  assertEquals(item.source, "agefans");
  assertEquals(item.seriesInfo?.totalEpisodes, 12);
});

Deno.test("AGEFans extracts catalog series metadata after removing label punctuation", () => {
  const source = new AGEFans() as unknown as TestableAGEFans;
  source.baseUrl = "https://age.example";
  const element = parseElement(
    `
    <article class="cata_video_item">
      <h3 class="card-title"><a href="/detail/show-1">Show One</a></h3>
      <img data-original="/show.jpg">
      <div class="video_detail_info"><span>动画种类：</span>TV</div>
      <div class="video_detail_info"><span>原版名称：</span>Original Show</div>
      <div class="video_detail_info"><span>播放状态：</span>连载</div>
      <div class="video_detail_info"><span>首播时间：</span>2025-04-01</div>
      <div class="video_detail_info"><span>剧情类型：</span>奇幻 冒险</div>
    </article>
    `,
    ".cata_video_item",
  );

  const item = source.extractCataVideoFromHtml(element);
  assertExists(item);
  assertEquals(item.source, "agefans");
  assertEquals(item.seriesInfo?.type, "anime");
  assertEquals(item.seriesInfo?.originalTitle, "Original Show");
  assertEquals(item.seriesInfo?.status, "ongoing");
  assertEquals(item.seriesInfo?.year, 2025);
  assertEquals(item.seriesInfo?.tags, ["奇幻", "冒险"]);
});
