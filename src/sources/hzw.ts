import assert from "node:assert";
import { fetch2, getDocument } from "../utils/fetch.ts";
import { BaseVideoSource } from "./index.ts";
import {
  IImageData,
  ISeriesResult,
  IVideoItem,
  IVideoList,
  IVideoURL,
} from "../types/index.ts";
import { URLSearchParams } from "node:url";
import { encodeHex } from "@std/encoding";
import { md5 } from "@takker/md5";
import { inferMediaFormat } from "../utils/media-format.ts";

interface IUserInfo {
  account: string;
  allLoginCount: number;
  browser: string;
  createTime: string;
  deviceId: string;
  fromSource: number;
  icon: string;
  id: number;
  lastLoginIp: string;
  lastLoginTime: string;
  longTimeVipUser: boolean;
  nickName: string;
  os: string;
  password: string;
  passwordContent: string;
  payCount: number;
  referrer: string;
  state: number;
  tourists: number;
  vipUser: boolean;
}

interface IMediaInfo {
  author: string;
  chaptersCount: number;
  collectCount: number;
  createTime: number; // 时间戳（毫秒）
  duration: string; // 时长格式 "HH:MM:SS"
  fromId: string;
  fromSite: number;
  id: number;
  isFinish: number; // 0-未完结，1-已完结
  landscapeCover: string;
  likeCount: number;
  note: string;
  playCount: number;
  recommendRate: number;
  score: number;
  screenMode: number; // 横竖屏模式：1-竖屏 2-横屏
  state: number;
  tagIds: string;
  title: string;
  updateTime: number; // 时间戳（毫秒）
  url: string;
  verticalCover: string;
}

interface ISearch {
  page: number;
  size: number;
  total: number;
  data: IMediaInfo[];
}

interface IShortVideoInfo {
  authorIcon: string;
  authorId: number;
  authorName: string;
  coins: number;
  collectCount: number;
  commentCount: number;
  createTime: number; // 创建时间戳（毫秒）
  duration: string; // 时长格式 "MM:SS"
  fromId: number;
  fromSite: number;
  height: number;
  id: number;
  likeCount: number;
  playCount: number;
  publishTime: number; // 发布时间戳（毫秒）
  recommendRate: number;
  screenMode: number; // 1-竖屏 2-横屏
  state: number;
  tags: string; // 标签，逗号分隔
  title: string;
  updateTime: number; // 更新时间戳（毫秒）
  url: string;
  verticalCover: string;
  width: number;
}

type HzwParamValue = string | number | boolean | null;
type HzwParams = Record<string, HzwParamValue>;

export function buildHzwSignedUrl(
  url: string,
  timestamp: number,
  rand1: number,
  rand2: number,
): string {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const salt = "alc0gM2L4b8FKsX1V9J70NGZAExhyk9";
  const signSource = `${path}-${timestamp}-${rand1}-${rand2}-${salt}`;
  const signature = encodeHex(md5(signSource));
  urlObj.searchParams.set("t", `${timestamp}-${rand1}-${rand2}-${signature}`);
  return urlObj.href;
}

export function hzwTotalPages(total: number, pageSize: number): number {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : 30;
  return Math.max(1, Math.ceil(safeTotal / safePageSize));
}

