import { BaseVideoSource, ImageData } from './index.ts';
import { IVideoItem, IVideoList, IM3U8Result } from '../types/index.ts';
import { fetch2, getImage as fetchImage, findAvailableFast, getDocument } from '../utils/fetch.ts';
import { Document, DOMParser } from "dom";
import { logError, logInfo } from "../utils/logger.ts";
import assert from "node:assert";

interface GG51VideoItem {
    view_key: string;
    title: string;
    poster: string;
    duration: number;
    price: number;
    price_vip: number;
    is_vip: number;
    tags: string[];
    play_url: string;
    hits: string;
}

// GG51视频源实现
export default class GG51VideoSource extends BaseVideoSource {
    private resolvedBaseUrl: string = '';

    constructor() {
        super('gg51', 'GG51', 'https://gg51.com');
    }

    // 初始化视频源 - 解析真实的主域名
    async init(): Promise<void> {
        logInfo(`初始化视频源: ${this.sourceName}`);

        // 获取主页内容
        const decodedContent = await this.getEncodedPage(this.baseUrl);
        const parser = new DOMParser();
        const document = parser.parseFromString(decodedContent, "text/html");
        const urls = Array.from(document.querySelectorAll('.ulist-url'))
            .map(el => el.innerText);
        const available = await findAvailableFast(urls);

        // 验证是否成功解析到有效域名
        assert(available, '无法解析到有效域名');
        this.resolvedBaseUrl = available;
        logInfo(`解析到真实域名: ${this.resolvedBaseUrl}`);
    }

    private async getEncodedPage(url: string): Promise<string> {
        const response = await getDocument(url);
        const mainScript = response.getElementsByTagName('script')
            .find(e => e.innerText.length > 1000);

        // start a sandbox
        return new Promise(rs => {
            const document = {
                write: (text: string) => rs(text)
            };
            new Function('document', mainScript!.innerText)(document);
        });
    }

    // 获取主页视频列表
    async getHomeVideos(page: number = 1): Promise<IVideoList> {
        // 确保已经初始化
        if (!this.resolvedBaseUrl) {
            throw new Error('视频源未初始化，请先调用 init() 方法');
        }

        // 第一页直接从主页解析
        if (page === 1) {
            // 构建分页URL
            const homeUrl = this.resolvedBaseUrl;
            const encodedPage = await this.getEncodedPage(homeUrl);

            // 解析HTML内容
            const parser = new DOMParser();
            const document = parser.parseFromString(encodedPage, "text/html");

            // 由于无法直接获取总页数，我们设置一个合理的默认值
            // 实际分页通过"加载更多"方式实现
            return {
                videos: this.parsePage(document),
                currentPage: page,
                totalPages: 50 // 设置一个较大的默认值，实际通过API动态加载
            };
        } else {
            // 后续页面通过API加载
            return await this.loadMoreVideos(page);
        }
    }

    private parsePage(document: Document): IVideoItem[] {
        // 提取视频列表
        const videoElements = document.querySelectorAll('.videolist a.one');
        const videos: IVideoItem[] = [];

        for (const element of videoElements) {
            // 跳过广告链接
            if (element.getAttribute('target') === '_blank') {
                continue;
            }

            const href = element.getAttribute('href') || '';
            const titleElement = element.querySelector('.title');
            const title = titleElement?.textContent?.trim() || '';

            const imgElement = element.querySelector('img');
            const thumbnail = imgElement?.getAttribute('data-original') || imgElement?.getAttribute('src') || '';

            const durationElement = element.querySelector('.duration');
            let duration = '';
            if (durationElement) {
                // 提取script标签内的文本内容
                const scriptText = durationElement.textContent?.trim() || '';
                const durationMatch = scriptText.match(/(\d{2}:\d{2}:\d{2})/);
                if (durationMatch) {
                    duration = durationMatch[1];
                }
            }

            if (href && title) {
                videos.push({
                    id: href.replace('/view/', ''),
                    title,
                    thumbnail,
                    duration,
                    url: new URL(href, this.resolvedBaseUrl).href,
                    source: this.sourceId
                });
            }
        }
        return videos;
    }

