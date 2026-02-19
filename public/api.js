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
 * @property {string} format - 格式(m3u8/h5)
 * @property {string} referrer - 来源URL
 * @property {boolean} skipProxy - 是否跳过代理直接使用原始URL
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
 * 优先使用WebSocket RPC，不可用则回退到HTTP
 */
class APIManager {
    constructor(baseURL = '') {
        /** @type {string} */
        this.baseURL = baseURL;
        /** @type {number} */
        this.requestTimeout = 30000;
        /** @type {boolean} */
        this.useWebSocket = false;
    }

    /**
     * 设置WebSocket客户端
     * @param {WebSocketRPCClient} wsClient
     */
    setWebSocketClient(wsClient) {
        this.wsClient = wsClient;
        this.updateWebSocketState();
    }

    /**
     * 更新WebSocket状态
     */
    updateWebSocketState() {
        if (this.wsClient) {
            this.useWebSocket = this.wsClient.connected;
        } else {
            this.useWebSocket = false;
        }
    }

    /**
     * 调用API（优先WebSocket，回退HTTP）
     * @param {string} rpcMethod - RPC方法名
     * @param {unknown[]} rpcParams - RPC参数
     * @param {string} httpUrl - HTTP URL
     * @param {RequestInit} httpOptions - HTTP选项
     * @returns {Promise<any>}
     */
    async call(rpcMethod, rpcParams, httpUrl, httpOptions) {
        // 每次调用前更新WebSocket状态
        this.updateWebSocketState();

        // 优先尝试WebSocket
        if (this.useWebSocket && this.wsClient && this.wsClient.connected) {
            try {
                const result = await this.wsClient.call(rpcMethod, rpcParams);
                return result;
            } catch (error) {
                console.warn(`WebSocket调用失败，回退到HTTP: ${rpcMethod}`, error);
                this.useWebSocket = false;
            }
        }

        // 回退到HTTP
        if (httpOptions) {
            return this.request(httpUrl, httpOptions);
        } else {
            return this.get(httpUrl);
        }
    }
    
    /**
     * 发送HTTP请求
     * @param {string} url - 请求URL
     * @param {RequestInit} options - 请求选项
     * @param {number} retryCount - 当前重试次数
     * @returns {Promise<any>}
     */
    async request(url, options = {}, retryCount = 0) {
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
                // 尝试解析错误响应
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch {
                    // 忽略解析错误
                }
                throw new Error(errorMessage);
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
                throw new Error('请求超时，请检查网络连接');
            }
            
            // 网络错误重试机制
            const maxRetries = 2;
            if (retryCount < maxRetries && (error.message.includes('fetch') || error.message.includes('network'))) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return this.request(url, options, retryCount + 1);
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
        return this.call('sources.getAll', [], '/api/sources');
    }

    /**
     * 设置活动视频源
     * @param {string} source
     * @returns {Promise<any>}
     */
    async setActiveSource(source) {
        return this.call('sources.setActive', [source], '/api/sources/active', {
            method: 'POST',
            body: JSON.stringify({ id: source })
        });
    }

    /**
     * 获取当前活动视频源
     * @returns {Promise<VideoSource>}
     */
    async getActiveSource() {
        return this.call('sources.getActive', [], '/api/sources/active');
    }
    
    // 视频内容API
    /**
     * 获取首页视频
     * @param {number} page
     * @returns {Promise<{videos: VideoItem[], currentPage: number, totalPages: number}>}
     */
    async getHomeVideos(page = 1) {
        return this.call('videos.getHome', [page], `/api/home-videos?page=${page}`);
    }

    /**
     * 获取系列信息
     * @param {string} seriesId - 系列ID
     * @param {string} [url] - 可选的系列页面URL
     * @returns {Record<>}
     */
    async getSeriesDetail(seriesId, url) {
        const urlParam = url ? `?url=${encodeURIComponent(url)}` : '';
        return this.call('series.getDetail', [seriesId, url], '/api/series/' + seriesId + urlParam);
    }

    /**
     * 获取无限系列视频列表（用于无限播放模式）
     * @param {string} seriesId
     * @returns {Promise<{episodes: Array<{id: string, title: string, url: string}>}>}
     */
    async getSeries(seriesId) {
        return this.call('series.getVideos', [seriesId], '/api/series/' + seriesId + '/videos');
    }

    /**
     * 搜索视频
     * @param {string} query
     * @param {number} page
     * @returns {Promise<{videos: VideoItem[], currentPage: number, totalPages: number}>}
     */
    async searchVideos(query, page = 1) {
        return this.call('videos.search', [query, page], `/api/search?q=${encodeURIComponent(query)}&page=${page}`);
    }

    /**
     * 解析视频
     * @param {string} url
     * @param {string} source
     * @returns {Promise<{results: M3U8Result[]}>}
     */
    async parseVideo(url, source) {
        return this.call('videos.parse', [url], '/api/parse-video', {
            method: 'POST',
            body: JSON.stringify({ url, source })
        });
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
        return this.call('downloads.create', [title, m3u8Url, outputPath, referer], '/api/downloads', {
            method: 'POST',
            body: JSON.stringify({ title, url: m3u8Url, outputPath, referer })
        });
    }

    /**
     * 开始下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async startDownload(id) {
        return this.call('downloads.start', [id], `/api/downloads/${id}/start`, {
            method: 'POST'
        });
    }

    /**
     * 获取下载列表
     * @returns {Promise<{tasks: DownloadTask[]}>}
     */
    async getDownloads() {
        return this.call('downloads.getAll', [], '/api/downloads');
    }

    /**
     * 取消下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async cancelDownload(id) {
        return this.call('downloads.cancel', [id], `/api/downloads/${id}/cancel`, {
            method: 'POST'
        });
    }

    /**
     * 重试下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async retryDownload(id) {
        return this.call('downloads.retry', [id], `/api/downloads/${id}/retry`, {
            method: 'POST'
        });
    }

    /**
     * 清除已完成下载
     * @returns {Promise<any>}
     */
    async clearCompletedDownloads() {
        return this.call('downloads.clearCompleted', [], '/api/downloads/clear-completed', {
            method: 'POST'
        });
    }

    /**
     * 健康检查
     * @returns {Promise<any>}
     */
    async healthCheck() {
        return this.call('health.get', [], '/api/health');
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