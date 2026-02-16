import { Document } from "dom";
import { IM3U8Result, IVideoItem, IVideoList } from '../types/index.ts';
import { fetch2, getDocument } from '../utils/fetch.ts';
import { logError, logInfo, logWarn } from "../utils/logger.ts";
import { BaseVideoSource, ImageData } from './index.ts';
import { privateDecrypt, createDecipheriv, constants } from "node:crypto";
import { Buffer } from "node:buffer";

// 17C 视频源实现
export default class C17VideoSource extends BaseVideoSource {
    private rawHost: string = '';

    // 解码映射表 - 用于解密 m3u8 URL
    private DECODE_MAPPER: Record<string, string> = {
        'e': 'P', 'w': 'D', 'T': 'y', '+': 'J', 'l': '!', 't': 'L', 'E': 'E',
        '@': '2', 'd': 'a', 'b': '%', 'q': 'l', 'X': 'v', '~': 'R', 'C': 'j',
        ']': 'F', 'a': ')', '^': 'm', ',': '~', '}': '1', 'x': 'C', 'c': '(',
        'G': '@', 'h': 'h', '.': '*', 'L': 's', '=': ',', 'p': 'g', 'I': 'Q',
        'K': '6', 'F': 't', 'k': 'G', 'Z': ']', ')': 'b', 'P': '}', 'B': 'U',
        'S': 'k', 'g': ':', 'N': 'N', 'i': 'S', '%': '+', '-': 'Y', '?': '|',
        '*': '-', '[': '{', '(': 'c', 'u': 'B', 'y': 'M', 'U': 'Z', 'H': '[',
        'z': 'K', 'R': 'x', 'v': '&', '!': ';', 'M': '_', 'Q': '9', 'Y': 'e',
        'o': '4', 'r': 'A', 'm': '.', 'O': 'o', 'V': 'W', 'J': 'p', 'f': 'd',
        ':': 'q', '{': '8', 'W': 'I', 'j': '?', 'n': '5', 's': '3', '|': 'T',
        'A': 'V', 'D': 'w', ';': 'O', '&': 'X', '_': 'u',
        '5': 'r', '1': '7', '2': 'n', '8': '=', '4': 'z', '3': '^', '9': 'H', '7': 'f', '6': 'i',
        '0': '0'
    };

    constructor() {
        super('17c', '17C视频', 'https://17c.com');
    }

    // 处理重定向脚本
    private handleRedirect(nagCode: string) {
        let result = '';
        const location = {
            set href(val: string) { result = val; },
            replace(val: string) { result = val; }
        };
        // @ts-ignore vm
        const window = { location };
        new Function('window', 'location', nagCode)(window, location);
        return result;
    }

    /**
     * 解密函数
     * @param data - Base64 编码的 AES 加密数据
     * @param key - Base64 编码的 RSA 加密密钥
     */
    private decrypt({ data, key }: { data: string; key: string }): string {
        const privateKeyPem = `-----BEGIN RSA PRIVATE KEY-----
MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA0E9Nsuz6jYF+JeLq
KaL1LkZyg0Wl4xPIwEzlDrO4UOMYGX1WG+nqf9ovpplgThgLcyoRM1YFshGFOrkA
iHEZqwIDAQABAkABvEdncDX+K9ADPMq6ohLs2cVmdpQVOjr37ywRXUnx0o6skjM3
Yg45uw3lpobrkckep0NxqrINeSsrY29hA3ZBAiEA8rnQiqs6hXw8tLIBk0i2i7tq
ai9xew/lD/wDGQdtvdECIQDbs6kkuEs9us9avgF/JO7F13OmlDzR0lzrIzujxvLS
uwIgW+BX/tVXnoVrWR50GDMS3gt/+VeiBen7U7SZ25SDRrECIBhIx41zgX2VRI43
KlsvbeUYZ4QmJoLaycKD5ne36ec5AiEA44AwFDoD1qf1wIZ152QxrkZgGMyKG6c8
36lRB5VdiME=
-----END RSA PRIVATE KEY-----`;

        // 1. RSA 解密（PKCS#1 v1.5 填充，对应 JSEncrypt 默认）
        // 注意：Deno 的 node:crypto 支持 RSA_PKCS1_PADDING
        const aesKeyBuffer = privateDecrypt(
            {
            key: privateKeyPem,
            padding: constants.RSA_PKCS1_PADDING, // 关键：PKCS#1 v1.5
            },
            Buffer.from(key, "base64")
        );
        const aesKey = aesKeyBuffer.toString("utf-8");

        // 2. 构造 IV（与原代码一致：反转后取前16字符）
        const aesKeyReversed = aesKey.split("").reverse().join("");
        const iv = aesKeyReversed.substring(0, 16);

        // 3. AES-CBC 解密（PKCS7 填充）
        const decipher = createDecipheriv(
            "aes-128-cbc", // 根据密钥长度自动选择：16字节=128, 24=192, 32=256
            Buffer.from(aesKey, "utf-8"),
            Buffer.from(iv, "utf-8")
        );
        
        let decrypted = decipher.update(data, "base64", "utf-8");
        decrypted += decipher.final("utf-8");
        
        return decrypted;
    }

