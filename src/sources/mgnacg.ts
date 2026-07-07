import assert from "node:assert";
import { fetch2, getDocument, getImage } from "../utils/fetch.ts";
import { inferMediaFormat } from "../utils/media-format.ts";
import { parseOptionalNumber, parsePositiveInteger } from "../utils/number.ts";
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
import { captcha } from "../utils/captcha.ts";
import { Document } from "dom";
import { md5 } from "@takker/md5";
import { decodeBase64, encodeHex } from "@std/encoding";

interface ISource {
  show: string; // 源备注
  parse: string; // 解析器
}

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

interface IVideoRes {
  key: string;
  vkey: string;
  url: string;
  title: string;
  time: number;
}

export function resolveMgnacgPlayerPath(
  info: Pick<IPlayerInfo, "encrypt" | "url">,
): string {
  if (info.encrypt == 1) {
    return decodePlayerPath(info.url);
  }
  if (info.encrypt == 2) {
    return decodePlayerPath(atob(info.url));
  }
  if (info.encrypt == 0) {
    return info.url;
  }
  throw new Error(`Unknown encrypt type ${info.encrypt}`);
}

function decodePlayerPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return unescape(value);
  }
}

export function mgnacgVerifyMessage(responseText: string): string {
  if (!responseText.trim()) return "";
  try {
    const payload = JSON.parse(responseText) as { msg?: unknown };
    return typeof payload.msg === "string" && payload.msg.trim()
      ? payload.msg.trim()
      : "验证码错误";
  } catch {
    return "验证码错误";
  }
}

export class CommonAPI {
  private $source: Record<string, ISource> = {};

  constructor(
    private $config: string =
      "https://www.mgnacg.com/static/js/playerconfig.js",
  ) {}

  async init() {
    const scrctx = await (await fetch2(this.$config)).text();
    const res = new Function(scrctx + "\n return MacPlayerConfig;")() as {
      player_list: Record<string, ISource>;
    };
    this.$source = res.player_list;
  }

  getPlayer(info: IPlayerInfo) {
    const source = this.$source[info.from];
    assert(source, `Unknown source ${info.from}`);
    return source.parse;
  }

  private async decryptURL(url: string, doc: Document) {
    const key1 = doc.querySelector('meta[name="viewport"]')
      ?.id?.replace("now_", "");
    const key2 = doc.querySelector('meta[charset="UTF-8"]')
      ?.id?.replace("now_", "");
    assert(key1 && key2, `Failed to decrypt url ${url}`);

    // 按key2排序
    const keys = new Array(key2.length);
    for (let i = 0; i < key2.length; i++) {
      keys[i] = key1[parseInt(key2[i])];
    }
    const md5Hex = encodeHex(md5(keys.join("") + "Mknacg123321")); // 32字符
    const keyStr = md5Hex.substring(16); // 16字符字符串
    const ivStr = md5Hex.substring(0, 16); // 16字符字符串
    const key = new TextEncoder().encode(keyStr); // Uint8Array(16)
    const iv = new TextEncoder().encode(ivStr); // Uint8Array(16)
    const ciphertext = decodeBase64(url);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-CBC", length: 128 }, // 16字节 = 128位
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      cryptoKey,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  }

  async getVideoUrl(info: IPlayerInfo) {
    const src = this.getPlayer(info);
    const url = resolveMgnacgPlayerPath(info);
    const doc = await getDocument(src + url);
    const scr = doc.getElementsByTagName("script").at(-1)?.textContent;
    assert(scr, `Failed to get video url from ${src}`);
    const config = await new Promise<IVideoRes>((rs) => {
      new Function("player", scr!)(rs);
    });
    return {
      url: await this.decryptURL(config.url, doc),
    };
  }
}

export default class AkiAnimeAPI extends BaseVideoSource {
  private $api: CommonAPI = new CommonAPI();

  constructor() {
    super("mgnacg", "橘子动漫", "https://www.mgnacg.com", true);
    this.imageAspectRatio = "9/16";
  }

  override async init(): Promise<void> {
    await this.$api.init();
  }

