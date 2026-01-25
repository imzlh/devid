import { VideoItem, VideoList, M3U8Result } from '../types/index.ts';

// 图片数据接口
export interface ImageData {
  data: Uint8Array;
  contentType: string; // 例如: "image/jpeg", "image/png", "image/webp"
}

// 视频源基础抽象类
export abstract class BaseVideoSource {
    protected sourceId: string;
    protected sourceName: string;
    protected baseUrl: string;

    constructor(sourceId: string, sourceName: string, baseUrl: string) {
        this.sourceId = sourceId;
        this.sourceName = sourceName;
        this.baseUrl = baseUrl;
    }

    // 初始化视频源
    abstract init(): Promise<void>;

    // 获取源ID
    getId(): string {
        return this.sourceId;
    }

    // 获取源名称
    getName(): string {
        return this.sourceName;
    }

    // 获取主页视频列表
    abstract getHomeVideos(page?: number): Promise<VideoList>;

    // 搜索视频
    abstract searchVideos(query: string, page?: number): Promise<VideoList>;

    // 解析视频链接获取M3U8
    abstract parseVideoUrl(url: string): Promise<M3U8Result[]>;

    // 获取图片数据
    abstract getImage(originalUrl: string): Promise<ImageData>;
}