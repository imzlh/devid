/**
 * WebSocket RPC 客户端
 * 提供 RPC 调用和推送消息接收
 */

/**
 * RPC 请求结构
 * @typedef {Object} RPCRequest
 * @property {string} id - 请求ID
 * @property {string} method - 方法名
 * @property {unknown[]} [params] - 参数列表
 */

/**
 * RPC 响应结构
 * @typedef {Object} RPCResponse
 * @property {string} id - 请求ID
 * @property {unknown} [result] - 结果
 * @property {{code: number, message: string}} [error] - 错误
 */

/**
 * 推送消息结构
 * @typedef {Object} PushMessage
 * @property {string} method - 推送方法名
 * @property {unknown} data - 推送数据
 */

class WebSocketRPCClient {
    constructor() {
        /** @type {WebSocket|null} */
        this.ws = null;
        /** @type {Map<string, {resolve: Function, reject: Function}>} */
        this.pendingCalls = new Map();
        /** @type {Map<string, Function>} */
        this.pushHandlers = new Map();
        /** @type {boolean} */
        this.connected = false;
        /** @type {string} */
        this.url = '';
        /** @type {number} */
        this.reconnectAttempts = 0;
        /** @type {number} */
        this.maxReconnectAttempts = 5;
        /** @type {number} */
        this.reconnectDelay = 3000;
    }

    /**
     * 连接到 WebSocket 服务器
     * @param {string} url - WebSocket URL
     * @returns {Promise<void>}
     */
    connect(url) {
        this.url = url;
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    console.log('WebSocket 已连接');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onclose = () => {
                    console.log('WebSocket 已断开');
                    this.connected = false;
                    this.attemptReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket 错误:', error);
                    reject(error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 尝试重新连接
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('WebSocket 重连次数超过上限');
            return;
        }

        this.reconnectAttempts++;
        console.log(`WebSocket ${this.reconnectDelay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);

        setTimeout(() => {
            this.connect(this.url).catch(() => {
                // 重连失败，继续尝试
            });
        }, this.reconnectDelay);
    }

    /**
     * 处理收到的消息
     * @param {string} data
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('WebSocket收到消息:', message);

            // 检查是否是 RPC 响应
            if (message.id && this.pendingCalls.has(message.id)) {
                console.log('处理RPC响应:', message.id);
                const { resolve, reject } = this.pendingCalls.get(message.id);
                this.pendingCalls.delete(message.id);

                if (message.error) {
                    reject(new Error(message.error.message));
                } else {
                    resolve(message.result);
                }
                return;
            }

            // 检查是否是推送消息
            if (message.method && this.pushHandlers.has(message.method)) {
                console.log('处理推送消息:', message.method);
                const handler = this.pushHandlers.get(message.method);
                handler(message.data);
            }
        } catch (error) {
            console.error('处理 WebSocket 消息失败:', error);
        }
    }

    /**
     * 发送 RPC 调用
     * @param {string} method - 方法名
     * @param {unknown[]} [params] - 参数
     * @returns {Promise<unknown>}
     */
    call(method, params = []) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.ws) {
                reject(new Error('WebSocket 未连接'));
                return;
            }

            const id = this.generateId();
            const request = { id, method, params };

            this.pendingCalls.set(id, { resolve, reject });

            // 设置超时
            setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error('RPC 调用超时'));
                }
            }, 30000);

            this.ws.send(JSON.stringify(request));
        });
    }

    /**
     * 注册推送消息处理器
     * @param {string} method - 推送方法名
     * @param {Function} handler - 处理函数
     */
    onPush(method, handler) {
        this.pushHandlers.set(method, handler);
    }

    /**
     * 取消注册推送消息处理器
     * @param {string} method - 推送方法名
     */
    offPush(method) {
        this.pushHandlers.delete(method);
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.pendingCalls.clear();
    }

    /**
     * 生成唯一ID
     * @returns {string}
     */
    generateId() {
        return Math.random().toString(36).substring(2, 15) +
               Math.random().toString(36).substring(2, 15);
    }

    // ==================== 便捷的 RPC 方法 ====================

    /**
     * 获取所有视频源
     * @returns {Promise<unknown>}
     */
    getSources() {
        return this.call('sources.getAll');
    }

    /**
     * 获取活动视频源
     * @returns {Promise<unknown>}
     */
    getActiveSource() {
        return this.call('sources.getActive');
    }

    /**
     * 设置活动视频源
     * @param {string} id
     * @returns {Promise<unknown>}
     */
    setActiveSource(id) {
        return this.call('sources.setActive', [id]);
    }

    /**
     * 获取首页视频
     * @param {number} [page=1]
     * @returns {Promise<unknown>}
     */
    getHomeVideos(page = 1) {
        return this.call('videos.getHome', [page]);
    }

    /**
     * 搜索视频
     * @param {string} query
     * @param {number} [page=1]
     * @returns {Promise<unknown>}
     */
    searchVideos(query, page = 1) {
        return this.call('videos.search', [query, page]);
    }

    /**
     * 获取系列详情
     * @param {string} seriesId
     * @param {string} [url]
     * @returns {Promise<unknown>}
     */
    getSeriesDetail(seriesId, url) {
        return this.call('series.getDetail', [seriesId, url]);
    }

    /**
     * 解析视频
     * @param {string} url
     * @returns {Promise<unknown>}
     */
    parseVideo(url) {
        return this.call('videos.parse', [url]);
    }

    /**
     * 获取所有下载任务
     * @returns {Promise<unknown>}
     */
    getDownloads() {
        return this.call('downloads.getAll');
    }

    /**
     * 创建下载任务
     * @param {string} title
     * @param {string} url
     * @param {string} [referer]
     * @returns {Promise<unknown>}
     */
    createDownload(title, url, referer) {
        return this.call('downloads.create', [title, url, referer]);
    }

    /**
     * 开始下载
     * @param {string} id
     * @returns {Promise<unknown>}
     */
    startDownload(id) {
        return this.call('downloads.start', [id]);
    }

    /**
     * 取消下载
     * @param {string} id
     * @returns {Promise<unknown>}
     */
    cancelDownload(id) {
        return this.call('downloads.cancel', [id]);
    }

    /**
     * 清除已完成下载
     * @returns {Promise<unknown>}
     */
    clearCompletedDownloads() {
        return this.call('downloads.clearCompleted');
    }
}

// 导出单例
const wsClient = new WebSocketRPCClient();