  override async getHomeVideos(_page?: number): Promise<IVideoList> {
    const home = await getDocument(this.baseUrl);
    const vid: IVideoItem[] = [];
    for (const el of home.querySelectorAll(".public-list-box")) {
      const link = el.getElementsByTagName("a")?.[0];
      const image = el.getElementsByTagName("img")?.[0];
      if (!link || !image) continue;
      const href = link.getAttribute("href");
      const thumbnail = image.getAttribute("data-src") ||
        image.getAttribute("src");
      const match = href?.match(/\/media\/([A-Za-z0-9]+)\/?/);
      const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
      if (!href || !match || !itemUrl) continue;
      const title = image.getAttribute("alt") || link.textContent?.trim() ||
        match[1];
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
    const pageUrl = url ?? new URL(`/media/${seriesId}/`, this.baseUrl).href;
    const doc = await getDocument(pageUrl);
    const ser: IEpisode[] = [];
    let total = 0;
    for (const group of doc.querySelectorAll(".anthology-list-play")) {
      let ep = 1;
      for (const el of group.children) {
        const link = el.getElementsByTagName("a")?.[0];
        if (!link) continue;
        // /bgmplay/cEcDDE-1-1.html
        const href = link.getAttribute("href");
        const match = href?.match(/\/bangumi\/([A-Za-z0-9]+-[0-9]+-[0-9]+)\/?/);
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

    const img = doc.querySelector(".detail-pic img");
    const name = doc.querySelector("h3.slide-info-title");
    const btn = doc.querySelector(".vod-detail-bnt a");
    const fraction = doc.querySelector("div.fraction");
    const desc = doc.querySelector("div#height_limit");
    const year = Array.from(doc.querySelectorAll(".slide-info-remarks"))
      .find((e) => /^[0-9]{4}$/.test(e.innerText))?.innerText;
    const imageUrl = img?.getAttribute("data-src") ||
      img?.getAttribute("src") || "";
    const playUrl = btn?.getAttribute("href");

    return {
      thumbnail: httpUrlOrEmpty(imageUrl, this.baseUrl),
      title: name?.textContent?.trim() || seriesId,
      episodes: ser,
      seriesId,
      totalEpisodes: total,
      source: this.sourceId,
      id: seriesId,
      url: httpUrlOrFallback(playUrl, this.baseUrl, pageUrl),
      description: desc?.textContent?.trim(),
      rating: parseOptionalNumber(fraction?.textContent?.trim()),
      year: parseOptionalNumber(year),
    };
  }

  override async searchVideos(
    query: string,
    page: number = 1,
    verified = false,
  ): Promise<IVideoList> {
    const doc = await getDocument(
      new URL(
        `/search/${encodeURIComponent(query)}----------${page}---/`,
        this.baseUrl,
      ),
    );
    const verify = doc.querySelector("img.ds-verify-img[src]");
    let verifyMessage = "搜索需要验证码";
    for (let attempt = 0; verify && attempt < 3; attempt++) {
      const verifySrc = verify.getAttribute("src");
      if (!verifySrc) break;
      const verifyImageUrl = httpUrlOrEmpty(verifySrc, this.baseUrl);
      if (!verifyImageUrl) break;
      const code = await captcha({
        prompt: verifyMessage,
        imageUrl: verifyImageUrl,
      });
      const res = await fetch2(
        new URL(
          "/index.php/ajax/verify_check?type=search&verify=" + code,
          this.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "",
        },
      ).then((r) => r.text());
      const nextMessage = mgnacgVerifyMessage(res);
      if (!nextMessage) {
        if (verified) {
          throw new Error("验证码已通过但搜索页仍要求验证码");
        }
        return this.searchVideos(query, page, true);
      }
      verifyMessage = nextMessage;
    }
    if (verify) throw new Error(verifyMessage);

    const res: IVideoItem[] = [];
    for (const el of doc.querySelectorAll(".vod-detail")) {
      const link = el.querySelector('a[target="_blank"]');
      const namel = el.querySelector(".slide-info-title");
      const img = el.querySelector("img.gen-movie-img");

      if (!link || !namel || !img) continue;
      const href = link.getAttribute("href");
      const thumbnail = img.getAttribute("data-src") || img.getAttribute("src");
      const match = href?.match(/\/media\/([A-Za-z0-9]+)\/?/);
      const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
      if (!href || !match || !itemUrl) continue;
      res.push({
        thumbnail: httpUrlOrEmpty(thumbnail, this.baseUrl),
        title: namel.textContent?.trim() || match[1],
        url: itemUrl,
        source: this.sourceId,
        id: match[1],
        contentType: "series",
      });
    }

    const tip = doc.querySelector(".page-tip");
    // 共43条数据,当前1/5页
    const match = tip?.textContent?.match(/当前(\d+)\/(\d+)页/);
    return {
      currentPage: parsePositiveInteger(match?.[1], 1),
      totalPages: parsePositiveInteger(match?.[2], 1),
      videos: res,
    };
  }

  override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    const doc = await getDocument(url);
    const scr = doc.getElementsByTagName("script").find((e) =>
      e.innerText.includes("player_aaaa")
    )?.textContent;
    assert(scr, `Failed to get video url from ${url}`);
    const info = new Function(scr + ";return player_aaaa;")();
    const inf = await this.$api.getVideoUrl(info);
    const mediaUrl = new URL(inf.url, url).href;
    const format = this.inferFormat(mediaUrl);
    return [{
      quality: "1080p",
      url: mediaUrl,
      format, // 这个源通常没有用hls
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
