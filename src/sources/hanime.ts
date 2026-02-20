import assert from "node:assert";
import { IVideoURL, IVideoList, IVideoItem, URLProxy } from "../types/index.ts";
import { getDocument, getImage } from "../utils/fetch.ts";
import { BaseVideoSource, ImageData } from "./index.ts";
import { Document } from "dom";

export default class HAnime extends BaseVideoSource {
    constructor() {
        super("hanime", "HAnime(强制使用代理)", "https://hanime1.me");
    }

    override async init(): Promise<void> {
        // No initialization needed
    }

    private parsePage(doc: Document) {
        const res: IVideoItem[] = [];
        for (const item of doc.querySelectorAll(".video-item-container[title]")) {
            // 过滤广告
            if (item.querySelector(".stat-item")?.innerText.trim() === "赞助商")
                continue;
            
            const title = item.getAttribute("title")!;
            const link = item.querySelector("a.video-link")?.getAttribute("href")!;
            const img = item.querySelector("img.main-thumb")?.getAttribute("src")!;
            const dur = item.querySelector(".duration")?.innerText;
            if (!link || !img) continue;

            res.push({
                id: link.split("/").pop()!,
                title,
                thumbnail: img,
                duration: dur,
                url: new URL(link, this.baseUrl).href,
                source: this.sourceId,
                contentType: "video"
            });
        }
        return res;
    }

    override async getHomeVideos(): Promise<IVideoList> {
        const doc = await getDocument(new URL("/", this.baseUrl), { useProxy: true });
        const videos = this.parsePage(doc);
        return {
            videos: videos,
            currentPage: 1,
            totalPages: 1
        };
    }

    override async searchVideos(query: string, page?: number): Promise<IVideoList> {
        const res = await getDocument(
            new URL("/search?query=" + encodeURIComponent(query), this.baseUrl).href,
            { useProxy: true }
        );
        const videos = this.parsePage(res);
        const indicator = res.querySelector(".skip-page-wrapper");
        const [cur, total] = indicator?.innerText.split("/").map(s => parseInt(s.trim())) || [1, 1];
        return {
            videos: videos,
            currentPage: cur,
            totalPages: total
        };
    }

    override async parseVideoUrl(url: string): Promise<IVideoURL[]> {
        const doc = await getDocument(url, { useProxy: true });
        const vid = doc.querySelector("video[poster]");
        assert(vid, "Video element not found");

        return vid.getElementsByTagName("source")
            .map(s => ({
                quality: s.getAttribute("size") + 'p',
                url: s.getAttribute("src")!,
                format: 'h5',
                proxy: URLProxy.REMOTE
            }));
    }

    override getImage(originalUrl: string): Promise<ImageData> {
        return getImage(originalUrl, { useProxy: true });
    }
}