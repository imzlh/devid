import { Document } from "dom";
import { IVideoItem, IVideoList, IVideoURL, URLProxy } from "../types/index.ts";
import { BaseVideoSource, ImageData } from "./index.ts";
import { getDocument, getImage } from "../utils/fetch.ts";
import assert from "node:assert";

interface VideoSource {
    src: string;
    type: string;
}

interface VideoDetail {
    sources: VideoSource[];
    id: string;
    fv_title: string;
    splash: string;
    duration: number;
}

export default class AvBebe extends BaseVideoSource {
    constructor() {
        super("avbebe", "AvBebe(强制使用代理)", "https://avbebe.love/");
    }

    override async init(): Promise<void> {
        // no need to init
    }

    private parsePage(doc: Document) {
        const res: IVideoItem[] = [];
        for (const item of doc.querySelectorAll("div.elementor-container")) {
            const link = item.querySelector("a.elementor-cta");
            const bgdiv = item.querySelector("div.elementor-cta__bg-wrapper div.elementor-cta__bg[data-bg]");
            const bg = bgdiv?.getAttribute("data-bg")?.match(/url\(([^\)]+)\)/)?.[1];
            const title = item.querySelector("h6.elementor-content-item");
            if (!link || !title) continue;
            // /archives/333401
            const id = link.getAttribute("href")?.match(/archives\/(\d+)\/?$/)?.[1];
            if (!id) continue;

            res.push({
                title: title.textContent?.trim(),
                url: new URL(link.getAttribute("href")!, this.baseUrl).href,
                thumbnail: bg!,
                source: this.sourceId,
                id
            });
        }
        return res;
    }

    override async getHomeVideos(): Promise<IVideoList> {
        const page = await getDocument(this.baseUrl, { useProxy: true });
        return {
            videos: this.parsePage(page),
            currentPage: 1,
            totalPages: 1
        };
    }

    private parseSearchPage(doc: Document) {
        const res: IVideoItem[] = [];
        for (const item of doc.querySelectorAll("div.box_wrap")) {
            const img = item.querySelector("img[data-src]");
            const link = item.querySelector("a[href]");
            if (!img || !link) continue;
            const id = link.getAttribute("href")?.match(/\/(\d+)\/?$/)?.[1];
            if (!id) continue;
        
            res.push({
                title: img.getAttribute("alt")!,
                thumbnail: new URL(img.getAttribute("data-src")!, this.baseUrl).href,
                url: new URL(link.getAttribute("href")!, this.baseUrl).href,
                source: this.sourceId,
                id
            });
        }
        return res;
    }

    override async searchVideos(query: string, page?: number): Promise<IVideoList> {
        const url = new URL(`/?s=${encodeURIComponent(query)}`, this.baseUrl);
        const pageDoc = await getDocument(url, { useProxy: true });
        const videos = this.parseSearchPage(pageDoc);
        return {
            videos,
            currentPage: 1,
            totalPages: 1
        };
    }

    override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
        const page = await getDocument(url, { useProxy: true });
        const mainDiv = page.querySelector("div.flowplayer[data-item]");
        assert(mainDiv, "main div not found");
        const json = JSON.parse(mainDiv.getAttribute("data-item")!) as VideoDetail;

        return json.sources.map(s => ({
            url: s.src,
            format: s.type == 'application/x-mpegurl' ? 'm3u8' : 'h5',
            quality: '720p',
            proxy: URLProxy.REMOTE
        }));
    }

    override getImage(originalUrl: string): Promise<ImageData> {
        return getImage(originalUrl, { useProxy: true });
    }
}