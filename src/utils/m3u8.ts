import { logDebug, logError, logInfo } from "./logger.ts";
import type {
  IM3U8Manifest,
  IM3U8MediaGroup,
  IM3U8Segment,
  IM3U8Variant,
  IVideoURL,
} from "../types/index.ts";
import { fetch2 } from "./fetch.ts";

export class URLResolver {
  private readonly baseUrl: URL;

  constructor(baseUrl: string) {
    try {
      this.baseUrl = new URL(baseUrl);
    } catch (error) {
      logError(`Invalid base URL: ${baseUrl}`, error);
      throw new Error(`Invalid base URL: ${baseUrl}`);
    }
  }

  /**
   * 将相对URL解析为绝对URL
   */
  resolve(url: string): string {
    if (!url) return url;

    // 已经是绝对URL
    if (/^https?:\/\//i.test(url)) return url;

    // 协议相对URL
    if (url.startsWith("//")) return `${this.baseUrl.protocol}${url}`;

    try {
      return new URL(url, this.baseUrl).href;
    } catch (error) {
      logError(`URL解析失败: ${url}`, error);
      return url; // 降级处理
    }
  }

  /**
   * 提取URL的基础路径
   */
  getBasePath(): string {
    const path = this.baseUrl.pathname;
    return path.substring(0, path.lastIndexOf("/") + 1);
  }

  /**
   * 获取Referer和Origin头
   */
  getRequestHeaders(): { referer: string; origin: string } {
    return {
      referer: this.baseUrl.origin,
      origin: this.baseUrl.origin,
    };
  }
}

export class M3U8Parser {
  private readonly urlResolver: URLResolver;

  constructor(baseUrl: string) {
    this.urlResolver = new URLResolver(baseUrl);
  }

  /**
   * 解析M3U8主播放列表
   */
  parseMasterPlaylist(content: string): IM3U8Manifest {
    const lines = this.preprocessLines(content);
    const manifest: IM3U8Manifest = this.createEmptyManifest();
    const variants = manifest.variants ?? [];
    manifest.variants = variants;

    let currentVariant: Partial<IM3U8Variant> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const tag = line.toUpperCase();

      if (!line) continue;

      if (tag.startsWith("#EXT-X-STREAM-INF:")) {
        currentVariant = this.parseStreamInf(line);
      } else if (tag.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
        const iframeVariant = this.parseStreamInf(line);
        const attrs = this.parseAttributes(line);
        if (attrs.URI) {
          iframeVariant.uri = this.urlResolver.resolve(attrs.URI);
          iframeVariant.iframe = true;
          variants.push(iframeVariant as IM3U8Variant);
        }
      } else if (tag.startsWith("#EXT-X-MEDIA:")) {
        const mediaGroup = this.parseMedia(line);
        if (mediaGroup) {
          if (!manifest.mediaGroups) manifest.mediaGroups = {};
          const groupType = mediaGroup.type.toLowerCase() as keyof NonNullable<
            IM3U8Manifest["mediaGroups"]
          >;
          const typeMap = manifest.mediaGroups[groupType] || new Map();
          typeMap.set(
            `${mediaGroup.groupId}:${mediaGroup.name}:${mediaGroup.uri || ""}`,
            mediaGroup,
          );
          manifest.mediaGroups[groupType] = typeMap;
        }
      } else if (!line.startsWith("#")) {
        // 变体URL行
        if (Object.keys(currentVariant).length === 0) continue;
        currentVariant.uri = this.urlResolver.resolve(line.trim());
        variants.push(currentVariant as IM3U8Variant);
        currentVariant = {};
      }
    }

    return manifest;
  }

