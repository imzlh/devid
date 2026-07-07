import { BaseVideoSource, ImageData } from "./index.ts";
import { IVideoItem, IVideoList, IVideoURL, URLProxy } from "../types/index.ts";
import {
  fetch2,
  findAvailableFast,
  getDocument,
  getImage as fetchImage,
} from "../utils/fetch.ts";
import { Document, DOMParser } from "dom";
import { logError, logInfo } from "../utils/logger.ts";
import assert from "node:assert";
import { inferMediaFormat } from "../utils/media-format.ts";
import { parsePositiveInteger } from "../utils/number.ts";

interface GG51VideoItem {
  view_key: string;
  title: string;
  poster: string;
  duration: number;
  price: number;
  price_vip: number;
  is_vip: number;
  tags: string[];
  play_url: string;
  hits: string;
}

export function resolveGG51MediaUrl(value: string, pageUrl: string): string {
  const mediaUrl = new URL(value, pageUrl);
  if (mediaUrl.protocol !== "http:" && mediaUrl.protocol !== "https:") {
    throw new Error(`不支持的播放地址协议: ${mediaUrl.protocol}`);
  }
  return mediaUrl.href;
}

function gg51HttpUrlOrEmpty(value: unknown, baseUrl: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return resolveGG51MediaUrl(value.trim(), baseUrl);
  } catch {
    return "";
  }
}

export function buildGG51VideoItem(
  item: Partial<GG51VideoItem> | null | undefined,
  baseUrl: string,
  sourceId: string,
): IVideoItem | null {
  if (!item || typeof item.play_url !== "string" || !item.play_url.trim()) {
    return null;
  }
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const id = typeof item.view_key === "string" ? item.view_key.trim() : "";
  if (!title || !id) return null;

  const url = gg51HttpUrlOrEmpty(item.play_url, baseUrl);
  if (!url) return null;

  return {
    id,
    title,
    thumbnail: gg51HttpUrlOrEmpty(item.poster, baseUrl),
    duration: item.duration == null ? undefined : item.duration.toString(),
    url,
    source: sourceId,
  };
}

// GG51视频源实现
export default class GG51VideoSource extends BaseVideoSource {
  private resolvedBaseUrl: string = "";

  constructor() {
    super("gg51", "GG51", "https://gg51.com");
  }

  // 初始化视频源 - 解析真实的主域名
  async init(): Promise<void> {
    logInfo(`初始化视频源: ${this.sourceName}`);

    // 获取主页内容
    const decodedContent = await this.getEncodedPage(this.baseUrl);
    const parser = new DOMParser();
    const document = parser.parseFromString(decodedContent, "text/html");
    const urls = Array.from(document.querySelectorAll(".ulist-url"))
      .map((el) => el.innerText);
    const available = await findAvailableFast(urls);

    // 验证是否成功解析到有效域名
    assert(available, "无法解析到有效域名");
    this.resolvedBaseUrl = available;
    logInfo(`解析到真实域名: ${this.resolvedBaseUrl}`);
  }

  private async getEncodedPage(url: string): Promise<string> {
    const response = await getDocument(url);
    const mainScript = response.getElementsByTagName("script")
      .find((e) => e.innerText.length > 1000);
    assert(mainScript, "无法找到页面解码脚本");

    // start a sandbox
    return new Promise((rs) => {
      const document = {
        write: (text: string) => rs(text),
      };
      new Function("document", mainScript.innerText)(document);
    });
  }

  // 获取主页视频列表
  async getHomeVideos(page: number = 1): Promise<IVideoList> {
    // 确保已经初始化
    if (!this.resolvedBaseUrl) {
      throw new Error("视频源未初始化，请先调用 init() 方法");
    }

    // 第一页直接从主页解析
    if (page === 1) {
      // 构建分页URL
      const homeUrl = this.resolvedBaseUrl;
      const encodedPage = await this.getEncodedPage(homeUrl);

      // 解析HTML内容
      const parser = new DOMParser();
      const document = parser.parseFromString(encodedPage, "text/html");

      // 由于无法直接获取总页数，我们设置一个合理的默认值
      // 实际分页通过"加载更多"方式实现
      return {
        videos: this.parsePage(document),
        currentPage: page,
        totalPages: 50, // 设置一个较大的默认值，实际通过API动态加载
      };
    } else {
      // 后续页面通过API加载
      return await this.loadMoreVideos(page);
    }
  }

