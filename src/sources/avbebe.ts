import { Document } from "dom";
import { IVideoItem, IVideoList, IVideoURL, URLProxy } from "../types/index.ts";
import { BaseVideoSource, httpUrlOrEmpty, ImageData } from "./index.ts";
import { getDocument, getImage } from "../utils/fetch.ts";
import { inferMediaFormat } from "../utils/media-format.ts";
import assert from "node:assert";

interface VideoSource {
  src: string;
  type?: string;
}

interface VideoDetail {
  sources: VideoSource[];
  id: string;
  fv_title: string;
  splash: string;
  duration: number;
}

export default class AvBebe extends BaseVideoSource {
  constructor() {
    super("avbebe", "AvBebe(强制使用代理)", "https://www.avbebe.love/");
  }

  override async init(): Promise<void> {
    // no need to init
  }

  private parsePage(doc: Document) {
    const res: IVideoItem[] = [];
    for (const item of doc.querySelectorAll("div.elementor-container")) {
      const link = item.querySelector("a.elementor-cta");
      const bgdiv = item.querySelector(
        "div.elementor-cta__bg-wrapper div.elementor-cta__bg[data-bg]",
      );
      const bg = bgdiv?.getAttribute("data-bg")?.match(/url\(([^\)]+)\)/)?.[1];
      const title = item.querySelector("h6.elementor-content-item");
      if (!link || !title) continue;
      // /archives/333401
      const href = link.getAttribute("href");
      const id = href?.match(/archives\/(\d+)\/?$/)?.[1];
      const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
      if (!href || !id || !itemUrl) continue;

      res.push({
        title: title.textContent?.trim() || id,
        url: itemUrl,
        thumbnail: httpUrlOrEmpty(bg, this.baseUrl),
        source: this.sourceId,
        id,
      });
    }
    return res;
  }

  override async getHomeVideos(): Promise<IVideoList> {
    const page = await getDocument(this.baseUrl, { useProxy: true });
    return {
      videos: this.parsePage(page),
      currentPage: 1,
      totalPages: 1,
    };
  }

  private parseSearchPage(doc: Document) {
    const res: IVideoItem[] = [];
    for (const item of doc.querySelectorAll("div.box_wrap")) {
      const img = item.querySelector("img[data-src]");
      const link = item.querySelector("a[href]");
      if (!img || !link) continue;
      const href = link.getAttribute("href");
      const thumbnail = img.getAttribute("data-src");
      const id = href?.match(/\/(\d+)\/?$/)?.[1];
      const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
      if (!href || !id || !itemUrl) continue;

      res.push({
        title: img.getAttribute("alt") || id,
        thumbnail: httpUrlOrEmpty(thumbnail, this.baseUrl),
        url: itemUrl,
        source: this.sourceId,
        id,
      });
    }
    return res;
  }

  override async searchVideos(
    query: string,
    _page?: number,
  ): Promise<IVideoList> {
    const url = new URL(`/?s=${encodeURIComponent(query)}`, this.baseUrl);
    const pageDoc = await getDocument(url, { useProxy: true });
    const videos = this.parseSearchPage(pageDoc);
    return {
      videos,
      currentPage: 1,
      totalPages: 1,
    };
  }

  override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const page = await getDocument(url, { useProxy: true });
    const mainDiv = page.querySelector("div.flowplayer[data-item]");
    assert(mainDiv, "main div not found");
    const dataItem = mainDiv.getAttribute("data-item");
    assert(dataItem, "Video data not found");
    const json = JSON.parse(dataItem) as Partial<VideoDetail>;
    assert(Array.isArray(json.sources), "Video sources not found");

    return json.sources
      .filter((s): s is VideoSource =>
        typeof s?.src === "string" && s.src.trim().length > 0
      )
      .flatMap((s) => {
        const mediaUrl = httpUrlOrEmpty(s.src.trim(), url);
        if (!mediaUrl) return [];
        return {
          url: mediaUrl,
          format: this.inferFormat(mediaUrl, s.type),
          quality: "720p",
          proxy: URLProxy.REMOTE,
        };
      });
  }

  private inferFormat(src: string, type?: string): IVideoURL["format"] {
    return inferMediaFormat(src, type);
  }

  override getImage(originalUrl: string): Promise<ImageData> {
    return getImage(originalUrl, { useProxy: true });
  }
}
