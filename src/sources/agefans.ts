import assert from "node:assert";
import { getReadme } from "../utils/github.ts";
import { BaseVideoSource, httpUrlOrEmpty } from "./index.ts";
import {
  IEpisode,
  ISeriesDetail,
  ISeriesResult,
  IVideoItem,
  IVideoList,
  IVideoURL,
  URLProxy,
} from "../types/index.ts";
import { Document, Element } from "dom";
import { getDocument } from "../utils/fetch.ts";
import { inferMediaFormat } from "../utils/media-format.ts";
import { parsePositiveInteger } from "../utils/number.ts";
import { md5 } from "@takker/md5";
import GoVM from "../utils/gowasm.ts";
import { decodeHex, encodeHex } from "@std/encoding";

interface Sandbox {
  encrypt(data: string): string;
  decrypt(data: string): string;
}

export function normalizeAgefansInfoLabel(value: string): string {
  return value.trim().replace(/[：:]\s*$/, "");
}

export function parseAgefansYear(value: string): number | undefined {
  const year = new Date(value).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

/**
 * Create a sandboxed environment for AGE WASM encryption/decryption
 */
export async function createSandbox(
  wasmBytes: Uint8Array<ArrayBuffer>,
  domain: string,
): Promise<Sandbox> {
  // Initialize Go runtime with AGE-specific globals
  const runtime = new GoVM({
    Domain: domain,
  });

  // Load and instantiate WASM
  const wasm = await WebAssembly.instantiate(wasmBytes, runtime.importObject);
  runtime.run(wasm.instance);
  const env = runtime.global;

  return {
    encrypt: env.hxm_encrypt,
    decrypt: env.hxm_decrypt,
  };
}

export default class AGEFans extends BaseVideoSource {
  static readonly SOURCE_GH_REPO: [string, string] = ["agefanscom", "website"];

  private sandbox: Sandbox | undefined;

  constructor() {
    super("agefans", "agefans", "", true);
    this.imageAspectRatio = "9/16";
  }

  override async init(): Promise<void> {
    const readme = await getReadme.apply(null, AGEFans.SOURCE_GH_REPO);
    const sites = readme.content.match(/最新域名：\s*\[([^\]]+)\]/);
    assert(sites, "找不到域名。可能已经GG？");
    this.baseUrl = sites[1].replace("http://", "https://");
  }

  private extractFromHtml(el: Element): IVideoItem | null {
    const cover = el.querySelector("img[data-original]")?.getAttribute(
      "data-original",
    );
    const link = el.querySelector("a[href]");
    const name = link?.innerText.trim();
    const href = link?.getAttribute("href");
    const target = href?.match(/\/detail\/(.+)\/?$/)?.[1];
    const all = el.querySelector(".video_item--info")?.innerText.match(
      /第\s*(\d+)\s*集/,
    )?.[1];
    const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
    if (!href || !target || !itemUrl) return null;

    return {
      contentType: "series",
      id: target,
      title: name ?? "Unknown",
      source: this.sourceId,
      thumbnail: httpUrlOrEmpty(cover, this.baseUrl),
      url: itemUrl,
      seriesInfo: {
        totalEpisodes: parsePositiveInteger(all, 0),
      },
    } satisfies IVideoItem;
  }

  private extractCataVideoFromHtml(el: Element): IVideoItem | null {
    const link = el.querySelector(".card-title a");
    const href = link?.getAttribute("href");
    const id = href?.match(/\/detail\/(.+)\/?$/)?.[1];
    const itemUrl = httpUrlOrEmpty(href, this.baseUrl);
    if (!link || !href || !id || !itemUrl) return null;

    const sinfo: Partial<ISeriesDetail> = {};

    for (const subel of el.querySelectorAll(".video_detail_info")) {
      const key = subel.getElementsByTagName("span")[0];
      if (!key) continue;
      key.remove();
      const val = subel.innerText.trim();
      switch (normalizeAgefansInfoLabel(key.innerText)) {
        case "动画种类":
          sinfo.type = val == "TV"
            ? "anime"
            : val == "剧场版"
            ? "movie"
            : "other";
          break;

        case "原版名称":
          sinfo.originalTitle = val;
          break;

        case "播放状态":
          sinfo.status = val == "完结"
            ? "completed"
            : val == "连载"
            ? "ongoing"
            : "upcoming";
          break;

        case "首播时间":
          sinfo.year = parseAgefansYear(val);
          break;

        case "剧情类型":
          sinfo.tags = val.split(/\s+/);
          break;

        case "简介":
          sinfo.description = val;
          break;
      }
    }

    return {
      url: itemUrl,
      contentType: "series",
      id,
      title: link.innerText.trim(),
      thumbnail: httpUrlOrEmpty(
        el.getElementsByTagName("img")[0]?.getAttribute("data-original"),
        this.baseUrl,
      ),
      seriesInfo: sinfo as ISeriesDetail,
      source: this.sourceId,
    };
  }
  override async getHomeVideos(): Promise<IVideoList> {
    const els = (await getDocument(this.baseUrl)).querySelectorAll(
      ".video_item",
    );
    return {
      currentPage: 1,
      totalPages: 1,
      videos: Array.from(els)
        .map((e) => this.extractFromHtml(e))
        .filter((item): item is IVideoItem => item !== null),
    };
  }

  override async searchVideos(
    query: string,
    page?: number,
  ): Promise<IVideoList> {
    const url = new URL(
      "/search?query=" + encodeURIComponent(query) + "&page=" + (page ?? "1"),
      this.baseUrl,
    );
    const p = (await getDocument(url.href)).querySelectorAll(
      ".cata_video_item",
    );
    return {
      currentPage: 1,
      totalPages: 1,
      videos: Array.from(p)
        .map((e) => this.extractCataVideoFromHtml(e))
        .filter((item): item is IVideoItem => item !== null),
    };
  }

  private parseViews(v: string) {
    const m = v.match(/^([0-9\.]+)([a-z])?$/);
    assert(m, "Cannot parse views");
    let n = parseFloat(m[1]);
    switch (m[2]) {
      case "k":
        n *= 1e3;
        break;
      case "w":
        n *= 1e4;
        break;
      case "m":
        n *= 1e6;
        break;
      case "b":
        n *= 1e9;
        break;
    }
    return n;
  }

  override async getSeries(
    seriesId: string,
    url?: string,
  ): Promise<ISeriesResult | null> {
    // 优先使用传入的URL，否则根据ID构造URL
    const pageUrl = url ?? new URL(`/detail/${seriesId}`, this.baseUrl).href;
    const page = await getDocument(pageUrl.replace("http://", "https://"));
    const node = page.querySelectorAll(".tab-content > .tab-pane");
    const res: IEpisode[] = [];
    for (const el of node) {
      const name = el.id.substring("playlist-source-".length);
      const link = el.querySelectorAll("a[href]");
      for (const ep of link) {
        const href = ep.getAttribute("href");
        const id = href?.match(/(\d+\/\d+)\/?$/)?.[1];
        const episodeUrl = httpUrlOrEmpty(href, this.baseUrl);
        if (!href || !id || !episodeUrl) continue;
        res.push({
          title: ep.innerText + " - " + name,
          episodeNumber: parsePositiveInteger(
            ep.innerText.match(/[0-9]+/)?.[0],
            0,
          ),
          id,
          seriesId,
          url: episodeUrl,
        });
      }
    }

    const detailDiv = page.querySelector(".video_detail_wrapper");
    const extraDiv = page.querySelector(".video_detail_extra");
    const tableDiv = page.querySelector(".detail_imform_list");
    const result: Partial<ISeriesResult> = {
      episodes: res,
      seriesId,
      title: detailDiv?.querySelector(".video_detail_title")?.innerText ||
        seriesId,
      source: this.sourceId,
      totalEpisodes: res.length,
      description: detailDiv?.querySelector(".video_detail_desc")?.innerText,
      id: seriesId,
    };

    // fill extra
    for (const div of extraDiv?.children ?? []) {
      const i = div.getElementsByTagName("i")[0];
      if (!i) continue;
      i.remove();
      const r = div.innerText.trim();
      switch (i.classList[0]) {
        case "bi-fire":
          result.views = this.parseViews(r);
          break;

        case "bi-chat-square-text":
          // todo: comments
          break;

        case "bi-heart":
          // todo: likes
          break;
      }
    }

    // fill table
    for (const item of tableDiv?.children ?? []) {
      const [k, v] = item.children;
      if (!k || !v) continue;
      const val = v.innerText.trim();
      switch (k.innerText.trim()) {
        case "动画种类":
          result.type = val == "TV"
            ? "anime"
            : val == "剧场版"
            ? "movie"
            : "other";
          break;

        case "原版名称":
          result.originalTitle = val;
          break;

        case "播放状态":
          result.status = val == "完结"
            ? "completed"
            : val == "连载"
            ? "ongoing"
            : "upcoming";
          break;

        case "首播时间":
          result.year = parseAgefansYear(val);
          break;

        case "剧情类型":
        case "标签":
          result.tags = val.split(/\s+/);
          break;
      }
    }

    return result as ISeriesResult;
  }

  private sandboxEval(code: string) {
    code = code.substring(0, code.indexOf("document.createElement")) + "null";
    code += "\n return { Ref, PlayConfig, Time, Version, Vurl, PlayerPath };";
    const res = new Function(code)();
    return res as {
      Ref: string;
      PlayConfig: {
        Id: string;
      };
      Time: string;
      Version: string;
      Vurl: string;
      PlayerPath: {
        wasm: string;
      };
    };
  }

  private async __decAES(tmp1: string, data: string) {
    const keyHex = encodeHex(md5(tmp1));
    const keyStr = keyHex.substring(0, 16); // "7cbcd233a9d8acba"
    const ivStr = keyHex.substring(16, 32); // "5e13677548764ccf"

    const keyBytes = new TextEncoder().encode(keyStr); // 16 字节
    const ivBytes = new TextEncoder().encode(ivStr); // 16 字节

    const cipherBytes = decodeHex(data);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: ivBytes },
      cryptoKey,
      cipherBytes,
    );
    return decrypted;
  }

  private async decryptVideoData(
    data: {
      Status: number;
      Code: number;
      Appkey: number;
      Data: string;
      Version: string;
    },
    document: Document,
  ): Promise<
    {
      code: number;
      player: string;
      success: number;
      type: "h5" | "dplayer";
      url: string;
    }
  > {
    assert(data.Status == 1, "Status not OK");
    if (data.Code == 10) {
      // 提取$('meta[http-equiv="Content-Type"]').attr('id')
      const metaH = document.querySelector('meta[http-equiv="Content-Type"]')
        ?.id;
      assert(metaH, "Missing encrypted AGE content-type meta id");

      // 提取 "meta[name=\"viewport\"]"
      const metaV = document.querySelector('meta[name="viewport"]')?.id;
      assert(metaV, "Missing encrypted AGE viewport meta id");

      // 合并
      const tmp1 = data.Code + (metaH + metaV).replace("viewport", "") +
        data.Appkey + data.Version;
      const res = new TextDecoder().decode(
        await this.__decAES(tmp1, data.Data),
      );
      const json = JSON.parse(res);

      assert(this.sandbox, "AGE decrypt sandbox not initialized");
      const final = this.safeDecodeURIComponent(this.sandbox.decrypt(json.url));
      json.url = final;
      return json;
    } else {
      // overload2: iframe
      const tmp = data.Code + data.Appkey + data.Version;
      const res = new TextDecoder().decode(await this.__decAES(tmp, data.Data));
      const json = JSON.parse(res);
      const final = this.safeDecodeURIComponent(json.url);
      json.url = final;
      return json;
    }
  }

  private async extractSign(vurl: string, referrer: string) {
    const page = await getDocument(vurl, {
      referrer,
    });
    const datascr = page.getElementsByTagName("script").filter((e) =>
      /var\s+Version/.test(e.innerText)
    );
    if (!datascr.length) {
      // style2: var Vurl = 'https://vip.ffzy-plays.com/20260104/49193_9973b42c/index.m3u8';
      const match = page.getElementsByTagName("script").map((e) =>
        e.innerText.match(
          /var\s+Vurl\s*\=\s*'(https?\:\/\/[^?]+\.m3u8(\?[^']+)?)';/,
        )
      )
        .filter(Boolean)[0];
      assert(match, "Cannot find url-like. Please update this config");
      return {
        success: true,
        url: match[1],
        type: "dplayer",
      };
    }

    const info = this.sandboxEval(datascr[0].innerText);

    if (!this.sandbox) {
      const wasm = await fetch(info.PlayerPath.wasm);
      if (!wasm.body) throw new Error("无法获取wasm解密套件");

      // inject env
      try {
        this.sandbox = await createSandbox(
          await wasm.bytes(),
          new URL(vurl).host,
        );
      } catch {
        throw new Error("Failed to initialize wasm");
      }
    }

    const base = new URL(vurl);
    base.search = "";
    const param = {
      "url": info.Vurl,
      "wap": "0",
      "ios": "0",
      "host": base.hostname,
      "referer": info.Ref,
      "time": info.Time,
    };
    const enc = this.sandbox.encrypt(JSON.stringify(param)).toUpperCase();

    const turl = new URL("Api.php", base);
    const uuid = crypto.randomUUID();
    const target = await fetch(turl, {
      method: "POST",
      body: `Params=${enc}`,
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Video-Parse-Uuid": uuid, // UUID
        "Video-Parse-Time": info.Time, // 时间戳
        "Video-Parse-Version": info.Version, // 版本号
        // host + '' + uuid + '' + time + '' + version
        "Video-Parse-Sign": this.sandbox.encrypt(
          param.host + " | " +
            uuid + " | " + // UUID
            info.Time + " | " +
            info.Version + " | " +
            enc,
        ).toUpperCase(),
        "Origin": turl.origin,
        "Referer": vurl,
        "X-Requested-With": "XMLHttpRequest",
      },
    }).then((e) => e.json());
    return this.decryptVideoData(target, page);
  }

  override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
    // 拼接完整 URL
    const fullUrl = httpUrlOrEmpty(url, this.baseUrl);
    assert(fullUrl, "Invalid AGE video page URL");
    const page = await getDocument(fullUrl);
    const iframe = page.getElementsByTagName("iframe");
    const iframeSrc = iframe[0]?.getAttribute("src");
    assert(iframeSrc, "Cannot find player iframe");
    const playerUrl = httpUrlOrEmpty(iframeSrc, fullUrl);
    assert(playerUrl, "Invalid AGE player iframe URL");
    const res = await this.extractSign(
      playerUrl,
      fullUrl,
    );
    const mediaUrl = httpUrlOrEmpty(
      this.safeDecodeURIComponent(res.url),
      fullUrl,
    );
    assert(mediaUrl, "Invalid AGE media URL");
    return [
      {
        quality: "1080p",
        url: mediaUrl,
        format: this.inferFormat(mediaUrl, res.type),
        proxy: URLProxy.LOCAL,
      },
    ];
  }

  private safeDecodeURIComponent(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private inferFormat(src: string, type?: string): IVideoURL["format"] {
    return inferMediaFormat(src, type);
  }
}