export function hzwHttpUrlOrEmpty(value: unknown, baseUrl: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = baseUrl
      ? new URL(value.trim(), baseUrl)
      : new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export function buildHzwVideoItem(
  item: Partial<IMediaInfo> | null | undefined,
  mediaBase: string,
  sourceId: string,
): IVideoItem | null {
  if (!item || item.id == null) return null;
  const url = hzwHttpUrlOrEmpty(item.url, mediaBase);
  if (!url) return null;
  const title = typeof item.title === "string" && item.title.trim()
    ? item.title.trim()
    : item.id.toString();
  const cover = item.landscapeCover || item.verticalCover;
  return {
    views: item.playCount == null ? undefined : item.playCount.toString(),
    duration: typeof item.duration === "string" ? item.duration : undefined,
    id: item.id.toString(),
    title,
    thumbnail: hzwHttpUrlOrEmpty(cover, mediaBase),
    source: sourceId,
    url,
  };
}

class API {
  public contextPath: string;
  public domain: string;
  public version: number;

  constructor(options: {
    contextPath?: string;
    domain?: string;
    version?: number;
  } = {}) {
    this.contextPath = options.contextPath || "/ui/";
    this.domain = options.domain || "";
    this.version = options.version || 2;
  }

  /**
   * 发送请求并自动解码响应
   */
  async request<T = unknown>(
    url: string,
    params: HzwParams,
    type: 1 | 2 = 1,
  ): Promise<T> {
    const encoded = this.reqData(url, params, type);

    let method = "GET";
    let requestUrl: string;
    let body: HzwParams | undefined;

    if (this.version === 1) {
      // 版本1：直接POST原始接口
      method = "POST";
      requestUrl = url;
      body = params;
    } else {
      // 版本2：混淆模式
      const cacheKey = this.getDateCacheByRequestParamPath(encoded);
      requestUrl =
        `${this.domain}${this.contextPath}open_api/data_${cacheKey}.js`;

      if (type === 2) {
        method = "POST";
        requestUrl = `${this.domain}${this.contextPath}open_api/data`;
        body = {
          data: encoded,
          key: this.randomString(10) + btoa(
            this.randomString(10) + Date.now() + Math.ceil(Math.random() * 100),
          ),
        };
      } else {
        body = { data: encoded };
      }
    }

    const res = await fetch2(requestUrl, {
      method,
      headers: {
        "Accept": "text/plain, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://obzkuppwre17.com",
        "Referer": "obzkuppwre17.com",
        "X-Requested-By": "XMLHttpRequest",
      },
      body: method === "POST" && body
        ? new URLSearchParams(
          Object.entries(body).map((
            [key, value],
          ): [string, string] => [key, String(value ?? "")]),
        )
        : undefined,
    });

    const text = await res.text();

    // 如果是HTML模板直接返回
    if (url.endsWith("t.html")) {
      return text as unknown as T;
    }

    // 解码混淆的响应
    return this.respData(text) as T;
  }

  /**
   * 请求数据编码 (对应 Net.reqData)
   */
  reqData(url: string, data: HzwParams, type: number): string {
    // 清理URL路径
    data.url = url.replaceAll(
      this.contextPath.substring(0, this.contextPath.length - 1),
      "",
    );

    // 时间戳
    const now = new Date();
    if (type === 1) {
      data.time = `${now.getFullYear()}${
        now.getMonth() + 1
      }${now.getDate()}${now.getHours()}`;
    } else {
      data.time = now.getTime();
    }

    // JSON -> URI编码 -> Base64
    let str = JSON.stringify(data);
    str = btoa(encodeURIComponent(str));

    // 分段插入干扰字符
    const len = str.length;
    const chunkSize = Math.floor(len / 10);
    const parts: string[] = [];
    let start = 0;

    for (let i = 0; i <= 10; i++) {
      const end = i * chunkSize;
      const separator = type === 1 ? "A" : this.randomString(1);
      const chunk = str.substring(start, end);
      parts.push(chunk);
      parts.push(separator);
      start = end;
    }
    parts.push(str.substring(start));

    return parts.join("");
  }

  /**
   * 响应数据解码 (对应 Net.respData)
   */
  respData(raw: string): unknown {
    const totalLen = raw.length - 10;
    const chunkSize = Math.floor(totalLen / 10);
    const parts: string[] = [];
    let pos = 0;

    // 提取10段并反转
    for (let i = 0; i < 10; i++) {
      const start = i * chunkSize + 1 + i;
      const segment = raw.substring(start, start + chunkSize);
      parts.push(segment.split("").reverse().join(""));
      pos = start + chunkSize;
    }

    // 最后一段
    const lastSegment = raw.substring(pos + 1).split("").reverse().join("");
    parts.push(lastSegment);

    // Base64解码 -> URI解码 -> JSON解析
    const decoded = decodeURIComponent(atob(parts.join("")));
    return JSON.parse(decoded.replace(/[\r\n\s+]/g, " "));
  }

  /**
   * 生成缓存键 (对应 Net.getDateCacheByRequestParamPath)
   */
  getDateCacheByRequestParamPath(encoded: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const fingerprint = this.getStringFingerprint(encoded);
    const refreshTime = this.getRefreshMinuteByRequest(fingerprint);

    return `${year}${month}${refreshTime.adjustedDay}${refreshTime.adjustedHours}${refreshTime.refreshMinute}_${fingerprint}`;
  }

  /**
   * 计算刷新分钟数 (对应 Net.getRefreshMinuteByRequest)
   */
  getRefreshMinuteByRequest(fingerprint: string): {
    adjustedDay: number;
    adjustedHours: number;
    refreshMinute: number;
  } {
    // 哈希算法：确保同一请求在固定时间片内
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      hash = (hash * 31 + fingerprint.charCodeAt(i)) % 60;
    }
    const refreshMinute = hash + 1; // 1-60

    const now = new Date();
    let adjustedHours = now.getHours();
    let adjustedDay = now.getDate();

    // 如果当前分钟未到刷新点，使用上一小时缓存
    if (now.getMinutes() < refreshMinute) {
      adjustedHours--;
      if (adjustedHours < 0) {
        adjustedHours = 23;
        adjustedDay--;
      }
    }

    return { adjustedDay, adjustedHours, refreshMinute };
  }

  /**
   * 字符串指纹 (对应 Net.getStringFingerprint)
   */
  getStringFingerprint(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash &= hash;
    }
    const hex = hash.toString(16);
    return hex.replace(/[^\da-f]/gi, "");
  }

  /**
   * 随机字符串 (对应 Net.randomString)
   */
  randomString(len: number = 32): string {
    const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz";
    let result = "";
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

export default class HZWSource extends BaseVideoSource {
  private $ = new API();
  private links: Record<string, string> = {};
  private user: IUserInfo | undefined;

  constructor() {
    super("hzw", "海贼王app", "https://hzw.app/", true);
  }

  override async init(): Promise<void> {
    const page = await getDocument(this.baseUrl);
    const entry = page.querySelector("#lastNewDomainList")?.getAttribute(
      "data-caption",
    )
      ?.substring(10);
    assert(entry, "找不到入口网站");
    const res = decodeURIComponent(escape(atob(entry))).split(",").at(-1);
    assert(res, "入口域名为空");

    this.baseUrl = this.$.domain = `https://${res}`;
    const page2 = await getDocument(new URL("/ui/comics/main", this.baseUrl));
    const res2 = page2.querySelector("#page_js_domain")?.getAttribute("value");
    assert(res2, "找不到API端点");

    // 找到相关网址
    const links = await this.req<{
      id: number;
      key: string;
      val: string;
    }[]>("/ui/api/dance/loadSysConfig", {
      url: "/ui/api/dance/loadSysConfig",
      time: Date.now(),
    }, 2);
    this.links = Object.fromEntries(links.data.map((e) => [e.key, e.val]));
    assert(this.links["video_base_url"], "无法从API提取视频域名");

    this.$.domain = res2.endsWith("/")
      ? res2.substring(0, res2.length - 1)
      : res2;

    // 初始化用户
    const user = await this.req<IUserInfo>("/ui/api/user/getByDeviceId", {
      "deviceId": "",
      "sId": null,
      "fromId": null,
      "isApp": null,
      "fromCode": null,
      "os": "Android",
      "browser": "chrome",
      "url": "/api/user/getByDeviceId",
      "time": Date.now(),
    }, 2);
    this.user = user.data;
  }

  /**
   * v: 1 = POST openapi(no cache) 2 = cached
   */
  private req<T>(path: string, param: HzwParams, v: 1 | 2 = 1) {
    return this.$.request<{
      code: number;
      data: T;
    }>(path, param, v);
  }

  private getRecommend(id: number, page = 1) {
    return this.req<IMediaInfo[]>("/ui/api/navigation/getResourceViewData", {
      "loadModel": "main",
      "navigationType": "2",
      "id": id,
      "dataSourceMode": "byHasAllTagTitles",
      "pageIndex": page,
      "pageSize": "10",
    }, 2);
  }

  private translateIVideo(e: Partial<IMediaInfo>): IVideoItem | null {
    return buildHzwVideoItem(e, this.links["video_base_url"], this.sourceId);
  }

  override async getHomeVideos(page?: number): Promise<IVideoList> {
    const promises: Promise<IMediaInfo[]>[] = [];
    for (
      const id of [
        1006, // 推荐
        1014, // 第一次
        1005, // loli
        1008, // 飙升
        1010, // 缅北
        1016, // 传媒
        1012, // 精选
        1000, // 吃瓜
        1002, // 女神
        1001, // luanlun
        1009, // 乱lun
        1003, // AV
        1013, // 真实
        // 1014,   // 同性，打开这个注释那么你也是神人了
      ]
    ) promises.push(this.getRecommend(id, page).then((e) => e.data));
    const recommended = (await Promise.allSettled(promises)).flatMap((
      result,
    ) =>
      result.status === "fulfilled" && Array.isArray(result.value)
        ? result.value
        : []
    );
    return {
      currentPage: page ?? 1,
      totalPages: 10, // fake
      videos: ([{
        contentType: "infinite",
        id: "short-video",
        title: "短视频",
        thumbnail:
          "https://tse1.mm.bing.net/th/id/OIP.u8hVQ_qivl5M-MgXt-q8dwHaE3?rs=1&pid=ImgDetMain&o=7&rm=3",
        source: this.sourceId,
        url: new URL("/ui/short_video/main", this.baseUrl).href,
      }] as IVideoItem[]).concat(
        recommended.flatMap((e) => {
          const video = this.translateIVideo(e);
          return video ? [video] : [];
        }),
      ),
    };
  }

  private signURL(url: string) {
    // 时间戳（秒）
    const timestamp = Math.floor(Date.now() / 1000);

    // 两个0-9999随机数
    const rand1 = Math.floor(Math.random() * 10000);
    const rand2 = Math.floor(Math.random() * 10000);

    return buildHzwSignedUrl(url, timestamp, rand1, rand2);
  }

  override async getImage(originalUrl: string): Promise<IImageData> {
    const url = this.signURL(originalUrl);
    const fe = await (await fetch2(url, {
      headers: {
        "Accept": "text/plain, */*; q=0.01",
        "Origin": this.baseUrl,
        "X-Requested-By": "XMLHttpRequest",
      },
    })).bytes();
    if (new TextDecoder().decode(fe.subarray(0, 5)) != "data:") {
      return { data: fe, contentType: "image/png" };
    }
    const res = await (await fetch(new TextDecoder().decode(fe))).bytes();
    return { data: res, contentType: "image/jpeg" };
  }

  // deno-lint-ignore require-await -- BaseVideoSource declares an async contract.
  override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const signedUrl = this.signURL(url);
    return [
      {
        url: signedUrl,
        quality: "720p",
        format: inferMediaFormat(signedUrl),
      },
    ];
  }

  override async searchVideos(
    query: string,
    page?: number,
  ): Promise<IVideoList> {
    const res = await this.req<ISearch>("/ui/api/dance/search", {
      "navigationType": 2,
      "title": query,
      "pageIndex": page ?? 1,
      "pageSize": 30,
    }, 2);
    return {
      currentPage: res.data.page,
      totalPages: hzwTotalPages(res.data.total, 30),
      videos: (res.data.data ?? []).flatMap((e) => {
        const video = this.translateIVideo(e);
        return video ? [video] : [];
      }),
    };
  }

  override async getSeries(
    seriesId: string,
    _url?: string,
  ): Promise<ISeriesResult | null> {
    assert(seriesId == "short-video", "非短视频不支持序列");
    // hzw源的短视频系列不需要URL参数，忽略传入的url
    assert(this.user, "用户信息未初始化");

    const res = await this.req<IShortVideoInfo[]>(
      "/ui/api/shortVideo/byRecommend",
      {
        "pageIndex": 1,
        "pageSize": 10,
        "userId": this.user.id,
        "authorId": "",
        "first": true,
      },
      2,
    );

    const mediaBase = this.links["video_base_url"];
    const episodes = res.data.map((e, i) => {
      const url = hzwHttpUrlOrEmpty(e.url, mediaBase);
      if (!url) return null;
      return {
        episodeNumber: i + 1,
        id: e.id.toString(),
        thumbnail: hzwHttpUrlOrEmpty(e.verticalCover, mediaBase) || undefined,
        url,
        seriesId,
        title: [e.title, e.authorName].filter(Boolean).join("/") ||
          e.id.toString(),
      };
    }).filter((episode) => episode !== null);

    return {
      seriesId,
      id: seriesId,
      title: "短视频",
      thumbnail: "",
      source: this.sourceId,
      url: new URL("/ui/comics/main", this.baseUrl).href,
      totalEpisodes: episodes.length,
      episodes,
    };
  }
}
