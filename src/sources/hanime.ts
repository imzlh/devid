import assert from "node:assert";
import { IVideoItem, IVideoList, IVideoURL, URLProxy } from "../types/index.ts";
import { getDocument, getImage } from "../utils/fetch.ts";
import { inferMediaFormat } from "../utils/media-format.ts";
import { BaseVideoSource, httpUrlOrEmpty, ImageData } from "./index.ts";
import { Document } from "dom";

export function parseHAnimePagination(value?: string): [number, number] {
  const [currentRaw, totalRaw] = value?.split("/") ?? [];
  const current = parseInt(currentRaw?.trim() ?? "", 10);
  const total = parseInt(totalRaw?.trim() ?? "", 10);
  return [
    Number.isFinite(current) && current > 0 ? current : 1,
    Number.isFinite(total) && total > 0 ? total : 1,
  ];
}

export default class HAnime extends BaseVideoSource {
  constructor() {
    super("hanime", "HAnime(强制使用代理)", "https://hanime1.me");
  }

  override async init(): Promise<void> {
    // No initialization needed
  }

  private parsePage(doc: Document) {
    const res: IVideoItem[] = [];
    for (const item of doc.querySelectorAll(".video-item-container[title]")) {
      // 过滤广告
      if (item.querySelector(".stat-item")?.innerText.trim() === "赞助商") {
        continue;
      }

      const title = item.getAttribute("title")?.trim();
      const link = item.querySelector("a.video-link")?.getAttribute("href")
        ?.trim();
      const img = item.querySelector("img.main-thumb")?.getAttribute("src")
        ?.trim();
      const dur = item.querySelector(".duration")?.innerText;
      if (!link || !img) continue;
      const itemUrl = httpUrlOrEmpty(link, this.baseUrl);
      if (!itemUrl) continue;
      const id = link.split("/").filter(Boolean).pop();
      if (!id) continue;

      res.push({
        id,
        title: title || id,
        thumbnail: httpUrlOrEmpty(img, this.baseUrl),
        duration: dur,
        url: itemUrl,
        source: this.sourceId,
        contentType: "video",
      });
    }
    return res;
  }

  override async getHomeVideos(): Promise<IVideoList> {
    const doc = await getDocument(new URL("/", this.baseUrl), {
      useProxy: true,
    });
    const videos = this.parsePage(doc);
    return {
      videos: videos,
      currentPage: 1,
      totalPages: 1,
    };
  }

  override async searchVideos(
    query: string,
    _page?: number,
  ): Promise<IVideoList> {
    const res = await getDocument(
      new URL("/search?query=" + encodeURIComponent(query), this.baseUrl).href,
      { useProxy: true },
    );
    const videos = this.parsePage(res);
    const indicator = res.querySelector(".skip-page-wrapper");
    const [cur, total] = parseHAnimePagination(indicator?.innerText);
    return {
      videos: videos,
      currentPage: cur,
      totalPages: total,
    };
  }

  override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const doc = await getDocument(url, { useProxy: true });
    const vid = doc.querySelector("video[poster]");
    assert(vid, "Video element not found");

    const results: IVideoURL[] = [];
    for (const source of vid.getElementsByTagName("source")) {
      const src = source.getAttribute("src")?.trim();
      if (!src) continue;
      const mediaUrl = httpUrlOrEmpty(src, url);
      if (!mediaUrl) continue;
      const size = source.getAttribute("size")?.trim();
      results.push({
        quality: size ? `${size}p` : "默认",
        url: mediaUrl,
        format: this.inferFormat(
          mediaUrl,
          source.getAttribute("type") ?? undefined,
        ),
        proxy: URLProxy.REMOTE,
      });
    }
    return results;
  }

  private inferFormat(src: string, type?: string): IVideoURL["format"] {
    return inferMediaFormat(src, type);
  }

  override getImage(originalUrl: string): Promise<ImageData> {
    return getImage(originalUrl, { useProxy: true });
  }
}