  /**
   * 解析M3U8媒体播放列表
   */
  parseMediaPlaylist(content: string): IM3U8Manifest {
    const lines = this.preprocessLines(content);
    const manifest = this.createEmptyManifest();

    let currentSegment: Partial<IM3U8Segment> = {};
    let currentKey: IM3U8Segment["key"];
    let currentMap: IM3U8Segment["map"];
    let expectSegmentUri = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const tag = line.toUpperCase();

      if (this.isComment(line)) {
        // 解析关键标签
        if (tag.startsWith("#EXT-X-VERSION:")) {
          manifest.version = parseInt(line.split(":")[1]) || 3;
        } else if (tag.startsWith("#EXT-X-TARGETDURATION:")) {
          manifest.targetDuration = parseInt(line.split(":")[1]) || 60;
        } else if (tag.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
          manifest.mediaSequence = parseInt(line.split(":")[1]) || 0;
        } else if (tag.startsWith("#EXT-X-ENDLIST")) {
          manifest.endList = true;
        } else if (tag.startsWith("#EXTINF:")) {
          const { duration, title } = this.parseExtInf(line);
          currentSegment.duration = duration;
          currentSegment.title = title;
          expectSegmentUri = true;
        } else if (tag.startsWith("#EXT-X-KEY:")) {
          currentKey = this.parseKey(line);
        } else if (tag.startsWith("#EXT-X-MAP:")) {
          currentMap = this.parseMap(line);
        } else if (tag.startsWith("#EXT-X-BYTERANGE:")) {
          currentSegment.byterange = line.split(":").slice(1).join(":");
        } else if (tag.startsWith("#EXT-X-DISCONTINUITY")) {
          currentSegment.discontinuity = true;
        } else if (tag.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
          currentSegment.programDateTime = line.split(":").slice(1).join(":");
        }
      } else if (line && expectSegmentUri) {
        // 片段URL
        currentSegment.uri = this.urlResolver.resolve(line.trim());
        currentSegment.sequence = manifest.mediaSequence +
          manifest.segments.length;

        // 应用当前的加密和映射
        if (currentKey) currentSegment.key = currentKey;
        if (currentMap) currentSegment.map = currentMap;

        manifest.segments.push(currentSegment as IM3U8Segment);

        // 重置
        currentSegment = {};
        expectSegmentUri = false;
      }
    }

