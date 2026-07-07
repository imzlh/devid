import { IVideoItem, IVideoList, IVideoURL } from "../types/index.ts";
import { fetch2, getDocument } from "../utils/fetch.ts";
import { logError, logInfo, logWarn } from "../utils/logger.ts";
import { BaseVideoSource, ImageData } from "./index.ts";
import { JSEncrypt } from "jsencrypt";
import assert from "node:assert";
import { inferMediaFormat } from "../utils/media-format.ts";

interface IVideo {
  create_time: string;
  enc_img: string;
  eye: number;
  id: number;
  name: string;
  time: string;
  is_yp?: boolean; // is ads
  href?: string; // ads only
}

interface IHome {
  rank_videos: {
    name: "排行榜";
    videos: IVideo[];
  };
  recommend_videos: {
    name: "今日推荐";
    videos: IVideo[];
  };
}

interface ISearch {
  name: string;
  current_page: number;
  last_page: number;
  total: number;
  videos: IVideo[];
}

interface IDetail {
  video: IVideo & { url: string };
}

interface IApiResponse<T = unknown> {
  code: number;
  data: T;
  msg: string;
  time: number;
}

export function build17cSearchPath(query: string, page: number): string {
  const params = new URLSearchParams({
    c: "0",
    sort: "new",
    page: page.toString(),
    limit: "30",
    name: query,
  });
  return `/v1/vod?${params}`;
}

