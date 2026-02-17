/**
 * @typedef {Object} VideoSource
 * @property {string} id - 视频源ID
 * @property {string} name - 视频源名称
 * @property {string} baseUrl - 基础URL
 * @property {boolean} isActive - 是否为活动源
 */

/**
 * @typedef {Object} VideoItem
 * @property {string} id - 视频ID
 * @property {string} title - 视频标题
 * @property {string} url - 视频URL
 * @property {string} thumbnail - 缩略图URL
 * @property {string} duration - 时长
 * @property {string} source - 来源
 */

/**
 * @typedef {Object} M3U8Result
 * @property {string} url - M3U8链接
 * @property {string} quality - 画质名称
 * @property {string} resolution - 分辨率
 * @property {number} bandwidth - 带宽
 */

/**
 * @typedef {Object} DownloadTask
 * @property {string} id - 下载任务ID
 * @property {string} title - 标题
 * @property {string} status - 状态
 * @property {number} progress - 进度(0-100)
 * @property {string} speed - 下载速度
 */

/**
 * API管理类
 */
class APIManager {
    constructor(baseURL = '') {
        /** @type {string} */
        this.baseURL = baseURL;
        /** @type {number} */
        this.requestTimeout = 30000;
    }
    
    /**
     * 发送HTTP请求
     * @param {string} url - 请求URL
     * @param {RequestInit} options - 请求选项
     * @returns {Promise<any>}
     */
    async request(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
        
        try {
            const response = await fetch(this.baseURL + url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                signal: controller.signal,
                ...options
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }
            
            throw error;
        }
    }
    
    /**
     * GET请求
     * @param {string} url
     * @returns {Promise<any>}
     */
    async get(url) {
        return this.request(url, { method: 'GET' });
    }
    
    /**
     * POST请求
     * @param {string} url
     * @param {any} data
     * @returns {Promise<any>}
     */
    async post(url, data) {
        return this.request(url, {
            method: 'POST',
            body: data ? JSON.stringify(data) : null
        });
    }
    
    // 视频源相关API
    /**
     * 获取所有视频源
     * @returns {Promise<{sources: VideoSource[]}>}
     */
    async getSources() {
        return this.get('/api/sources');
    }
    
    /**
     * 设置活动视频源
     * @param {string} source
     * @returns {Promise<any>}
     */
    async setActiveSource(source) {
        return this.post('/api/sources/active', { id: source });
    }
    
    /**
     * 获取当前活动视频源
     * @returns {Promise<VideoSource>}
     */
    async getActiveSource() {
        return this.get('/api/sources/active');
    }
    
    // 视频内容API
    /**
     * 获取首页视频
     * @param {number} page
     * @returns {Promise<{videos: VideoItem[], currentPage: number, totalPages: number}>}
     */
    async getHomeVideos(page = 1) {
        return this.get(`/api/home-videos?page=${page}`);
    }

    /**
     * 获取系列信息
     * @param {number} series
     * @returns {Record<>}
     */
    async getSeriesDetail(series) {
        return this.get('/api/series/' + series);
    }

    /**
     * 获取无限系列视频列表（用于无限播放模式）
     * @param {string} seriesId
     * @returns {Promise<{episodes: Array<{id: string, title: string, url: string}>}>}
     */
    async getSeries(seriesId) {
        return this.get('/api/series/' + seriesId + '/videos');
    }

    /**
     * 搜索视频
     * @param {string} query
     * @param {number} page
     * @returns {Promise<{videos: VideoItem[], currentPage: number, totalPages: number}>}
     */
    async searchVideos(query, page = 1) {
        return this.get(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
    }
    
    /**
     * 解析视频
     * @param {string} url
     * @param {string} source
     * @returns {Promise<{results: M3U8Result[]}>}
     */
    async parseVideo(url, source) {
        return this.post('/api/parse-video', { url, source });
    }
    
    // 下载管理API
    /**
     * 创建下载任务
     * @param {string} title
     * @param {string} m3u8Url
     * @param {string} outputPath
     * @returns {Promise<{task: DownloadTask}>}
     */
    async createDownload(title, m3u8Url, outputPath, referer) {
        return this.post('/api/downloads', { title, url: m3u8Url, outputPath, referer });
    }
    
    /**
     * 开始下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async startDownload(id) {
        return this.post(`/api/downloads/${id}/start`);
    }
    
    /**
     * 获取下载列表
     * @returns {Promise<{tasks: DownloadTask[]}>}
     */
    async getDownloads() {
        return this.get('/api/downloads');
    }
    
    /**
     * 取消下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async cancelDownload(id) {
        return this.post(`/api/downloads/${id}/cancel`);
    }
    
    /**
     * 重试下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async retryDownload(id) {
        return this.post(`/api/downloads/${id}/retry`);
    }
    
    /**
     * 清除已完成下载
     * @returns {Promise<any>}
     */
    async clearCompletedDownloads() {
        return this.post('/api/downloads/clear-completed');
    }
    
    /**
     * 健康检查
     * @returns {Promise<any>}
     */
    async healthCheck() {
        return this.get('/api/health');
    }
    
    /**
     * 获取代理URL
     * @param {string} url
     * @param {string} source
     * @returns {string}
     */
    getProxyUrl(url, source) {
        const filename = url.split('/').pop();
        return `/api/proxy/${filename}?url=${encodeURIComponent(url)}${source ? `&source=${source}` : ''}&referer=${encodeURIComponent(url)}`;
    }
    
    /**
     * 获取图片代理URL
     * @param {string} url
     * @param {string} source
     * @returns {string}
     */
    getImageProxyUrl(url, source) {
        return `/api/image-proxy?url=${encodeURIComponent(url)}&source=${source}`;
    }
}