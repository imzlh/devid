import {
    IVideoList,
    IVideoURL, ISeriesResult
} from '../types/index.ts';
import { getImage } from "../utils/fetch.ts";

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

    // 是否支持系列/动漫功能
    protected supportsSeries = false;

    constructor(sourceId: string, sourceName: string, baseUrl: string, series?: boolean) {
        this.sourceId = sourceId;
        this.sourceName = sourceName;
        this.baseUrl = baseUrl;
        this.supportsSeries = !!series;
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

    // 是否支持系列功能
    getSupportsSeries(): boolean {
        return this.supportsSeries;
    }


    get base() {
        return this.baseUrl;
    }

    // ========== 基础视频功能 ==========

    // 获取主页视频列表（只返回基本信息，不包含完整剧集列表）
    abstract getHomeVideos(page?: number): Promise<IVideoList>;

    // 搜索视频
    abstract searchVideos(query: string, page?: number): Promise<IVideoList>;

    // 解析视频链接获取M3U8
    abstract parseVideoUrl(url: string): Promise<IVideoURL[]>;

    // 获取图片数据
    getImage(originalUrl: string): Promise<ImageData> {
        return getImage(originalUrl, {
            headers: {
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Origin': this.baseUrl
            }
        });
    }

    /**
     * 获取系列剧集列表（点击系列后调用，返回完整剧集列表）
     * @param seriesId - 系列ID
     * @param url - 可选的系列页面URL，如果提供则优先使用
     */
    async getSeries(seriesId: string, url?: string): Promise<ISeriesResult | null> {
        throw new Error('该视频源不支持系列列表功能');
    }
}