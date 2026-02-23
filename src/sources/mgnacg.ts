import assert from "node:assert";
import { fetch2, getDocument, getImage } from "../utils/fetch.ts";
import { BaseVideoSource, ImageData } from "./index.ts";
import { IVideoList, IVideoItem, IVideoURL, ISeriesResult, IEpisode, URLProxy } from "../types/index.ts";
import { captcha } from "../utils/captcha.ts";
import console from "node:console";
import { Document } from "dom";
import { md5 } from "@takker/md5";
import { decodeBase64, decodeHex, encodeHex } from "@std/encoding";

interface ISource {
    show: string;   // 源备注
    parse: string;  // 解析器
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

export class CommonAPI {
    private $source: Record<string, ISource> = {};

    constructor(private $config: string = 'https://www.mgnacg.com/static/js/playerconfig.js') { }

    async init() {
        const scrctx = await (await fetch2(this.$config)).text();
        const res = new Function(scrctx + '\n return MacPlayerConfig;')() as {
            player_list: Record<string, ISource>
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
            ?.id?.replace('now_', '');
        const key2 = doc.querySelector('meta[charset="UTF-8"]')
            ?.id?.replace('now_', '');
        assert(key1 && key2, `Failed to decrypt url ${url}`);

        // 按key2排序
        const keys = new Array(key2.length);
        for (let i = 0; i < key2.length; i++) {
            keys[i] = key1[parseInt(key2[i])];
        }
        const md5Hex = encodeHex(md5(keys.join('') + "Mknacg123321"));  // 32字符
        const keyStr = md5Hex.substring(16);   // 16字符字符串
        const ivStr = md5Hex.substring(0, 16); // 16字符字符串
        const key = new TextEncoder().encode(keyStr);  // Uint8Array(16)
        const iv = new TextEncoder().encode(ivStr);    // Uint8Array(16)
        const ciphertext = decodeBase64(url);

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'AES-CBC', length: 128 },  // 16字节 = 128位
            false,
            ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            cryptoKey,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    }

    async getVideoUrl(info: IPlayerInfo) {
        const src = this.getPlayer(info);
        let url;
        if (info.encrypt == 1) {
            url = unescape(info.url);
        } else if (info.encrypt == 2) {
            //     url = unescape(atob(info.url));
            // } else if (info.encrypt == 0) {
            url = info.url;
        } else {
            throw new Error(`Unknown encrypt type ${info.encrypt}`);
        }
        const doc = await getDocument(src + url);
        const scr = doc.getElementsByTagName('script').at(-1)?.textContent;
        assert(scr, `Failed to get video url from ${src}`);
        const config = await new Promise<IVideoRes>(rs => {
            new Function('player', scr!)(rs);
        });
        return {
            url: await this.decryptURL(config.url, doc)
        };
    }
}


export default class AkiAnimeAPI extends BaseVideoSource {
    private $api: CommonAPI = new CommonAPI();

    constructor() {
        super('mgnacg', '橘子动漫', 'https://www.mgnacg.com', true);
        this.imageAspectRatio = '9/16';
    }

    override async init(): Promise<void> {
        await this.$api.init();
    }

    override async getHomeVideos(page?: number): Promise<IVideoList> {
        const home = await getDocument(this.baseUrl);
        const vid: IVideoItem[] = [];
        for (const el of home.querySelectorAll('.public-list-box')) {
            const link = el.getElementsByTagName('a')?.[0];
            const image = el.getElementsByTagName('img')?.[0];
            if (!link || !image) continue;
            const match = link.getAttribute('href')?.match(/\/media\/([A-Za-z0-9]+)\/?/);
            if (!match) continue;
            vid.push({
                thumbnail: new URL(image.getAttribute('data-src')!, this.baseUrl).href,
                title: image.getAttribute('alt')!,
                url: new URL(link.getAttribute('href')!, this.baseUrl).href,
                source: this.sourceId,
                id: match[1],
                contentType: 'series'
            })
        }
        return {
            videos: vid,
            currentPage: 1,
            totalPages: 1
        }
    }