function c17HttpUrlOrEmpty(value: unknown, baseUrl: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function build17cVideoItem(
  vid: Partial<IVideo> | null | undefined,
  baseUrl: string,
  sourceId: string,
): IVideoItem | null {
  if (!vid || vid.is_yp !== undefined || vid.id == null) return null;
  const title = typeof vid.name === "string" ? vid.name.trim() : "";
  if (!title) return null;
  return {
    url: new URL(
      `/videoplay/0.html?v=${encodeURIComponent(String(vid.id))}`,
      baseUrl,
    )
      .href,
    id: vid.id.toString(),
    views: vid.eye == null ? undefined : vid.eye.toString(),
    duration: typeof vid.time === "string" ? vid.time : undefined,
    title,
    thumbnail: c17HttpUrlOrEmpty(vid.enc_img, baseUrl),
    source: sourceId,
  };
}

// 17C 视频源实现
export default class C17VideoSource extends BaseVideoSource {
  private rawHost: string = "";

  // 解码映射表 - 用于解密 m3u8 URL
  private DECODE_MAPPER: Record<string, string> = {
    "e": "P",
    "w": "D",
    "T": "y",
    "+": "J",
    "l": "!",
    "t": "L",
    "E": "E",
    "@": "2",
    "d": "a",
    "b": "%",
    "q": "l",
    "X": "v",
    "~": "R",
    "C": "j",
    "]": "F",
    "a": ")",
    "^": "m",
    ",": "~",
    "}": "1",
    "x": "C",
    "c": "(",
    "G": "@",
    "h": "h",
    ".": "*",
    "L": "s",
    "=": ",",
    "p": "g",
    "I": "Q",
    "K": "6",
    "F": "t",
    "k": "G",
    "Z": "]",
    ")": "b",
    "P": "}",
    "B": "U",
    "S": "k",
    "g": ":",
    "N": "N",
    "i": "S",
    "%": "+",
    "-": "Y",
    "?": "|",
    "*": "-",
    "[": "{",
    "(": "c",
    "u": "B",
    "y": "M",
    "U": "Z",
    "H": "[",
    "z": "K",
    "R": "x",
    "v": "&",
    "!": ";",
    "M": "_",
    "Q": "9",
    "Y": "e",
    "o": "4",
    "r": "A",
    "m": ".",
    "O": "o",
    "V": "W",
    "J": "p",
    "f": "d",
    ":": "q",
    "{": "8",
    "W": "I",
    "j": "?",
    "n": "5",
    "s": "3",
    "|": "T",
    "A": "V",
    "D": "w",
    ";": "O",
    "&": "X",
    "_": "u",
    "5": "r",
    "1": "7",
    "2": "n",
    "8": "=",
    "4": "z",
    "3": "^",
    "9": "H",
    "7": "f",
    "6": "i",
    "0": "0",
  };

  constructor() {
    super("17c", "17C视频", "https://17c.com");
  }

  // 处理重定向脚本
  private handleRedirect(nagCode: string) {
    let result = "";
    const location = {
      set href(val: string) {
        result = val;
      },
      replace(val: string) {
        result = val;
      },
    };
    const window: { location: typeof location } = { location };
    new Function("window", "location", nagCode)(window, location);
    return result;
  }

  /**
   * 解密函数
   * @param data - Base64 编码的 AES 加密数据
   * @param key - Base64 编码的 RSA 加密密钥
   */
  private async decrypt({ data, key }: { data: string; key: string }) {
    const certkey =
      `MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA0E9Nsuz6jYF+JeLqKaL1LkZyg0Wl4xPIwEzlDrO4UOMYGX1WG+nqf9ovpplgThgLcyoRM1YFshGFOrkAiHEZqwIDAQABAkABvEdncDX+K9ADPMq6ohLs2cVmdpQVOjr37ywRXUnx0o6skjM3Yg45uw3lpobrkckep0NxqrINeSsrY29hA3ZBAiEA8rnQiqs6hXw8tLIBk0i2i7tqai9xew/lD/wDGQdtvdECIQDbs6kkuEs9us9avgF/JO7F13OmlDzR0lzrIzujxvLSuwIgW+BX/tVXnoVrWR50GDMS3gt/+VeiBen7U7SZ25SDRrECIBhIx41zgX2VRI43KlsvbeUYZ4QmJoLaycKD5ne36ec5AiEA44AwFDoD1qf1wIZ152QxrkZgGMyKG6c836lRB5VdiME=`;

    // 1. RSA 解密
    const rsa = new JSEncrypt();
    rsa.setPublicKey(certkey);
    const aesKey = rsa.decrypt(key);

    if (!aesKey) throw new Error("RSA 解密失败");

    // 2. 构造 IV（与原代码逻辑一致）
    const aesKeyReversed = aesKey.split("").reverse().join("");
    const iv = aesKeyReversed.substring(0, 16);

    // 3. AES-CBC 解密（Web Crypto API，Deno 原生支持）
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(aesKey),
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: new TextEncoder().encode(iv) },
      cryptoKey,
      Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
    );

    return new TextDecoder().decode(decrypted);
  }

  // 初始化视频源 - 获取真实地址
  async init(): Promise<void> {
    logInfo(`初始化视频源: ${this.sourceName}`);

    const ENTRY_LINK = "https://17c.com";
    const APP_ENTRY_LINK = "https://www.17capp2.com:6688/100.html";

    try {
      // 首先尝试 APP 入口
      for (let ret = 0; ret < 3; ret++) {
        const appDoc = await getDocument(APP_ENTRY_LINK);
        const iframe = appDoc.querySelector("iframe[src]");
        if (iframe) {
          const addr = iframe.getAttribute("src");
          if (addr) {
            if (addr.includes("baidu.com")) {
              continue;
            }
            const aurl = new URL(addr, APP_ENTRY_LINK);
            try {
              await fetch2(aurl, { timeout: 5000 });
              this.rawHost = aurl.hostname;
              this.baseUrl = aurl.href;
              logInfo(`通过 APP 入口解析到域名: ${this.baseUrl} `);
              await this.postInit();
              return;
            } catch (e) {
              logWarn("APP 入口请求失败，尝试主入口", e);
            }
          }
        }
        break;
      }

      // 尝试主入口（需要处理重定向）
      const entryDoc = await getDocument(ENTRY_LINK);
      const scripts = entryDoc.getElementsByTagName("script");
      if (scripts.length > 0 && scripts[0].innerHTML) {
        const addr0 = await this.handleRedirect(scripts[0].innerHTML);
        const doc1 = await getDocument(addr0);
        const link = doc1.querySelector("a[href]");
        if (link) {
          const addr1 = link.getAttribute("href");
          if (addr1) {
            const doc2 = await getDocument(addr1);
            const bold = doc2.querySelector(
              "body > div.content-box > div > div > div.ran-box > div > b:nth-child(2)",
            );
            if (bold) {
              const addr2 = bold.innerHTML;
              const doc3 = await getDocument(addr2);
              const script = doc3.querySelector("script");
              if (script && script.innerHTML) {
                const finalUrl = await this.handleRedirect(script.innerHTML);
                const addrR = new URL(finalUrl);

                // 尝试解析 DNS
                try {
                  await fetch2(addrR, { timeout: 5000 });
                } catch {
                  const ips = await Deno.resolveDns(addrR.hostname, "A");
                  if (ips.length > 0) {
                    addrR.hostname = ips[0];
                  }
                }

                this.rawHost = addrR.hostname;
                this.baseUrl = addrR.href;
                logInfo(`通过主入口解析到域名: ${this.baseUrl} `);
                await this.postInit();
                return;
              }
            }
          }
        }
      }

      throw new Error("无法解析到有效域名");
    } catch (error) {
      logError("初始化 17C 视频源失败:", error);
      throw error;
    }
  }

  private async postInit() {
    // here to inject
  }

  private async getAPI<T = unknown>(
    path: string,
    referrer = this.baseUrl,
  ): Promise<IApiResponse<T>> {
    const url = new URL(path, this.baseUrl);
    let fe, retry = 0;
    do {
      if (fe) logInfo("Retry: 目标服务器间歇性抽搐", path);
      fe = await fetch(url, {
        referrer,
      });
    } while (fe.status == 502 && (retry++) < 3);
    if (fe.status == 502) throw new Error("失败: 无法获取数据");
    const txt = await fe.text();
    const res = JSON.parse(txt);
    const dec = await this.decrypt(res);
    const json = JSON.parse(dec);
    assert(json.code, `API 请求失败: ${json.msg}`);
    return json;
  }

  private convIVideo(vid: Partial<IVideo>): IVideoItem | null {
    return build17cVideoItem(vid, this.baseUrl, this.sourceId);
  }

  // 获取主页视频列表
  async getHomeVideos(_page: number = 1): Promise<IVideoList> {
    if (!this.baseUrl) {
      throw new Error("视频源未初始化");
    }

    const res5 = (await this.getAPI<IHome>("/v1/relist?c=100")).data;
    const vid = (res5.recommend_videos?.videos ?? []).concat(
      res5.rank_videos?.videos ?? [],
    );

    return {
      videos: vid.flatMap((e) => {
        const video = this.convIVideo(e);
        return video ? [video] : [];
      }),
      currentPage: 1,
      totalPages: 1,
    };
  }

  // 搜索视频
  async searchVideos(query: string, page: number = 1): Promise<IVideoList> {
    if (!this.baseUrl) {
      throw new Error("视频源未初始化");
    }

    const res = await this.getAPI<ISearch>(build17cSearchPath(query, page));

    return {
      videos: (res.data.videos ?? []).flatMap((e) => {
        const video = this.convIVideo(e);
        return video ? [video] : [];
      }),
      currentPage: page,
      totalPages: res.data.last_page,
    };
  }

  // 获取视频信息
  private async getVideoInfo(
    vidurl: string,
  ): Promise<
    { id: string; title: string; m3u8: string; thumbnail: string; url: string }
  > {
    const vid = vidurl.match(/\/videoplay\/0\.html\?v=([^&]+?)$/)?.[1]; // `/videoplay/0.html?v=${vid.id}`
    assert(vid, "无法解析视频 ID");

    const api = await this.getAPI<IDetail>(`/v1/vod/${vid}`, vidurl);
    const video = api.data.video;

    return {
      id: vid,
      title: video.name,
      m3u8: video.url,
      thumbnail: video.enc_img,
      url: vidurl,
    };
  }

  async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const videoInfo = await this.getVideoInfo(url);

    return [{
      url: videoInfo.m3u8,
      quality: "高清",
      resolution: "1920x1080",
      bandwidth: 2000000,
      format: inferMediaFormat(videoInfo.m3u8),
    }];
  }

  // 解码图片（XOR 解码）
  private decodeImage(input: Uint8Array): Uint8Array {
    const decBase = 0x88;
    const output = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] ^ decBase;
    }
    return output;
  }

  // 获取图片数据
  override async getImage(originalUrl: string): Promise<ImageData> {
    const imageUrl = originalUrl.startsWith("http")
      ? originalUrl
      : new URL(originalUrl, this.baseUrl!).href;

    try {
      const response = await fetch2(imageUrl, {
        headers: {
          "Referer": this.baseUrl || "",
          "Host": this.rawHost,
        },
      });

      const data = new Uint8Array(await response.arrayBuffer());

      // 尝试解码图片
      const decoded = this.decodeImage(data);

      return {
        data: decoded,
        contentType: "image/jpeg",
      };
    } catch (error) {
      logWarn("获取图片失败:", error);
      return {
        data: new Uint8Array(),
        contentType: "image/jpeg",
      };
    }
  }
}