    // 初始化视频源 - 获取真实地址
    async init(): Promise<void> {
        logInfo(`初始化视频源: ${this.sourceName}`);

        const ENTRY_LINK = "https://17c.com";
        const APP_ENTRY_LINK = "https://www.17capp2.com:6688/100.html";

        try {
            // 首先尝试 APP 入口
            const appDoc = await getDocument(APP_ENTRY_LINK);
            const iframe = appDoc.querySelector('iframe[src]');
            if (iframe) {
                const addr = iframe.getAttribute('src');
                if (addr) {
                    const aurl = new URL(addr, APP_ENTRY_LINK);
                    try {
                        await fetch2(aurl, { timeout: 5000 });
                        this.rawHost = aurl.hostname;
                        this.baseUrl = aurl.href;
                        logInfo(`通过 APP 入口解析到域名: ${this.baseUrl} `);
                        await this.postInit()
                        return;
                    } catch (e) {
                        logWarn('APP 入口请求失败，尝试主入口');
                    }
                }
            }

            // 尝试主入口（需要处理重定向）
            const entryDoc = await getDocument(ENTRY_LINK);
            const scripts = entryDoc.getElementsByTagName('script');
            if (scripts.length > 0 && scripts[0].innerHTML) {
                const addr0 = await this.handleRedirect(scripts[0].innerHTML);
                const doc1 = await getDocument(addr0);
                const link = doc1.querySelector('a[href]');
                if (link) {
                    const addr1 = link.getAttribute('href');
                    if (addr1) {
                        const doc2 = await getDocument(addr1);
                        const bold = doc2.querySelector('body > div.content-box > div > div > div.ran-box > div > b:nth-child(2)');
                        if (bold) {
                            const addr2 = bold.innerHTML;
                            const doc3 = await getDocument(addr2);
                            const script = doc3.querySelector('script');
                            if (script && script.innerHTML) {
                                const finalUrl = await this.handleRedirect(script.innerHTML);
                                const addrR = new URL(finalUrl);

                                // 尝试解析 DNS
                                try {
                                    await fetch2(addrR, { timeout: 5000 });
                                } catch {
                                    const ips = await Deno.resolveDns(addrR.hostname, 'A');
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

            throw new Error('无法解析到有效域名');
        } catch (error) {
            logError('初始化 17C 视频源失败:', error);
            throw error;
        }
    }

    private async postInit() {
        try {
            // 测试api
            const res1 = await this.getAPI('/v1/blist?c=100')
            const res2 = await this.getAPI('/v1/vod?c=100&sort=new&page=1&limit=10&cate_id=1');
            const res3 = await this.getAPI('/v1/popup?c=100');
            const res4 = await this.getAPI('/v1/tags?c=100&v=2')
            const res5 = await this.getAPI('/v1/relist?c=100')
        } catch (e) {
            console.log(e);
        }
    }

    private async getAPI<T = any>(path: string): Promise<T> {
        const url = new URL(path, this.baseUrl);
        const res = await fetch(url).then(r => r.json());
        const dec = this.decrypt(res);
        return JSON.parse(dec);
    }

    // 获取主页视频列表
    async getHomeVideos(page: number = 1): Promise<IVideoList> {
        if (!this.baseUrl) {
            throw new Error('视频源未初始化');
        }

        const pageUrl = page > 1
            ? new URL(`? page = ${page} `, this.baseUrl).href
            : this.baseUrl;

        const doc = await getDocument(pageUrl);
        const videos = await this.parseVideoList(doc);

        // 获取总页数
        const paginationEl = doc.querySelector('.pagination-box ul li:last-child');
        let totalPages = 1;
        if (paginationEl) {
            const text = paginationEl.textContent || '';
            const match = text.match(/\/(\d+)/);
            if (match) {
                totalPages = parseInt(match[1]);
            }
        }

        return {
            videos,
            currentPage: page,
            totalPages
        };
    }

    // 解析视频列表
    private async parseVideoList(doc: Document): Promise<IVideoItem[]> {
        const videoElements = doc.querySelectorAll('.content-box .ran-box div a[href]');
        const videos: IVideoItem[] = [];

        for (const element of videoElements) {
            // 跳过广告链接
            if (element.getAttribute('target') === '_blank') {
                continue;
            }

            const href = element.getAttribute('href');
            if (!href || !href.includes('videoplay')) {
                continue;
            }

            const url = new URL(href, this.baseUrl!).href;
            const vid = new URL(url).searchParams.get('vid');

            // 获取标题和缩略图
            const titleEl = element.querySelector('.video-title, .title, span');
            const title = titleEl?.textContent?.trim() || `视频${vid} `;

            const imgEl = element.querySelector('img');
            const thumbnail = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';

            if (vid) {
                videos.push({
                    id: vid,
                    title,
                    thumbnail,
                    url,
                    source: this.sourceId
                });
            }
        }

        return videos;
    }

    // 搜索视频
    async searchVideos(query: string, page: number = 1): Promise<IVideoList> {
        if (!this.baseUrl) {
            throw new Error('视频源未初始化');
        }

        const searchUrl = new URL(`/ search / 0.html ? keyword = ${encodeURIComponent(query)}& page=${page} `, this.baseUrl).href;
        const doc = await getDocument(searchUrl);
        const videos = await this.parseVideoList(doc);

        // 获取总页数
        const paginationEl = doc.querySelector('.pagination-box ul li:last-child');
        let totalPages = 1;
        if (paginationEl) {
            const text = paginationEl.textContent || '';
            const match = text.match(/\/(\d+)/);
            if (match) {
                totalPages = parseInt(match[1]);
            }
        }

        return {
            videos,
            currentPage: page,
            totalPages
        };
    }

    // 获取视频信息
    private async getVideoInfo(videoIdOrUrl: string): Promise<{ id: string; title: string; m3u8: string; thumbnail: string; url: string }> {
        const url = videoIdOrUrl.includes('://')
            ? videoIdOrUrl
            : new URL(`/ videoplay / 0.html ? vid = ${videoIdOrUrl} `, this.baseUrl!).href;

        const doc = await getDocument(url);

        // 获取标题
        const titleEl = doc.querySelector('.video-title');
        const title = titleEl?.textContent?.trim() || '未知视频';

        // 获取缩略图
        const imgEl = doc.querySelector('.video-poster img, .video-thumb img');
        const thumbnail = imgEl?.getAttribute('src') || '';

        // 获取 m3u8 - 需要从 script 中解析
        const scripts = doc.getElementsByTagName('script');
        let sl = '';
        let encryptUrl = '';

        for (const script of scripts) {
            const content = script.innerHTML;
            if (content.includes('m3u8') && content.includes('sl')) {
                const slMatch = content.match(/sl\s*:\s*"([^"]+)"/);
                const urlMatch = content.match(/encryptUrl\s*:\s*"([^"]+)"/);
                if (slMatch) sl = slMatch[1];
                if (urlMatch) encryptUrl = urlMatch[1];
                break;
            }
        }

        if (!sl) {
            throw new Error('无法解析视频链接');
        }

        // 解码 m3u8 URL
        const m3u8 = sl.split('').map(char => this.DECODE_MAPPER[char] ?? char).join('');

        return {
            id: videoIdOrUrl.includes('://') ? new URL(url).searchParams.get('vid') || videoIdOrUrl : videoIdOrUrl,
            title,
            m3u8: decodeURIComponent(m3u8).trim(),
            thumbnail: encryptUrl ? new URL(encryptUrl, url).href : thumbnail,
            url
        };
    }

    // 解析视频链接获取 M3U8
    async parseVideoUrl(url: string): Promise<IM3U8Result[]> {
        const videoInfo = await this.getVideoInfo(url);

        return [{
            url: videoInfo.m3u8,
            quality: '高清',
            resolution: '1920x1080',
            bandwidth: 2000000
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
        if (!originalUrl) {
            return {
                data: new Uint8Array(),
                contentType: 'image/jpeg'
            };
        }

        const imageUrl = originalUrl.startsWith('http')
            ? originalUrl
            : new URL(originalUrl, this.baseUrl!).href;

        try {
            const response = await fetch2(imageUrl, {
                headers: {
                    'Referer': this.baseUrl || '',
                    'Host': this.rawHost
                }
            });

            const data = new Uint8Array(await response.arrayBuffer());

            // 尝试解码图片
            const decoded = this.decodeImage(data);

            return {
                data: decoded,
                contentType: 'image/jpeg'
            };
        } catch (error) {
            logWarn('获取图片失败:', error);
            return {
                data: new Uint8Array(),
                contentType: 'image/jpeg'
            };
        }
    }
}