    override async getSeries(seriesId: string, url?: string): Promise<ISeriesResult | null> {
        // 优先使用传入的URL，否则根据ID构造URL
        const pageUrl = url ?? new URL(`/media/${seriesId}/`, this.baseUrl).href;
        const doc = await getDocument(pageUrl);
        const ser: IEpisode[] = [];
        let total = 0;
        for (const group of doc.querySelectorAll('.anthology-list-play')) {
            let ep = 1;
            for (const el of group.children) {
                const link = el.getElementsByTagName('a')?.[0]!;
                // /bgmplay/cEcDDE-1-1.html
                const match = link.getAttribute('href')?.match(/\/bangumi\/([A-Za-z0-9]+-[0-9]+-[0-9]+)\/?/);
                if (!match) continue;
                ser.push({
                    url: new URL(link.getAttribute('href')!, this.baseUrl).href,
                    id: match[1],
                    title: link.textContent!,
                    seriesId,
                    episodeNumber: ep++
                });
            }
            total = Math.max(total, ep - 1);
        }

        const img = doc.querySelector('.detail-pic img');
        const name = doc.querySelector('h3.slide-info-title');
        const btn = doc.querySelector('.vod-detail-bnt a');
        const fraction = doc.querySelector('div.fraction');
        const desc = doc.querySelector('div#height_limit');
        const year = Array.from(doc.querySelectorAll('.slide-info-remarks'))
            .find(e => /^[0-9]{4}$/.test(e.innerText))?.innerText;

        return {
            thumbnail: new URL(img?.getAttribute('data-src')!, this.baseUrl).href,
            title: name?.textContent!,
            episodes: ser,
            seriesId,
            totalEpisodes: total,
            source: this.sourceId,
            id: seriesId,
            url: new URL(btn?.getAttribute('href')!, this.baseUrl).href,
            description: desc?.textContent?.trim(),
            rating: parseInt(fraction?.textContent?.trim() ?? '0'),
            year: year ? parseInt(year) : undefined,
        };
    }

    override async searchVideos(query: string, page?: number): Promise<IVideoList> {
        const doc = await getDocument(new URL(`/search/${encodeURIComponent(query)}----------${page}---/`, this.baseUrl));
        const verify = doc.querySelector('img.ds-verify-img[src]');
        let verifyMessage = '搜索需要验证码'
        while (verify) {
            const code = await captcha({
                prompt: verifyMessage,
                imageUrl: new URL(verify.getAttribute('src')!, this.baseUrl).href
            })
            const res = await fetch2(new URL('/index.php/ajax/verify_check?type=search&verify=' + code, this.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: ""
            }).then(r => r.text());
            if (res.length) {
                const message = JSON.parse(res);
                verifyMessage = message.msg;
            } else {
                return this.searchVideos(query, page);
            }
        }

        const res: IVideoItem[] = [];
        for (const el of doc.querySelectorAll('.vod-detail')) {
            const link = el.querySelector('a[target="_blank"]');
            const namel = el.querySelector('.slide-info-title')
            const img = el.querySelector('img.gen-movie-img');

            if (!link || !namel || !img) continue;
            const match = link.getAttribute('href')?.match(/\/bgmdetail\/([A-Za-z0-9]+)\.html/);
            if (!match) continue;
            res.push({
                thumbnail: new URL(img.getAttribute('data-src')!, this.baseUrl).href,
                title: namel.textContent!,
                url: new URL(link.getAttribute('href')!, this.baseUrl).href,
                source: this.sourceId,
                id: match[1],
                contentType: 'series'
            });
        }

        const tip = doc.querySelector('.page-tip');
        // 共43条数据,当前1/5页
        const match = tip?.textContent?.match(/当前(\d+)\/(\d+)页/);
        return {
            currentPage: parseInt(match?.[1] ?? '1'),
            totalPages: parseInt(match?.[2] ?? '2'),
            videos: res
        };
    }

    override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
        const doc = await getDocument(url);
        const scr = doc.getElementsByTagName('script').find(e => e.innerText.includes('player_aaaa'))?.textContent;
        assert(scr, `Failed to get video url from ${url}`);
        const info = new Function(scr + ';return player_aaaa;')();
        const inf = await this.$api.getVideoUrl(info);
        return [{
            quality: '1080p',
            url: inf.url,
            format: 'h5',   // 这个源没有用hls的
            proxy: URLProxy.NONE
        }];
    }

    override getImage(originalUrl: string): Promise<ImageData> {
        return getImage(originalUrl);
    }
}