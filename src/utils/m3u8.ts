import { logDebug, logError, logInfo } from "./logger.ts";
import type { IM3U8Manifest, IM3U8Variant, IM3U8Segment, IM3U8MediaGroup, IM3U8Result } from "../types/index.ts";
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
        if (url.startsWith('//')) return `${this.baseUrl.protocol}${url}`;

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
        return path.substring(0, path.lastIndexOf('/') + 1);
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

        let currentVariant: Partial<IM3U8Variant> = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (this.isComment(line)) continue;

            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                currentVariant = this.parseStreamInf(line);
            } else if (line && !line.startsWith('#')) {
                // 变体URL行
                currentVariant.uri = this.urlResolver.resolve(line.trim());
                manifest.variants!.push(currentVariant as IM3U8Variant);
                currentVariant = {};
            } else if (line.startsWith('#EXT-X-MEDIA:')) {
                const mediaGroup = this.parseMedia(line);
                if (mediaGroup) {
                    if (!manifest.mediaGroups) manifest.mediaGroups = {};
                    // @ts-ignore 忽略类型检查，因为 mediaGroups 是动态添加的
                    const typeMap = manifest.mediaGroups[mediaGroup.type.toLowerCase()] || new Map();
                    typeMap.set(mediaGroup.groupId, mediaGroup);
                    // @ts-ignore 忽略类型检查，因为 mediaGroups 是动态添加的
                    manifest.mediaGroups[mediaGroup.type.toLowerCase()] = typeMap;
                }
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
        let currentKey: IM3U8Segment['key'];
        let currentMap: IM3U8Segment['map'];
        let expectSegmentUri = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (this.isComment(line)) {
                // 解析关键标签
                if (line.startsWith('#EXT-X-VERSION:')) {
                    manifest.version = parseInt(line.split(':')[1]) || 3;
                } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
                    manifest.targetDuration = parseInt(line.split(':')[1]) || 60;
                } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                    manifest.mediaSequence = parseInt(line.split(':')[1]) || 0;
                } else if (line.startsWith('#EXT-X-ENDLIST')) {
                    manifest.endList = true;
                } else if (line.startsWith('#EXTINF:')) {
                    const { duration, title } = this.parseExtInf(line);
                    currentSegment.duration = duration;
                    currentSegment.title = title;
                    expectSegmentUri = true;
                } else if (line.startsWith('#EXT-X-KEY:')) {
                    currentKey = this.parseKey(line);
                } else if (line.startsWith('#EXT-X-MAP:')) {
                    currentMap = this.parseMap(line);
                } else if (line.startsWith('#EXT-X-DISCONTINUITY')) {
                    currentSegment.discontinuity = true;
                } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
                    currentSegment.programDateTime = line.split(':').slice(1).join(':');
                }
            } else if (line && expectSegmentUri) {
                // 片段URL
                currentSegment.uri = this.urlResolver.resolve(line.trim());
                currentSegment.sequence = manifest.mediaSequence + manifest.segments.length;

                // 应用当前的加密和映射
                if (currentKey?.uri) currentSegment.key = currentKey;
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
    static identifyPlaylistType(content: string): 'master' | 'media' {
        return content.includes('#EXT-X-STREAM-INF:') ? 'master' : 'media';
    }

    /**
     * 重写M3U8内容中的所有URL
     */
    rewriteUrls(content: string): string {
        const lines = this.preprocessLines(content);
        const manifestType = M3U8Parser.identifyPlaylistType(content);

        return lines.map(line => {
            // 跳过注释和空行
            if (!line || line.startsWith('#')) return line;

            // 解析URL行
            return this.urlResolver.resolve(line.trim());
        }).join('\n');
    }

    // 私有辅助方法
    private preprocessLines(content: string): string[] {
        return content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map(line => line.trimEnd());
    }

    private isComment(line: string): boolean {
        return line.startsWith('#');
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
        const match = line.match(/^#EXTINF:([^\,]+)\,(.*)$/);
        if (!match) return { duration: 0 };

        return {
            duration: parseFloat(match[1]),
            title: match[2] || undefined,
        };
    }

    private parseStreamInf(line: string): Partial<IM3U8Variant> {
        const attrs = this.parseAttributes(line);
        const resolution = attrs.RESOLUTION ? this.parseResolution(attrs.RESOLUTION) : undefined;

        return {
            bandwidth: parseInt(attrs.BANDWIDTH || '0'),
            averageBandwidth: attrs.AVERAGE_BANDWIDTH ? parseInt(attrs.AVERAGE_BANDWIDTH) : undefined,
            codecs: attrs.CODECS,
            resolution,
            frameRate: attrs.FRAME_RATE ? parseFloat(attrs.FRAME_RATE) : undefined,
            hdcpLevel: attrs.HDCP_LEVEL,
            audio: attrs.AUDIO,
            video: attrs.VIDEO,
            subtitles: attrs.SUBTITLES,
            closedCaptions: attrs['CLOSED-CAPTIONS'],
            name: attrs.NAME,
        };
    }

    private parseKey(line: string): IM3U8Segment['key'] {
        const attrs = this.parseAttributes(line);

        // 即使METHOD缺失也应保留其他可能的属性
        return {
            method: attrs.METHOD,
            uri: attrs.URI ? this.urlResolver.resolve(attrs.URI) : undefined,
            iv: attrs.IV ? this.hexStringToBytes(attrs.IV) : undefined,
            format: attrs.KEYFORMAT,
            keyFormatVersions: attrs.KEYFORMATVERSIONS,
        };
    }

    private parseMap(line: string): IM3U8Segment['map'] {
        const attrs = this.parseAttributes(line);
        if (!attrs.URI) return undefined;

        return {
            uri: this.urlResolver.resolve(attrs.URI),
            byterange: attrs.BYTERANGE,
        };
    }

    private parseMedia(line: string): IM3U8MediaGroup | null {
        const attrs = this.parseAttributes(line);
        const type = attrs.TYPE as IM3U8MediaGroup['type'];

        if (!type || !attrs.GROUP_ID || !attrs.NAME) {
            logDebug('Invalid EXT-X-MEDIA tag: missing required attributes');
            return null;
        }

        return {
            type,
            groupId: attrs.GROUP_ID,
            name: attrs.NAME,
            default: attrs.DEFAULT === 'YES',
            autoselect: attrs.AUTOSELECT === 'YES',
            forced: attrs.FORCED === 'YES',
            language: attrs.LANGUAGE,
            uri: attrs.URI ? this.urlResolver.resolve(attrs.URI) : undefined,
            characteristics: attrs.CHARACTERISTICS,
        };
    }

    private parseAttributes(line: string): Record<string, string> {
        const attrs: Record<string, string> = {};
        const match = line.match(/^\#[A-Z-]+:(.*)$/);
        if (!match) return attrs;

        const attrString = match[1];
        const regex = /([A-Z0-9-]+)=?("[^"]*"|[^,]*)/g;

        let m;
        while ((m = regex.exec(attrString)) !== null) {
            const key = m[1];
            let value = m[2];
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            attrs[key] = value || '';
        }

        return attrs;
    }

    private parseResolution(resolution: string): { width: number; height: number } {
        const [width, height] = resolution.split('x').map(Number);
        return { width, height };
    }

    private hexStringToBytes(hex: string): Uint8Array {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
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
                    'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const content = await response.text();
            const parser = new M3U8Parser(url);
            const type = M3U8Parser.identifyPlaylistType(content);

            return type === 'master'
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
        const parser = new M3U8Parser(originalUrl);

        // 重新序列化，所有URL已自动替换
        return this.serializeManifest(manifest);
    }

    /**
     * 将Manifest序列化为M3U8内容
     */
    static serializeManifest(manifest: IM3U8Manifest, additionalQuery?: Record<string, string | undefined>): string {
        const lines: string[] = ['#EXTM3U'];
        const addQuery = Object.entries(additionalQuery || {})
            .filter(([_, v]) => v)
            .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');

        // 版本
        if (manifest.version) {
            lines.push(`#EXT-X-VERSION:${manifest.version}`);
        }

        // 目标时长
        if (manifest.targetDuration) {
            lines.push(`#EXT-X-TARGETDURATION:${manifest.targetDuration}`);
        }

        // 媒体序列
        if (manifest.mediaSequence) {
            lines.push(`#EXT-X-MEDIA-SEQUENCE:${manifest.mediaSequence}`);
        }

        // 变体（主播放列表）
        if (manifest.variants?.length) {
            for (const variant of manifest.variants) {
                const attrs = this.buildVariantAttrs(variant);
                lines.push(`#EXT-X-STREAM-INF:${attrs}`);
                lines.push('/api/proxy/m3u8?url=' + encodeURIComponent(variant.uri) + (addQuery ? '&' + addQuery : ''));
            }
        }

        // 片段（媒体播放列表）
        if (manifest.segments?.length) {
            let lastKey: IM3U8Segment['key'] | undefined = undefined;

            for (const segment of manifest.segments) {
                // 检查KEY是否发生变化
                if (segment.key?.uri && !this.isSameKey(lastKey, segment.key)) {
                    const keyAttrs = this.buildKeyAttrs(segment.key, addQuery);
                    lines.push(`#EXT-X-KEY:${keyAttrs}`);
                    lastKey = segment.key;
                }

                // 初始化片段
                if (segment.map) {
                    const mapAttrs = this.buildMapAttrs(segment.map, addQuery);
                    lines.push(`#EXT-X-MAP:${mapAttrs}`);
                }

                //  discontinuity
                if (segment.discontinuity) {
                    lines.push('#EXT-X-DISCONTINUITY');
                }

                // 节目时间
                if (segment.programDateTime) {
                    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segment.programDateTime}`);
                }

                // 片段信息
                lines.push(`#EXTINF:${segment.duration.toFixed(3)}${segment.title ? ',' + segment.title : ''}`);
                if (addQuery)
                    lines.push('/api/proxy/chunk.ts?type=ts&url=' + encodeURIComponent(segment.uri) + '&' + addQuery);
                else
                    lines.push('/api/proxy/chunk.ts?type=ts&url=' + encodeURIComponent(segment.uri));
            }
        }

        // 结束标记
        if (manifest.endList) {
            lines.push('#EXT-X-ENDLIST');
        }

        return lines.join('\n');
    }

    private static buildVariantAttrs(variant: IM3U8Variant): string {
        const attrs: string[] = [
            `BANDWIDTH=${variant.bandwidth}`,
        ];

        if (variant.averageBandwidth) {
            attrs.push(`AVERAGE-BANDWIDTH=${variant.averageBandwidth}`);
        }

        if (variant.codecs) {
            attrs.push(`CODECS="${variant.codecs}"`);
        }

        if (variant.resolution) {
            attrs.push(`RESOLUTION=${variant.resolution.width}x${variant.resolution.height}`);
        }

        // ... 其他属性

        return attrs.join(',');
    }

    private static buildKeyAttrs(key: NonNullable<IM3U8Segment['key']>, addQuery?: string): string {
        const attrs: string[] = [];

        if (key.method) {
            attrs.push(`METHOD=${key.method}`);
        }

        if (key.uri) {
            let uri = key.uri;
            if (addQuery)
                uri = '/api/proxy/key?url=' + encodeURIComponent(uri) + '&' + addQuery;
            else
                uri = '/api/proxy/key?url=' + encodeURIComponent(uri);
            attrs.push(`URI="${uri}"`);
        }

        if (key.iv) {
            attrs.push(`IV=0x${this.bytesToHex(key.iv)}`);
        }

        if (key.format) {
            attrs.push(`KEYFORMAT="${key.format}"`);
        }

        if (key.keyFormatVersions) {
            attrs.push(`KEYFORMATVERSIONS="${key.keyFormatVersions}"`);
        }

        return attrs.join(',');
    }

    private static buildMapAttrs(map: NonNullable<IM3U8Segment['map']>, addQuery?: string): string { 
        let uri = map.uri;
        if (addQuery)
            uri = '/api/proxy/map?url=' + encodeURIComponent(uri) + '&' + addQuery;
        else
            uri = '/api/proxy/map?url=' + encodeURIComponent(uri);

        const attrs: string[] = [
            `URI="${uri}"`,
        ];

        if (map.byterange) {
            attrs.push(`BYTERANGE="${map.byterange}"`);
        }

        return attrs.join(',');
    }

    private static bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private static isSameKey(key1: IM3U8Segment['key'] | undefined, key2: IM3U8Segment['key'] | undefined): boolean {
        if (!key1 && !key2) return true;
        if (!key1 || !key2) return false;

        // 比较基本属性
        if (key1.method !== key2.method ||
            key1.uri !== key2.uri ||
            key1.format !== key2.format ||
            key1.keyFormatVersions !== key2.keyFormatVersions) {
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

        logDebug('No valid TS sync found, returning original data');
        return data;
    }

    /**
     * 推断质量等级
     */
    private static inferQuality(variant: IM3U8Variant): string {
        if (!variant.resolution) return 'unknown';
        const height = variant.resolution.height;

        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        return '360p';
    }

    /**
   * 向后兼容：fetchAndParseM3U8（解析主播放列表）
   */
    static async fetchAndParseM3U8(url: string): Promise<IM3U8Result[]> {
        try {
            logInfo(`Fetching master playlist: ${url}`);

            const manifest = await this.fetchManifest(url);

            // 转换为旧的M3U8Result格式
            return (manifest.variants || []).map(variant => ({
                url: variant.uri,
                quality: variant.name || this.inferQuality(variant),
                resolution: variant.resolution
                    ? `${variant.resolution.width}x${variant.resolution.height}`
                    : undefined,
                bandwidth: variant.bandwidth,
            }));

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