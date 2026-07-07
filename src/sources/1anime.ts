import assert from "node:assert";
import type { Element } from "dom";
import { findAvailableFast, getDocument, getImage } from "../utils/fetch.ts";
import { inferMediaFormat } from "../utils/media-format.ts";
import {
  BaseVideoSource,
  httpUrlOrEmpty,
  httpUrlOrFallback,
  ImageData,
} from "./index.ts";
import {
  IEpisode,
  ISeriesResult,
  IVideoItem,
  IVideoList,
  IVideoURL,
  URLProxy,
} from "../types/index.ts";
import { logInfo } from "../utils/logger.ts";

/**
 * var player_aaaa={"flag":"play","encrypt":0,"trysee":0,"points":0,"link":"\/bgmplay\/PEcDDE-1-1.html","link_next":"\/bgmplay\/PEcDDE-1-2.html","link_pre":"","vod_data":{"vod_name":"\u3010\u6211\u63a8\u7684\u5b69\u5b50\u3011 \u7b2c\u4e09\u5b63","vod_actor":"\u5e73\u5c71\u5bdb\u83dc","vod_director":"\u5e73\u7267\u5927\u8f85","vod_class":"\u756a\u52a8\u6f2b,\u65e5\u97e9\u52a8\u6f2b"},"url":"Doki-69741358ca4ebe01ed07a8d27c733c5db108cb2bc9a59c3d3ea655aa0ac56963500a9cd6227e36504a38f994050eeb80a1393b9a704053f450062c9ed8380706cb3db8f96815b214a22fc0ca851be93a","url_next":"Doki-69741358ca4ebe01ed07a8d27c733c5db108cb2bc9a59c3d3ea655aa0ac56963500a9cd6227e36504a38f994050eeb80a1393b9a704053f450062c9ed8380706046b8508d9c1cf10ab3600d5232ebf55","from":"YDY","server":"no","note":"","id":"PEcDDE","sid":1,"nid":1}
 */
interface IPlayerInfo {
  flag: string;
  encrypt: number;
  link_next: string;
  vod_data: {
    vod_name: string;
    vod_actor: string;
    vod_director: string;
    vod_class: string;
  };
  url: string;
  url_next: string;
  from: string;
  server: string;
  note: string;
  id: string;
  sid: number;
  nid: number;
}

export function lastChildHref(element: Element | null): string | undefined {
  if (!element?.children.length) return undefined;
  const last = element.children[element.children.length - 1];
  return last?.getAttribute("href") ?? undefined;
}

export function parseOneAnimeTotalPages(href: string | undefined): number {
  const match = href?.match(/-+(\d+)-+\.html$/);
  const page = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function resolveOneAnimePlayerUrl(
  info: Pick<IPlayerInfo, "encrypt" | "url">,
  pageUrl: string,
): string {
  let value: string;
  if (info.encrypt == 0) {
    value = info.url;
  } else if (info.encrypt == 1) {
    value = decodePlayerUrl(info.url);
  } else if (info.encrypt == 2) {
    value = decodePlayerUrl(atob(info.url));
  } else {
    throw new Error(`Unknown encrypt type ${info.encrypt}`);
  }

  return new URL(value, pageUrl).href;
}

function decodePlayerUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return unescape(value);
  }
}

export default class OneAnime extends BaseVideoSource {
  constructor() {
    super("1anime", "1Anime", "https://1anime.org/", true);
    this.imageAspectRatio = "9/16";
  }

  override async init(): Promise<void> {
    const doc = await getDocument(this.baseUrl);
    const links = doc.querySelectorAll(".links li > a[href]");
    const urlMap = new Map<string, string>();
    for (const link of links) {
      const href = link.getAttribute("href");
      const candidate = httpUrlOrEmpty(href, this.baseUrl);
      if (!candidate) continue;
      const url = new URL(candidate).host;
      urlMap.set(url, link.innerText.trim());
    }

    // try best
    const fastest = await findAvailableFast(
      urlMap.keys().map((e) => "https://" + e).toArray(),
    );
    assert(fastest, "No available server");
    this.baseUrl = fastest;
    logInfo(
      `1Anime: 使用最快的源 ${urlMap.get(fastest) ?? fastest} (${fastest})`,
    );
  }

  override async getHomeVideos(_page?: number): Promise<IVideoList> {
    const home = await getDocument(this.baseUrl);
    const vid: IVideoItem[] = [];
    for (const el of home.querySelectorAll("div.module-item")) {
      const link = el.querySelector("a[title]");
      const image = el.querySelector("img[data-src]");
      if (!link || !image) continue;
      // href="/voddetail/8603.html"
      const href = link.getAttribute("href");
      const thumbnail = image.getAttribute("data-src");
      const match = href?.match(/\/voddetail\/([A-Za-z0-9]+)\.html/);
      const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
      if (!href || !match || !itemUrl) continue;
      const title = image.getAttribute("alt") || link.getAttribute("title") ||
        link.textContent?.trim() || match[1];
      vid.push({
        thumbnail: httpUrlOrEmpty(thumbnail, this.baseUrl),
        title,
        url: itemUrl,
        source: this.sourceId,
        id: match[1],
        contentType: "series",
      });
    }
    return {
      videos: vid,
      currentPage: 1,
      totalPages: 1,
    };
  }