  private parsePage(document: Document): IVideoItem[] {
    // 提取视频列表
    const videoElements = document.querySelectorAll('a[href^="/view/"]');
    const videos: IVideoItem[] = [];

    for (const element of videoElements) {
      // 跳过广告链接
      if (element.getAttribute("target") === "_blank") {
        continue;
      }

      const imgElement = element.querySelector("img");
      const thumbnail = imgElement?.getAttribute("data-original") ||
        imgElement?.getAttribute("src") || "";

      const durationScript = Array.from(element.querySelectorAll("script"))
        .find((e) => e.innerText.includes("secondsToHMS("));
      const duration = durationScript?.innerText?.match(/secondsToHMS\((\d+)\)/)
        ?.[1];
      durationScript?.remove();

      const href = element.getAttribute("href") || "";
      const title = element.innerText.trim();
      const itemUrl = gg51HttpUrlOrEmpty(href, this.resolvedBaseUrl);

      if (itemUrl && title) {
        videos.push({
          id: href.replace("/view/", ""),
          title,
          thumbnail: gg51HttpUrlOrEmpty(thumbnail, this.resolvedBaseUrl),
          duration,
          url: itemUrl,
          source: this.sourceId,
        });
      }
    }
    return videos;
  }

  private async getMore(id: string, referer: string, page: number = 1) {
    // 通过API获取更多视频
    const response = await fetch2(
      new URL(`/data/getlistbyid`, this.resolvedBaseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": referer,
          "Origin": this.resolvedBaseUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          "_csrf": "",
          "id": id,
          "page": page.toString(),
        }),
      },
    );

    const data = await response.json();
    const videos: IVideoItem[] = [];

    // 解析返回的内容
    if (Array.isArray(data.listData)) {
      for (const item of data.listData as GG51VideoItem[]) {
        const video = buildGG51VideoItem(
          item,
          this.resolvedBaseUrl,
          this.sourceId,
        );
        if (video) {
          videos.push(video);
        }
      }
    }
    return videos;
  }

  // 通过API加载更多视频
  async loadMoreVideos(page: number): Promise<IVideoList> {
    try {
      // 获取首页以找到loadMore2函数中的id
      const homeUrl = this.resolvedBaseUrl;
      const encodedPage = await this.getEncodedPage(homeUrl);

      // 查找所有loadMore2调用中的id，页面可能有多处
      const loadMoreMatches = encodedPage.match(
        /loadMore2\((\d+),\s*\$\(this\)\)/g,
      );
      assert(
        loadMoreMatches && loadMoreMatches.length > 0,
        "未找到loadMore2调用",
      );

      const videos: IVideoItem[] = [];
      for (const match of loadMoreMatches) {
        const idMatch = match.match(/loadMore2\((\d+),/);
        if (idMatch) {
          const id = idMatch[1];
          const moreVideos = await this.getMore(id, homeUrl, page);
          videos.push(...moreVideos);
        }
      }

      // 如果没有更多视频，表示已到最后一页
      const isLastPage = videos.length === 0;

      return {
        videos,
        currentPage: page,
        totalPages: isLastPage ? page : 50, // 如果是最后一页，设置总页数为当前页
      };
    } catch (error) {
      logError("加载更多视频失败:", error);
      return {
        videos: [],
        currentPage: page,
        totalPages: page, // 出错时返回空列表，并设置总页数为当前页
      };
    }
  }

  // 搜索视频
  async searchVideos(query: string, page: number = 1): Promise<IVideoList> {
    // 构建搜索URL，支持分页
    let searchUrl =
      new URL(`/search/${encodeURIComponent(query)}`, this.resolvedBaseUrl)
        .href;
    if (page > 1) {
      searchUrl += `/${page}`;
    }

    const decodedContent = await this.getEncodedPage(searchUrl);
    const parser = new DOMParser();
    const document = parser.parseFromString(decodedContent, "text/html");

    const totalPagesEl = document.querySelector("form > div > span");
    assert(totalPagesEl, "无法解析总页数");
    const totalPages = totalPagesEl.textContent?.match(/\d+/)?.[0];
    return {
      videos: this.parsePage(document),
      currentPage: page,
      totalPages: parsePositiveInteger(totalPages, 1),
    };
  }

  // 解析视频链接
  async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const fullUrl = new URL(url, this.resolvedBaseUrl).href;

    // 解析重定向后的页面内容
    const decodedContent = await this.getEncodedPage(fullUrl);

    // 查找initPlayer函数调用
    const playerMatch = decodedContent.match(/initPlayer\("([^"]+)"\)/);
    if (!playerMatch) {
      throw new Error("无法找到播放器链接");
    }

    const mediaUrl = resolveGG51MediaUrl(playerMatch[1], fullUrl);

    return [{
      url: mediaUrl,
      quality: "高清",
      resolution: "1920x1080",
      format: inferMediaFormat(mediaUrl),
      proxy: URLProxy.LOCAL,
    }];
  }

  // 获取图片数据
  override async getImage(originalUrl: string): Promise<ImageData> {
    // 使用URL构造函数正确处理相对路径
    let imageUrl = new URL(originalUrl, this.resolvedBaseUrl).href;

    // 处理.js结尾的图片URL
    imageUrl = imageUrl.endsWith(".js") ? imageUrl : imageUrl;

    // 获取图片数据
    const imageData = await fetchImage(imageUrl, {
      headers: {
        "Referer": this.resolvedBaseUrl,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    // 创建新的ImageData对象
    return {
      data: imageData.data,
      contentType: "image/jpeg",
    };
  }
}
