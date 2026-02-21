import assert from "node:assert";
import { findAvailableFast, getDocument, getImage } from "../utils/fetch.ts";
import { BaseVideoSource, ImageData } from "./index.ts";
import { IVideoList, IVideoItem, IVideoURL, ISeriesResult, IEpisode, URLProxy } from "../types/index.ts";
import { logInfo } from "../utils/logger.ts";

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

export default class OneAnime extends BaseVideoSource {
    constructor() {
        super('1anime', '1Anime', 'https://1anime.org/', true);
        this.imageAspectRatio = '9/16';
    }

    override async init(): Promise<void> {
        const doc = await getDocument(this.baseUrl);
        const links = doc.querySelectorAll('.links li > a[href]');
        const urlMap = new Map<string, string>();
        for (const link of links) {
            const href = link.getAttribute('href');
            if (!href) continue;
            const url = new URL(href, this.baseUrl).host;
            urlMap.set(url, link.innerText.trim());
        }

        // try best
        const fastest = await findAvailableFast(urlMap.keys().map(e => 'https://' + e).toArray());
        assert(fastest, 'No available server');
        this.baseUrl = fastest;
        logInfo(`1Anime: 使用最快的源 ${urlMap.get(fastest)!} (${fastest})`);
    }

    override async getHomeVideos(page?: number): Promise<IVideoList> {
        const home = await getDocument(this.baseUrl);
        const vid: IVideoItem[] = [];
        for (const el of home.querySelectorAll('div.module-item')) {
            const link = el.querySelector('a[title]')!;
            const image = el.querySelector('img[data-src]')!;
            // href="/voddetail/8603.html"
            const match = link.getAttribute('href')?.match(/\/voddetail\/([A-Za-z0-9]+)\.html/);
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
        const pageUrl = url ?? new URL(`/voddetail/${seriesId}.html`, this.baseUrl).href;
        const doc = await getDocument(pageUrl);
        const ser: IEpisode[] = [];
        let total = 0;
        for (const group of doc.querySelectorAll('div.module-player-list')) {
            let ep = 1;
            for (const link of group.querySelectorAll('a[title]')) {
                // href="/vodplay/8603-1-2.html"
                const match = link.getAttribute('href')?.match(/\/vodplay\/([A-Za-z0-9]+-[0-9]+-[0-9]+)\.html/);
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

        const img = doc.querySelector('div.module-item-pic img');
        const name = doc.querySelector('h1.page-title');
        const btn = doc.querySelector('.vod-detail-bnt a');
        const tags = doc.querySelectorAll('.tag-link > a[href]');

        const info: ISeriesResult = {
            thumbnail: new URL(img?.getAttribute('data-src')!, this.baseUrl).href,
            title: name?.textContent!,
            episodes: ser,
            seriesId,
            totalEpisodes: total,
            source: this.sourceId,
            id: seriesId,
            url: new URL(btn?.getAttribute('href')!, this.baseUrl).href,
            tags: Array.from(tags).map(e => e.textContent!)
        };

        for (const item of doc.querySelectorAll('.video-info-items')) {
            const titleEl = item.querySelector('.video-info-itemtitle');
            if (!titleEl) continue;
            const title = titleEl.textContent?.replace(/[：:]$/, '').trim();
            switch (title) {
                case '剧情': {
                    const contentEl = item.querySelector('.video-info-item');
                    if (contentEl?.textContent) {
                        info.description = contentEl.textContent.replace('展开', '').trim();
                    }
                    break;
                }
                case '备注': {
                    const contentEl = item.querySelector('.video-info-item');
                    if (contentEl?.textContent) {
                        const text = contentEl.textContent.trim();
                        if (text.includes('完结')) info.status = 'completed';
                        else if (text.includes('连载')) info.status = 'ongoing';
                        else if (text.includes('停更')) info.status = 'hiatus';
                    }
                    break;
                }
                case '评分': {
                    const contentEl = item.querySelector('.video-info-item');
                    if (contentEl?.textContent) {
                        const match = contentEl.textContent.match(/(\d+\.?\d*)分/);
                        if (match) info.rating = parseFloat(match[1]);
                    }
                    break;
                }
                case '上映': {
                    const contentEl = item.querySelector('.video-info-item');
                    if (contentEl?.textContent) {
                        const match = contentEl.textContent.match(/(\d{4})/);
                        if (match) info.year = parseInt(match[1]);
                    }
                    break;
                }
            }
        }

        return info;
    }

    override async searchVideos(query: string, page?: number): Promise<IVideoList> {
        const doc = await getDocument(
            new URL(`/vodsearch/${encodeURIComponent(query)}----------${page}---.html`, this.baseUrl)
        );
        const res: IVideoItem[] = [];
        for (const el of doc.querySelectorAll('.module-items > div.module-item')) {
            const link = el.querySelector('a[title]');
            const img = el.querySelector('.module-item-pic > img[data-src]');

            if (!link || !img) continue;
            const match = link.getAttribute('href')?.match(/\/bgmdetail\/([A-Za-z0-9]+)\.html/);
            if (!match) continue;
            res.push({
                thumbnail: new URL(img.getAttribute('data-src')!, this.baseUrl).href,
                title: link.getAttribute('title')!,
                url: new URL(link.getAttribute('href')!, this.baseUrl).href,
                source: this.sourceId,
                id: match[1],
                contentType: 'series'
            });
        }

        const tip = doc.querySelector('div#page');
        const last = tip?.children.item(-1).getAttribute('href');
        const match = last?.match(/-+(\d+)-+\.html$/);
        const totalPages = match ? parseInt(match[1]) : 1;
        return {
            currentPage: page ?? 1,
            totalPages,
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