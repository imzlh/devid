/**
 * SM-API Weiaona 视频源
 * 完整实现：跳板跳转 → CONFIG解密 → API调用
 */
import { BaseVideoSource, ImageData } from './index.ts';
import { IVideoItem, IVideoList, IM3U8Result } from '../types/index.ts';
import { fetch2 } from '../utils/fetch.ts';
import { DOMParser } from "dom";
import { logInfo } from "../utils/logger.ts";
import assert from "node:assert";
import { createDecipheriv } from "node:crypto";
import { Buffer } from "node:buffer";

// ==================== 解密核心 ====================
interface TokenSecret {
    encryptionKeyHex: string;  // 32字节 -> 64 hex chars
    signingKeyHex: string;     // 32字节 -> 64 hex chars
}

async function decryptToken2(b64: string, secret: TokenSecret): Promise<Buffer> {
    const buf = Buffer.from(b64, "base64");

    // 字段长度（字节）
    const VERSION_LEN = 1;
    const TIME_LEN = 8;
    const IV_LEN = 16;
    const HMAC_LEN = 32;

    if (buf.length < VERSION_LEN + TIME_LEN + IV_LEN + HMAC_LEN + 1) {
        throw new Error("token too short");
    }

    let offset = 0;
    const version = buf.subarray(offset, offset += VERSION_LEN);
    const timeBuf = buf.subarray(offset, offset += TIME_LEN);
    const iv = buf.subarray(offset, offset += IV_LEN);
    const cipher = buf.subarray(offset, buf.length - HMAC_LEN);
    const hmacSig = buf.subarray(buf.length - HMAC_LEN);

    // 版本校验
    if (version[0] !== 128) {
        throw new Error("invalid version");
    }

    // HMAC-SHA256 校验（使用 Web Crypto API 避免弃用警告）
    // 注：此校验非阻塞，失败仅记录日志
    try {
        const hmacPayload = Buffer.concat([Buffer.from(timeBuf), Buffer.from(iv), Buffer.from(cipher)]);
        const key = await crypto.subtle.importKey(
            "raw",
            Buffer.from(secret.signingKeyHex, "hex"),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", key, hmacPayload);
        const expected = new Uint8Array(signature);
        if (!hmacSig.every((v, i) => v === expected[i])) {
            logInfo("HMAC mismatch (continuing anyway per user request)");
        }
    } catch (e) {
        logInfo("HMAC validation skipped:", e);
    }

    // AES-256-CBC 解密
    const decipher = createDecipheriv(
        "aes-128-cbc",
        Buffer.from(secret.encryptionKeyHex, "hex"),
        Buffer.from(iv)
    );

    return Buffer.concat([
        decipher.update(Buffer.from(cipher)),
        decipher.final()
    ])
}

async function decryptToken(b64: string, secret: TokenSecret): Promise<string> {
    const buf = await decryptToken2(b64, secret);
    return buf.toString("utf-8");
}

// ==================== 视频源实现 ====================
interface DecryptedConfig {
    api_url: string;
    video_play_url_list: Array<{
        name: string;
        url: string[];
        sort: number;
        is_vip?: boolean;
    }>;
    video_download_url: string[];
    video_img_url: string;
    [key: string]: any;
}

export default class SMWeiaonaVideoSource extends BaseVideoSource {
    private resolvedBaseUrl: string = '';
    private homePageUrl: string = '';
    private config: DecryptedConfig | null = null;
    private tags: Record<string, number> = {};
    private secret: TokenSecret = {
        encryptionKeyHex: "7af630c7e06ccecfa70d5a085f189c06",
        signingKeyHex: "3721911b9e80f22e49d8932a87b75af3"
    };

    constructor() {
        super('sm_weiaona', 'SMWeiaona', 'https://123kpdz.com');
    }

    private sandbox(code: string, url: string) {
        const window = {
            atob,
            location: {
                href: url,
                replace(newUrl: string){
                    this.href = newUrl;
                }
            },
            document: { location: null }
        };
        const jsCode = new DOMParser().parseFromString(code, 'text/html')
            .getElementsByTagName('script').filter(e => e.innerHTML.length > 32)[0]
            .innerHTML;
        // @ts-ignore
        window.document.location = window.location
        const func = new Function('window', 'document', 'location', 'atob', jsCode);
        func(window, window.document, window.location, atob);

        assert(window.location.href, '跳转失败: 未更新location.href');

        return window.location.href;
    }

    // 初始化：处理完整跳转链并解密CONFIG
    async init(): Promise<void> {
        logInfo(`[${this.sourceId}] 开始初始化跳转链...`);

        // Step 1: 123kpdz.com -> 获取跳转URL
        let step1Match;
        const tried: number[] = [];
        while(true) try{
            let i;
            do
                i = Math.ceil(Math.random() * 200);
            while (tried.length < 100 && tried.includes(i));
            tried.push(i);

            const url = `https://${i}kpdz.com`;
            logInfo('尝试:', url);
            const step1Html = await (await fetch2(url, {
                noRetry: true
            })).text();
            step1Match = this.sandbox(step1Html, url);
            if(step1Match) break;
        } catch (e) {
            logInfo('失败:', e);
        }
        if (!step1Match) {
            throw new Error('尝试了100次，没有成功进入');
        }
        
        // Step2: 访问地址
        const step2Html = await (await fetch2(step1Match)).text();
        const step2Match = this.sandbox(step2Html, step1Match);

        // Step 3: urlsc.trafficmanager.net -> 获取min.js
        // logInfo(`[${this.sourceId}] Step 3: ${step2Match}`);
        // const step3Html = await (await fetch2(step2Match)).text();
        // const minJsMatch = step3Html.match(/src="([^"]+\/min\.js)"/);
        // assert(minJsMatch, 'Step 3: 无法找到min.js');
        // const minJsUrl = minJsMatch[1];

        // Step 3: 执行min.js获取最终域名
        // logInfo(`[${this.sourceId}] Step 3: ${minJsUrl}`);
        // const minJs = await (await fetch2(minJsUrl)).text();
        // const finalMatch = minJs.match(/replace\("([^"]+)"\)/);
        // assert(finalMatch, 'Step 3: 无法解析最终URL');
        // const finalUrl = finalMatch[1];
        const finalUrl = step2Match;

        // Step 4: 获取加密CONFIG页面
        logInfo(`[${this.sourceId}] Step 4: ${finalUrl}`);
        const finalHtml = await (await fetch2(finalUrl)).text();
        const configMatch = finalHtml.match(/window\.CONFIG\s*=\s*'([^']+)'/);
        assert(configMatch, 'Step 4: 无法找到window.CONFIG');

        // Step 5: 解密CONFIG
        const encryptedConfig = configMatch[1];
        const decryptedJson = await decryptToken(encryptedConfig, this.secret);
        this.config = JSON.parse(decryptedJson);

        assert(this.config?.api_url, '解密失败: 缺少api_url');
        this.resolvedBaseUrl = `https://${this.config.api_url}`;
        this.homePageUrl = finalUrl;

        // final: tags
        // for (const tag of await this.getTags()){
        //     this.tags[tag.name] = tag.id;
        // }

        logInfo(`[${this.sourceId}] 初始化完成，API域名: ${this.resolvedBaseUrl}`);
    }

    // 获取首页视频
    async getHomeVideos(page: number = 1): Promise<IVideoList> {
        assert(this.config, '视频源未初始化');

        const url = new URL('/api/vod/video', this.resolvedBaseUrl);
        url.searchParams.set('count', 'false');
        url.searchParams.set('page', page.toString());
        url.searchParams.set('per_page', '50'); // 每页12个
        url.searchParams.set('random_data', '1');
        url.searchParams.set('site_id', '45');

        logInfo(`[${this.sourceId}] 获取首页: ${url.href}`);
        const response = await fetch2(url.href);
        const data = JSON.parse(await decryptToken((await response.json())['x-data'], this.secret));

        return {
            videos: this.parseVideoList(data.data.items),
            currentPage: data.data.page || page,
            totalPages: data.data.pages || 50
        };
    }

    // 搜索视频
    async searchVideos(query: string, page: number = 1): Promise<IVideoList> {
        assert(this.config, '视频源未初始化');

        const url = new URL('/search/vod/', this.resolvedBaseUrl);
        url.searchParams.set('page', page.toString());
        url.searchParams.set('per_page', '30');
        url.searchParams.set('search', query);

        logInfo(`[${this.sourceId}] 搜索: ${query}, 第${page}页`);
        const response = await fetch2(url.href);
        const data = JSON.parse(await decryptToken((await response.json())['x-data'], this.secret));

        // 搜索接口返回结构可能不同，做兼容处理
        const items = data.data?.items || data.items || [];
        return {
            videos: this.parseVideoList(items),
            currentPage: page,
            totalPages: data.data?.pages || Math.ceil((data.total || 0) / 30) || 1
        };
    }

    // 按标签获取视频
    async getVideosByTag(tagId: number, page: number = 1): Promise<IVideoList> {
        assert(this.config, '视频源未初始化');

        const url = new URL('/api/vod/video', this.resolvedBaseUrl);
        url.searchParams.set('count', 'false');
        url.searchParams.set('page', page.toString());
        url.searchParams.set('per_page', '12');
        url.searchParams.set('tag', tagId.toString());
        url.searchParams.set('site_id', '45');

        logInfo(`[${this.sourceId}] 获取标签 ${tagId} 第${page}页`);
        const response = await fetch2(url.href);
        const data = JSON.parse(await decryptToken((await response.json())['x-data'], this.secret));

        return {
            videos: this.parseVideoList(data.data.items),
            currentPage: data.data.page || page,
            totalPages: data.data.pages || 50
        };
    }

    // 解析视频列表
    private parseVideoList(items: any[]): IVideoItem[] {
        assert(this.config, '视频源未初始化');

        // 选择第一条可用线路
        const vipLine = this.config.video_play_url_list.find(line => line.is_vip);
        const normalLine = this.config.video_play_url_list.find(line => !line.is_vip);
        const selectedLine = vipLine || normalLine;

        assert(selectedLine, '没有可用播放线路');

        const host = selectedLine.url[0]; // 取第一个域名

        return items.map(item => ({
            id: item.id.toString(),
            title: item.name,
            thumbnail: this.buildImageUrl(item.pic),
            duration: this.formatDuration(item.duration),
            url: new URL(item.play_url, `https://${host}`).toString(),
            source: this.sourceId,
            description: item.description || '',
            pubdate: item.pubdate,
            hits: item.hits,
            isVip: item.is_paid === 1
        }));
    }

    // 解析视频播放URL（M3U8）
    async parseVideoUrl(fullUrl: string): Promise<IM3U8Result[]> {
        assert(this.config, '视频源未初始化');
        logInfo(`[${this.sourceId}] 解析视频: ${fullUrl}`);

        // 这里简单返回，实际可能需要进一步请求验证
        return [{
            url: fullUrl,
            quality: '1080P',
            resolution: '1920x1080',
            bandwidth: 2000000
        }];
    }

    // 获取标签列表（可用于分类）
    async getTags(): Promise<Array<{ id: number, name: string }>> {
        assert(this.config, '视频源未初始化');

        const url = new URL('/api/vod/tag', this.resolvedBaseUrl);
        url.searchParams.set('page', '1');
        url.searchParams.set('per_page', '1000');
        url.searchParams.set('site_id', '45');

        logInfo(`[${this.sourceId}] 获取标签列表`);
        const response = await fetch2(url.href, {
            headers: {
                'Referer': this.homePageUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const data = JSON.parse(await decryptToken((await response.json())['x-data'], this.secret));

        return data.data?.items || [];
    }

    // 获取图片
    override async getImage(originalUrl: string): Promise<ImageData> {
        assert(this.config, '视频源未初始化');

        const imageUrl = this.buildImageUrl(originalUrl);
        logInfo(`[${this.sourceId}] 获取图片: ${imageUrl}`);

        const imageData = await fetch2(imageUrl, {
            headers: {
                'Referer': this.homePageUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const txt = (await imageData.text()).split('@@@');
        const data = (await decryptToken(txt[0], this.secret)) + txt[1];

        return {
            data: await (await fetch(data)).bytes(),
            contentType: imageData.headers.get('content-type') || 'image/jpeg'
        };
    }

    // 工具方法
    private buildImageUrl(path: string): string {
        if (path.startsWith('http')) return path;
        const base = this.config?.video_img_url || 'hm-media.weiaona.com';
        return `https://${base}${path.startsWith('/') ? path : '/' + path}`;
    }

    private buildVideoUrl(path: string): string {
        if (path.startsWith('http')) return path;
        const base = this.config?.video_play_url_list[0].url[0]!;
        return new URL(path, `https://${base}/`).toString();
    }

    private formatDuration(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}