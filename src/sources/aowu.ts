import assert from "node:assert";
import { fetch2, getDocument, getImage } from "../utils/fetch.ts";
import { BaseVideoSource, ImageData } from "./index.ts";
import { IVideoList, IVideoItem, IVideoURL, ISeriesResult, IEpisode, URLProxy } from "../types/index.ts";
import { captcha } from "../utils/captcha.ts";

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

export default class AowuAnime extends BaseVideoSource {
    constructor() {
        super('嗷呜动漫', 'aowu', 'https://www.aowu.tv', true);
        this.imageAspectRatio = '9/16';
    }

    override async init(): Promise<void> {
        // noop
        // 这个源简单得要命，直接照搬aki的配置，API都没有
    }

    override async getHomeVideos(page?: number): Promise<IVideoList> {
        const home = await getDocument(this.baseUrl);
        const vid: IVideoItem[] = [];
        for (const el of home.querySelectorAll('.public-list-box')) {
            const link = el.getElementsByTagName('a')?.[0];
            const image = el.getElementsByTagName('img')?.[0];
            if (!link || !image) continue;
            const match = link.getAttribute('href')?.match(/\/moe-n\/([A-Za-z0-9]+)\/?/);
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
        const pageUrl = url ?? new URL(`/moe-n/${seriesId}/`, this.baseUrl).href;
        const doc = await getDocument(pageUrl);
        const ser: IEpisode[] = [];
        let total = 0;
        for (const group of doc.querySelectorAll('.anthology-list-play')) {
            let ep = 1;
            for (const el of group.children) {
                const link = el.getElementsByTagName('a')?.[0]!;
                // /play/ZKAAAK-1-1/
                const match = link.getAttribute('href')?.match(/\/play\/([A-Za-z0-9]+-[0-9]+-[0-9]+)/);
                if (!match) continue;
                ser.push({
                    url: new URL(link.getAttribute('href')!, this.baseUrl).href,
                    id: match[1],
                    title: link.textContent!,
                    seriesId,
                    episodeNumber: ep++,
                });
            }
            total = Math.max(total, ep - 1);
        }

        const img = doc.querySelector('.detail-pic img');
        const name = doc.querySelector('h3.slide-info-title');
        const btn = doc.querySelector('.vod-detail-bnt a');
        const desc = doc.querySelector('#height_limit');
        const tags = doc.querySelectorAll('.detail-info > .slide-info:last-child > a');
        const rate = doc.querySelector('.fraction');

        return {
            thumbnail: new URL(img?.getAttribute('data-src')!, this.baseUrl).href,
            title: name?.textContent!,
            episodes: ser,
            seriesId,
            totalEpisodes: total,
            source: this.sourceId,
            id: seriesId,
            description: desc?.textContent,
            url: new URL(btn?.getAttribute('href')!, this.baseUrl).href,
            rating: parseFloat(rate?.textContent ?? '10'),
            tags: Array.from(tags).map(e => e.textContent!)
        };
    }

    override async searchVideos(query: string, page?: number): Promise<IVideoList> {
        let doc = await getDocument(new URL(`/anime/vod/?wd=${query}&page=${page ?? 1}`, this.baseUrl));
        const res: IVideoItem[] = [];

        // check verify
        let verifyPrompt = '搜索需要验证码，请请输入验证码'
        if (doc.querySelector('input[name="verify"]')) while(true) {
            const res = await captcha({
                imageUrl: new URL('/verify/index.html', this.baseUrl).href,
                prompt: verifyPrompt,
            });
            const code = await (await fetch2(new URL('/index.php/ajax/verify_check?type=search&verify=' + res, this.baseUrl))).text();
            if (code.length) verifyPrompt = '验证码错误，请重试';
            else break;
        }

        for (const el of doc.querySelectorAll('.vod-detail')) {
            const link = el.querySelector('a[target="_blank"]');
            const namel = el.querySelector('.slide-info-title')
            const img = el.querySelector('img.gen-movie-img');

            if (!link || !namel || !img) continue;
            const match = link.getAttribute('href')?.match(/\/play\/([A-Za-z0-9]+)\/?/);
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
        const info = new Function(scr + ';return player_aaaa;')() as IPlayerInfo;
        return [{
            quality: '1080p',
            url: info.url,
            format: 'h5',   // not sure, but seems to be h5
            proxy: URLProxy.LOCAL
        }];
    }

    override getImage(originalUrl: string): Promise<ImageData> {
        return getImage(originalUrl);
    }
}