    private async getMore(id: string, referer: string, page: number = 1) {
        // 通过API获取更多视频
        const response = await fetch2(new URL(`/data/getlistbyid`, this.resolvedBaseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': referer,
                'Origin': this.resolvedBaseUrl,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: new URLSearchParams({
                '_csrf': '',
                'id': id,
                'page': page.toString()
            })
        });

        const data = await response.json();
        const videos: IVideoItem[] = [];

        // 解析返回的内容
        if (data.listData) for (const item of (data.listData as GG51VideoItem[])) {
            videos.push({
                id: item.view_key,
                title: item.title,
                thumbnail: new URL(item.poster, this.resolvedBaseUrl).href,
                duration: item.duration.toString(),
                url: new URL(item.play_url, this.resolvedBaseUrl).href,
                source: this.sourceId
            });
        }
        return videos;
    }

    // 通过API加载更多视频
    async loadMoreVideos(page: number): Promise<IVideoList> {
        try {
            // 获取首页以找到loadMore2函数中的id
            const homeUrl = this.resolvedBaseUrl;
            const encodedPage = await this.getEncodedPage(homeUrl);

            // 查找所有loadMore2调用中的id，页面可能有多处
            const loadMoreMatches = encodedPage.match(/loadMore2\((\d+),\s*\$\(this\)\)/g);
            assert(loadMoreMatches && loadMoreMatches.length > 0, '未找到loadMore2调用');

            const videos: IVideoItem[] = [];
            for (const match of loadMoreMatches) {
                const idMatch = match.match(/loadMore2\((\d+),/);
                if (idMatch) {
                    const id = idMatch[1];
                    const moreVideos = await this.getMore(id, homeUrl, page);
                    videos.push(...moreVideos);
                }
            }

            // 如果没有更多视频，表示已到最后一页
            const isLastPage = videos.length === 0;

            return {
                videos,
                currentPage: page,
                totalPages: isLastPage ? page : 50 // 如果是最后一页，设置总页数为当前页
            };
        } catch (error) {
            console.error('加载更多视频失败:', error);
            return {
                videos: [],
                currentPage: page,
                totalPages: page // 出错时返回空列表，并设置总页数为当前页
            };
        }
    }

    // 搜索视频
    async searchVideos(query: string, page: number = 1): Promise<IVideoList> {
        // 构建搜索URL，支持分页
        let searchUrl = new URL(`/search/${encodeURIComponent(query)}`, this.resolvedBaseUrl).href;
        if (page > 1) {
            searchUrl += `/${page}`;
        }

        const decodedContent = await this.getEncodedPage(searchUrl);
        const parser = new DOMParser();
        const document = parser.parseFromString(decodedContent, "text/html");

        const totalPagesEl = document.querySelector('form > div > span')
        assert(totalPagesEl, '无法解析总页数');
        const totalPages = totalPagesEl.textContent?.trim().substring(1) || '1';
        return {
            videos: this.parsePage(document),
            currentPage: page,
            totalPages: parseInt(totalPages)
        };
    }

    // 解析视频链接获取M3U8
    async parseVideoUrl(url: string): Promise<IM3U8Result[]> {
        const fullUrl = new URL(url, this.resolvedBaseUrl).href;

        // 解析重定向后的页面内容
        const decodedContent = await this.getEncodedPage(fullUrl);

        // 查找initPlayer函数调用
        const playerMatch = decodedContent.match(/initPlayer\("([^"]+)"\)/);
        if (!playerMatch) {
            throw new Error('无法找到播放器链接');
        }

        const m3u8Url = playerMatch[1];

        return [{
            url: m3u8Url,
            quality: '高清',
            resolution: '1920x1080',
            bandwidth: 2000000
        }];
    }

    // 获取图片数据
    override async getImage(originalUrl: string): Promise<ImageData> {
        // 使用URL构造函数正确处理相对路径
        let imageUrl = new URL(originalUrl, this.resolvedBaseUrl).href;

        // 处理.js结尾的图片URL
        imageUrl = imageUrl.endsWith('.js') ? imageUrl : imageUrl;

        // 获取图片数据
        const imageData = await fetchImage(imageUrl, {
            headers: {
                'Referer': this.resolvedBaseUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        // 创建新的ImageData对象
        return {
            data: imageData.data,
            contentType: 'image/jpeg'
        };
    }
}