    return manifest;
  }

  /**
   * 判断是主播放列表还是媒体播放列表
   */
  static identifyPlaylistType(content: string): "master" | "media" {
    if (!this.isPlaylistContent(content)) {
      throw new Error("不是有效的 M3U8 播放列表");
    }
    const normalized = content.toUpperCase();
    return normalized.includes("#EXT-X-STREAM-INF:") ||
        normalized.includes("#EXT-X-I-FRAME-STREAM-INF:") ||
        normalized.includes("#EXT-X-MEDIA:")
      ? "master"
      : "media";
  }

  static isPlaylistContent(content: string): boolean {
    const firstLine = content.replace(/^\uFEFF/, "").trimStart().split(
      /\r?\n/,
      1,
    )[0]
      ?.trim();
    return firstLine === "#EXTM3U";
  }

  /**
   * 重写M3U8内容中的所有URL
   */
  rewriteUrls(content: string): string {
    const lines = this.preprocessLines(content);

    return lines.map((line) => {
      // 跳过注释和空行
      if (!line || line.startsWith("#")) return line;

      // 解析URL行
      return this.urlResolver.resolve(line.trim());
    }).join("\n");
  }

  // 私有辅助方法
  private preprocessLines(content: string): string[] {
    return content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd());
  }

  private isComment(line: string): boolean {
    return line.startsWith("#");
  }

  private createEmptyManifest(): IM3U8Manifest {
    return {
      version: 3,
      targetDuration: 60,
      mediaSequence: 0,
      endList: false,
      segments: [],
      variants: [],
    };
  }

  private parseExtInf(line: string): { duration: number; title?: string } {
    const match = line.match(/^#EXTINF:([^,]+)(?:,(.*))?$/i);
    if (!match) return { duration: 0 };
    const duration = parseFloat(match[1]);

    return {
      duration: Number.isFinite(duration) ? duration : 0,
      title: match[2] || undefined,
    };
  }

  private parseStreamInf(line: string): Partial<IM3U8Variant> {
    const attrs = this.parseAttributes(line);
    const bandwidth = this.parseInteger(attrs.BANDWIDTH);
    const averageBandwidth = this.parseInteger(attrs["AVERAGE-BANDWIDTH"]);
    const frameRate = this.parseNumber(attrs["FRAME-RATE"]);
    const resolution = attrs.RESOLUTION
      ? this.parseResolution(attrs.RESOLUTION)
      : undefined;

    return {
      bandwidth,
      averageBandwidth,
      codecs: attrs.CODECS,
      resolution,
      frameRate,
      hdcpLevel: attrs["HDCP-LEVEL"],
      audio: attrs.AUDIO,
      video: attrs.VIDEO,
      subtitles: attrs.SUBTITLES,
      closedCaptions: attrs["CLOSED-CAPTIONS"],
      name: attrs.NAME,
    };
  }

  private parseKey(line: string): IM3U8Segment["key"] {
    const attrs = this.parseAttributes(line);
    const iv = attrs.IV ? this.hexStringToBytes(attrs.IV) : undefined;

    // 即使METHOD缺失也应保留其他可能的属性
    return {
      method: attrs.METHOD,
      uri: attrs.URI ? this.urlResolver.resolve(attrs.URI) : undefined,
      iv: iv && iv.length > 0 ? iv : undefined,
      format: attrs.KEYFORMAT,
      keyFormatVersions: attrs.KEYFORMATVERSIONS,
    };
  }

  private parseMap(line: string): IM3U8Segment["map"] {
    const attrs = this.parseAttributes(line);
    if (!attrs.URI) return undefined;

    return {
      uri: this.urlResolver.resolve(attrs.URI),
      byterange: attrs.BYTERANGE,
    };
  }

  private parseMedia(line: string): IM3U8MediaGroup | null {
    const attrs = this.parseAttributes(line);
    const type = attrs.TYPE as IM3U8MediaGroup["type"];

    if (!type || !attrs["GROUP-ID"] || !attrs.NAME) {
      logDebug("Invalid EXT-X-MEDIA tag: missing required attributes");
      return null;
    }

    return {
      type,
      groupId: attrs["GROUP-ID"],
      name: attrs.NAME,
      default: attrs.DEFAULT === "YES",
      autoselect: attrs.AUTOSELECT === "YES",
      forced: attrs.FORCED === "YES",
      language: attrs.LANGUAGE,
      uri: attrs.URI ? this.urlResolver.resolve(attrs.URI) : undefined,
      characteristics: attrs.CHARACTERISTICS,
    };
  }

  private parseAttributes(line: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const match = line.match(/^\#[A-Z-]+:(.*)$/i);
    if (!match) return attrs;

    const attrString = match[1];
    const regex = /([A-Z0-9-]+)=?("[^"]*"|[^,]*)/gi;

    let m;
    while ((m = regex.exec(attrString)) !== null) {
      const key = m[1].toUpperCase();
      let value = m[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      attrs[key] = value || "";
    }

    return attrs;
  }

  private parseInteger(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseResolution(
    resolution: string,
  ): { width: number; height: number } | undefined {
    const [width, height] = resolution.split("x").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    return { width, height };
  }

  private hexStringToBytes(hex: string): Uint8Array {
    let normalized = hex.trim().replace(/^0x/i, "");
    if (!/^[0-9a-f]*$/i.test(normalized)) {
      return new Uint8Array();
    }
    if (normalized.length % 2 === 1) {
      normalized = `0${normalized}`;
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
      bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
    }
    return bytes;
  }
}

export class M3U8Service {
  /**
   * 获取并解析M3U8
   */
  static async fetchManifest(url: string): Promise<IM3U8Manifest> {
    try {
      logInfo(`Fetching M3U8: ${url}`);

      const response = await fetch2(url, {
        headers: {
          "Accept":
            "application/vnd.apple.mpegurl, application/x-mpegurl, text/plain",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      const parser = new M3U8Parser(url);
      const type = M3U8Parser.identifyPlaylistType(content);

      return type === "master"
        ? parser.parseMasterPlaylist(content)
        : parser.parseMediaPlaylist(content);
    } catch (error) {
      logError(`Failed to fetch M3U8: ${url}`, error);
      throw error;
    }
  }

  /**
   * 创建代理M3U8内容（用于FFmpeg）
   */
  static async createProxyM3U8(originalUrl: string): Promise<string> {
    const manifest = await this.fetchManifest(originalUrl);

    // 重新序列化，所有URL已自动替换
    return this.serializeManifest(manifest);
  }

  /**
   * 将Manifest序列化为M3U8内容
   */
  static serializeManifest(
    manifest: IM3U8Manifest,
    additionalQuery?: Record<string, string | undefined>,
  ): string {
    const lines: string[] = ["#EXTM3U"];
    const isMedia = Boolean(manifest.segments?.length);

    // 版本
    if (manifest.version) {
      lines.push(`#EXT-X-VERSION:${manifest.version}`);
    }

    // 目标时长
    if (isMedia && manifest.targetDuration) {
      lines.push(`#EXT-X-TARGETDURATION:${manifest.targetDuration}`);
    }

    // 媒体序列
    if (isMedia && Number.isFinite(manifest.mediaSequence)) {
      lines.push(`#EXT-X-MEDIA-SEQUENCE:${manifest.mediaSequence}`);
    }

    if (manifest.mediaGroups) {
      for (const groups of Object.values(manifest.mediaGroups)) {
        for (const mediaGroup of groups.values()) {
          lines.push(
            `#EXT-X-MEDIA:${this.buildMediaAttrs(mediaGroup, additionalQuery)}`,
          );
        }
      }
    }

    // 变体（主播放列表）
    if (manifest.variants?.length) {
      for (const variant of manifest.variants) {
        const attrs = this.buildVariantAttrs(variant);
        const uri = this.buildProxyUrl("m3u8", variant.uri, additionalQuery, {
          type: "m3u8",
        });
        if (variant.iframe) {
          lines.push(
            `#EXT-X-I-FRAME-STREAM-INF:${attrs}${attrs ? "," : ""}URI="${uri}"`,
          );
        } else {
          lines.push(`#EXT-X-STREAM-INF:${attrs}`);
          lines.push(uri);
        }
      }
    }

    // 片段（媒体播放列表）
    if (manifest.segments?.length) {
      let lastKey: IM3U8Segment["key"] | undefined = undefined;
      let lastMap: IM3U8Segment["map"] | undefined = undefined;

      for (const segment of manifest.segments) {
        // 检查KEY是否发生变化
        if (segment.key && !this.isSameKey(lastKey, segment.key)) {
          const keyAttrs = this.buildKeyAttrs(segment.key, additionalQuery);
          lines.push(`#EXT-X-KEY:${keyAttrs}`);
          lastKey = segment.key;
        }

        // 初始化片段
        if (segment.map && !this.isSameMap(lastMap, segment.map)) {
          const mapAttrs = this.buildMapAttrs(segment.map, additionalQuery);
          lines.push(`#EXT-X-MAP:${mapAttrs}`);
          lastMap = segment.map;
        }

        //  discontinuity
        if (segment.discontinuity) {
          lines.push("#EXT-X-DISCONTINUITY");
        }

        // 节目时间
        if (segment.programDateTime) {
          lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segment.programDateTime}`);
        }

        // 片段信息
        const duration = Number.isFinite(segment.duration)
          ? segment.duration
          : 0;
        lines.push(
          `#EXTINF:${duration.toFixed(3)}${
            segment.title ? "," + this.lineValue(segment.title) : ""
          }`,
        );
        if (segment.byterange) {
          lines.push(`#EXT-X-BYTERANGE:${this.lineValue(segment.byterange)}`);
        }
        lines.push(this.buildSegmentProxyUrl(segment.uri, additionalQuery));
      }
    }

    // 结束标记
    if (isMedia && manifest.endList) {
      lines.push("#EXT-X-ENDLIST");
    }

    return lines.join("\n");
  }

  private static buildVariantAttrs(variant: IM3U8Variant): string {
    const attrs: string[] = [];

    if (Number.isFinite(variant.bandwidth)) {
      attrs.push(`BANDWIDTH=${variant.bandwidth}`);
    }

    if (Number.isFinite(variant.averageBandwidth)) {
      attrs.push(`AVERAGE-BANDWIDTH=${variant.averageBandwidth}`);
    }

    if (variant.codecs) {
      attrs.push(`CODECS="${this.quoted(variant.codecs)}"`);
    }

    if (variant.resolution) {
      attrs.push(
        `RESOLUTION=${variant.resolution.width}x${variant.resolution.height}`,
      );
    }

    if (Number.isFinite(variant.frameRate)) {
      attrs.push(`FRAME-RATE=${variant.frameRate}`);
    }

    if (variant.hdcpLevel) {
      attrs.push(`HDCP-LEVEL=${this.lineValue(variant.hdcpLevel)}`);
    }

    if (variant.audio) {
      attrs.push(`AUDIO="${this.quoted(variant.audio)}"`);
    }

    if (variant.video) {
      attrs.push(`VIDEO="${this.quoted(variant.video)}"`);
    }

    if (variant.subtitles) {
      attrs.push(`SUBTITLES="${this.quoted(variant.subtitles)}"`);
    }

    if (variant.closedCaptions) {
      const value = variant.closedCaptions === "NONE"
        ? "NONE"
        : `"${this.quoted(variant.closedCaptions)}"`;
      attrs.push(`CLOSED-CAPTIONS=${value}`);
    }

    if (variant.name) {
      attrs.push(`NAME="${this.quoted(variant.name)}"`);
    }

    return attrs.join(",");
  }

  private static buildMediaAttrs(
    mediaGroup: IM3U8MediaGroup,
    additionalQuery?: Record<string, string | undefined>,
  ): string {
    const attrs = [
      `TYPE=${mediaGroup.type}`,
      `GROUP-ID="${this.quoted(mediaGroup.groupId)}"`,
      `NAME="${this.quoted(mediaGroup.name)}"`,
    ];

    if (mediaGroup.default) attrs.push("DEFAULT=YES");
    if (mediaGroup.autoselect) attrs.push("AUTOSELECT=YES");
    if (mediaGroup.forced) attrs.push("FORCED=YES");
    if (mediaGroup.language) {
      attrs.push(`LANGUAGE="${this.quoted(mediaGroup.language)}"`);
    }
    if (mediaGroup.uri) {
      attrs.push(
        `URI="${
          this.buildProxyUrl("m3u8", mediaGroup.uri, additionalQuery, {
            type: "m3u8",
          })
        }"`,
      );
    }
    if (mediaGroup.characteristics) {
      attrs.push(
        `CHARACTERISTICS="${this.quoted(mediaGroup.characteristics)}"`,
      );
    }

    return attrs.join(",");
  }

  private static buildProxyUrl(
    name: string,
    url: string,
    additionalQuery?: Record<string, string | undefined>,
    extraQuery?: Record<string, string | undefined>,
  ): string {
    if (!this.isHttpUrl(url)) return url;
    const params = new URLSearchParams({ url });
    for (const [key, value] of Object.entries(extraQuery || {})) {
      if (value) params.set(key, value);
    }
    for (const [key, value] of Object.entries(additionalQuery || {})) {
      if (value) params.set(key, value);
    }
    return `/api/proxy/${encodeURIComponent(name)}?${params.toString()}`;
  }

  private static buildSegmentProxyUrl(
    url: string,
    additionalQuery?: Record<string, string | undefined>,
  ): string {
    const name = this.proxyFileName(url, "segment.bin");
    const isTs = this.urlPathname(url).toLowerCase().endsWith(".ts");
    return this.buildProxyUrl(
      isTs ? "chunk.ts" : name,
      url,
      additionalQuery,
      { type: isTs ? "ts" : "segment" },
    );
  }

  private static proxyFileName(url: string, fallback: string): string {
    const pathname = this.urlPathname(url);
    const name = pathname.split("/").filter(Boolean).pop();
    return name || fallback;
  }

  private static urlPathname(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split("?")[0];
    }
  }

  private static isHttpUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private static buildKeyAttrs(
    key: NonNullable<IM3U8Segment["key"]>,
    additionalQuery?: Record<string, string | undefined>,
  ): string {
    const attrs: string[] = [];

    if (key.method) {
      attrs.push(`METHOD=${key.method}`);
    }

    if (key.uri) {
      const uri = this.buildProxyUrl("key", key.uri, additionalQuery, {
        type: "key",
      });
      attrs.push(`URI="${uri}"`);
    }

    if (key.iv) {
      attrs.push(`IV=0x${this.bytesToHex(key.iv)}`);
    }

    if (key.format) {
      attrs.push(`KEYFORMAT="${this.quoted(key.format)}"`);
    }

    if (key.keyFormatVersions) {
      attrs.push(`KEYFORMATVERSIONS="${this.quoted(key.keyFormatVersions)}"`);
    }

    return attrs.join(",");
  }

  private static buildMapAttrs(
    map: NonNullable<IM3U8Segment["map"]>,
    additionalQuery?: Record<string, string | undefined>,
  ): string {
    const uri = this.buildProxyUrl("map", map.uri, additionalQuery, {
      type: "map",
    });
    const attrs: string[] = [
      `URI="${uri}"`,
    ];

    if (map.byterange) {
      attrs.push(`BYTERANGE="${this.quoted(map.byterange)}"`);
    }

    return attrs.join(",");
  }

  private static bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private static isSameKey(
    key1: IM3U8Segment["key"] | undefined,
    key2: IM3U8Segment["key"] | undefined,
  ): boolean {
    if (!key1 && !key2) return true;
    if (!key1 || !key2) return false;

    // 比较基本属性
    if (
      key1.method !== key2.method ||
      key1.uri !== key2.uri ||
      key1.format !== key2.format ||
      key1.keyFormatVersions !== key2.keyFormatVersions
    ) {
      return false;
    }

    // 比较IV（如果都存在）
    if (key1.iv && key2.iv) {
      if (key1.iv.length !== key2.iv.length) {
        return false;
      }
      for (let i = 0; i < key1.iv.length; i++) {
        if (key1.iv[i] !== key2.iv[i]) {
          return false;
        }
      }
    } else if (key1.iv || key2.iv) {
      // 如果只有一个有IV
      return false;
    }

    return true;
  }

  private static isSameMap(
    map1: IM3U8Segment["map"] | undefined,
    map2: IM3U8Segment["map"] | undefined,
  ): boolean {
    if (!map1 && !map2) return true;
    if (!map1 || !map2) return false;
    return map1.uri === map2.uri && map1.byterange === map2.byterange;
  }

  private static quoted(value: string): string {
    return this.lineValue(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private static lineValue(value: string): string {
    return value.replace(/[\r\n]/g, " ");
  }

  /**
   * 修复TS流数据（查找同步字节）
   */
  static fixTSStream(data: Uint8Array): Uint8Array {
    const syncByte = 0x47; // TS包同步字节
    const packetSize = 188;

    // 查找第一个同步字节
    for (let i = 0; i < Math.min(data.length, 1000); i++) {
      if (data[i] === syncByte) {
        // 验证后续包
        if (i + packetSize < data.length && data[i + packetSize] === syncByte) {
          logDebug(`Found TS sync at offset 0x${i.toString(16)}`);
          return data.slice(i);
        }
      }
    }

    logDebug("No valid TS sync found, returning original data");
    return data;
  }

  /**
   * 推断质量等级
   */
  private static inferQuality(variant: IM3U8Variant): string {
    if (!variant.resolution) return "unknown";
    const height = variant.resolution.height;

    if (height >= 2160) return "4K";
    if (height >= 1440) return "1440p";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    return "360p";
  }

  /**
   * 向后兼容：fetchAndParseM3U8（解析主播放列表）
   */
  static async fetchAndParseM3U8(url: string): Promise<IVideoURL[]> {
    try {
      logInfo(`Fetching master playlist: ${url}`);

      const manifest = await this.fetchManifest(url);

      if (!manifest.variants?.length && manifest.segments.length) {
        return [{
          url,
          quality: "默认",
          format: "m3u8",
        }];
      }

      // 转换为旧的M3U8Result格式
      return (manifest.variants || []).filter((variant) => !variant.iframe).map(
        (variant) => ({
          url: variant.uri,
          quality: variant.name || this.inferQuality(variant),
          resolution: variant.resolution
            ? `${variant.resolution.width}x${variant.resolution.height}`
            : undefined,
          bandwidth: variant.bandwidth,
          format: "m3u8" as const,
        }),
      );
    } catch (error) {
      logError(`Failed to fetchAndParseM3U8: ${url}`, error);
      return [];
    }
  }

  /**
   * 向后兼容：fetchAndParseM3U8Segments（解析媒体播放列表）
   */
  static async fetchAndParseM3U8Segments(url: string): Promise<IM3U8Segment[]> {
    try {
      logInfo(`Fetching media playlist: ${url}`);

      const manifest = await this.fetchManifest(url);
      return manifest.segments;
    } catch (error) {
      logError(`Failed to fetchAndParseM3U8Segments: ${url}`, error);
      return [];
    }
  }
}