  override async getSeries(
    seriesId: string,
    url?: string,
  ): Promise<ISeriesResult | null> {
    // 优先使用传入的URL，否则根据ID构造URL
    const pageUrl = url ??
      new URL(`/voddetail/${seriesId}.html`, this.baseUrl).href;
    const doc = await getDocument(pageUrl);
    const ser: IEpisode[] = [];
    let total = 0;
    for (const group of doc.querySelectorAll("div.module-player-list")) {
      let ep = 1;
      for (const link of group.querySelectorAll("a[title]")) {
        // href="/vodplay/8603-1-2.html"
        const href = link.getAttribute("href");
        const match = href?.match(
          /\/vodplay\/([A-Za-z0-9]+-[0-9]+-[0-9]+)\.html/,
        );
        const episodeUrl = httpUrlOrEmpty(href, this.baseUrl);
        if (!href || !match || !episodeUrl) continue;
        ser.push({
          url: episodeUrl,
          id: match[1],
          title: link.textContent?.trim() || `第 ${ep} 集`,
          seriesId,
          episodeNumber: ep++,
        });
      }
      total = Math.max(total, ep - 1);
    }

    const img = doc.querySelector("div.module-item-pic img");
    const name = doc.querySelector("h1.page-title");
    const btn = doc.querySelector(".vod-detail-bnt a");
    const tags = doc.querySelectorAll(".tag-link > a[href]");
    const imageUrl = img?.getAttribute("data-src") ||
      img?.getAttribute("src") || "";
    const playUrl = btn?.getAttribute("href");

    const info: ISeriesResult = {
      thumbnail: httpUrlOrEmpty(imageUrl, this.baseUrl),
      title: name?.textContent?.trim() || seriesId,
      episodes: ser,
      seriesId,
      totalEpisodes: total,
      source: this.sourceId,
      id: seriesId,
      url: httpUrlOrFallback(playUrl, this.baseUrl, pageUrl),
      tags: Array.from(tags).map((e) => e.textContent?.trim()).filter((
        tag,
      ): tag is string => Boolean(tag)),
    };

    for (const item of doc.querySelectorAll(".video-info-items")) {
      const titleEl = item.querySelector(".video-info-itemtitle");
      if (!titleEl) continue;
      const title = titleEl.textContent?.replace(/[：:]$/, "").trim();
      switch (title) {
        case "剧情": {
          const contentEl = item.querySelector(".video-info-item");
          if (contentEl?.textContent) {
            info.description = contentEl.textContent.replace("展开", "").trim();
          }
          break;
        }
        case "备注": {
          const contentEl = item.querySelector(".video-info-item");
          if (contentEl?.textContent) {
            const text = contentEl.textContent.trim();
            if (text.includes("完结")) info.status = "completed";
            else if (text.includes("连载")) info.status = "ongoing";
            else if (text.includes("停更")) info.status = "hiatus";
          }
          break;
        }
        case "评分": {
          const contentEl = item.querySelector(".video-info-item");
          if (contentEl?.textContent) {
            const match = contentEl.textContent.match(/(\d+\.?\d*)分/);
            if (match) info.rating = parseFloat(match[1]);
          }
          break;
        }
        case "上映": {
          const contentEl = item.querySelector(".video-info-item");
          if (contentEl?.textContent) {
            const match = contentEl.textContent.match(/(\d{4})/);
            if (match) info.year = parseInt(match[1], 10);
          }
          break;
        }
      }
    }

    return info;
  }

  override async searchVideos(
    query: string,
    page: number = 1,
  ): Promise<IVideoList> {
    const doc = await getDocument(
      new URL(
        `/vodsearch/${encodeURIComponent(query)}----------${page}---.html`,
        this.baseUrl,
      ),
    );
    const res: IVideoItem[] = [];
    for (const el of doc.querySelectorAll(".module-items > div.module-item")) {
      const link = el.querySelector("a[title]");
      const img = el.querySelector(".module-item-pic > img[data-src]");

      if (!link || !img) continue;
      const href = link.getAttribute("href");
      const thumbnail = img.getAttribute("data-src");
      const match = href?.match(/\/voddetail\/([A-Za-z0-9]+)\.html/);
      const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
      if (!href || !match || !itemUrl) continue;
      res.push({
        thumbnail: httpUrlOrEmpty(thumbnail, this.baseUrl),
        title: link.getAttribute("title") || link.textContent?.trim() ||
          match[1],
        url: itemUrl,
        source: this.sourceId,
        id: match[1],
        contentType: "series",
      });
    }

    const totalPages = parseOneAnimeTotalPages(
      lastChildHref(doc.querySelector("div#page")),
    );
    return {
      currentPage: page ?? 1,
      totalPages,
      videos: res,
    };
  }

  override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const doc = await getDocument(url);
    const scr = doc.getElementsByTagName("script").find((e) =>
      e.innerText.includes("player_aaaa")
    )?.textContent;
    assert(scr, `Failed to get video url from ${url}`);
    const info = new Function(scr + ";return player_aaaa;")() as IPlayerInfo;
    const mediaUrl = resolveOneAnimePlayerUrl(info, url);
    const format = this.inferFormat(mediaUrl);
    return [{
      quality: "1080p",
      url: mediaUrl,
      format,
      proxy: format === "m3u8" ? URLProxy.LOCAL : URLProxy.NONE,
    }];
  }

  private inferFormat(src: string): IVideoURL["format"] {
    return inferMediaFormat(src);
  }

  override getImage(originalUrl: string): Promise<ImageData> {
    return getImage(originalUrl);
  }
}
