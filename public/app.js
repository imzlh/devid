/**
 * @typedef {'home'|'search'|'downloads'|'sources'} PageType
 */

/**
 * 视频管理应用主类
 */
class VideoManager {
    constructor() {
        /** @type {APIManager} */
        this.api = new APIManager();
        /** @type {WebSocketRPCClient} */
        this.wsClient = new WebSocketRPCClient();
        /** @type {NotificationManager} */
        this.notifications = new NotificationManager();
        /** @type {ThemeManager} */
        this.themeManager = new ThemeManager();
        /** @type {VideoPlayerManager} */
        this.playerManager = new VideoPlayerManager();

        /** @type {PageType} */
        this.currentPage = 'home';
        /** @type {VideoSource|null} */
        this.currentSource = null;
        /** @type {string} */
        this.searchQuery = '';

        /** @type {Object} */
        this.pagination = {
            home: { current: 1, total: 1 },
            search: { current: 1, total: 1 }
        };

        /** @type {number|null} */
        this.downloadInterval = null;
        /** @type {number|null} */
        this.sourceSyncInterval = null;
        /** @type {boolean} */
        this.isInitialized = false;

        /** @type {Object|null} 当前正在播放的系列视频 */
        this.currentSeriesVideo = null;
        /** @type {Array} 当前剧集列表 */
        this.currentEpisodes = [];

        /** @type {Object} 页面数据缓存 */
        this.pageCache = {
            home: { loaded: false, timestamp: 0 },
            search: { loaded: false, timestamp: 0 },
            downloads: { loaded: false, timestamp: 0 },
            sources: { loaded: false, timestamp: 0 }
        };
        /** @type {number} 缓存有效期（毫秒）- 5分钟 */
        this.cacheTTL = 5 * 60 * 1000;
        
        this.init();
    }
    
    /**
     * 启动源状态同步
     */
    startSourceSync() {
        // 每30秒同步一次源状态
        this.sourceSyncInterval = setInterval(() => {
            this.syncSourceState();
        }, 30000);
    }
    
    /**
     * 同步源状态
     */
    async syncSourceState() {
        try {
            const oldSourceId = this.currentSource ? this.currentSource.id : null;
            await this.loadActiveSource();
            
            // 如果活动源发生变化，重新加载当前页面
            const newSourceId = this.currentSource ? this.currentSource.id : null;
            if (oldSourceId !== newSourceId) {
                console.log(`活动源发生变化: ${oldSourceId} -> ${newSourceId}`);
                await this.reloadCurrentPage();
            }
        } catch (error) {
            console.error('同步源状态失败:', error);
        }
    }
    
    /**
     * 重新加载当前页面
     */
    async reloadCurrentPage() {
        switch (this.currentPage) {
            case 'home':
                await this.loadHomePage(this.pagination.home.current);
                break;
            case 'search':
                await this.loadSearchResults(this.pagination.search.current);
                break;
            case 'sources':
                await this.loadSources();
                break;
            case 'downloads':
                await this.loadDownloads();
                break;
        }
    }
    
    /**
     * 加载URL哈希参数
     */
    loadFromHash() {
        const hash = window.location.hash.substring(1);
        if (!hash) return;
        
        try {
            const params = new URLSearchParams(hash);
            
            // 加载搜索查询
            const searchQuery = params.get('search');
            if (searchQuery) {
                const searchInput = DOMHelper.$('#searchInput');
                if (searchInput) {
                    searchInput.value = decodeURIComponent(searchQuery);
                    this.searchQuery = decodeURIComponent(searchQuery);
                }
            }
            
            // 加载页面状态
            const page = params.get('page');
            if (page && ['home', 'search', 'downloads', 'sources'].includes(page)) {
                this.currentPage = page;
                this.switchPage(page, false); // 不更新哈希
            }
            
            // 加载页码
            const pageNum = params.get('pageNum');
            if (pageNum && !isNaN(parseInt(pageNum))) {
                const pageNumInt = parseInt(pageNum);
                if (this.currentPage === 'home') {
                    this.pagination.home.current = pageNumInt;
                } else if (this.currentPage === 'search') {
                    this.pagination.search.current = pageNumInt;
                }
            }
        } catch (error) {
            console.error('加载哈希参数失败:', error);
        }
    }
    
    /**
     * 保存状态到URL哈希
     */
    saveToHash() {
        const params = new URLSearchParams();
        
        // 保存当前页面
        params.set('page', this.currentPage);
        
        // 保存搜索查询
        if (this.searchQuery && this.currentPage === 'search') {
            params.set('search', encodeURIComponent(this.searchQuery));
        }
        
        // 保存页码
        if (this.currentPage === 'home') {
            params.set('pageNum', this.pagination.home.current.toString());
        } else if (this.currentPage === 'search') {
            params.set('pageNum', this.pagination.search.current.toString());
        }
        
        window.location.hash = params.toString();
    }
    
    /**
     * 初始化应用
     */
    async init() {
        try {
            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve);
                });
            }

            this.bindEvents();
            await this.loadActiveSource();

            // 启动源状态同步定时器（每隔30秒同步一次）
            this.startSourceSync();

            // 设置应用已初始化标志，以便哈希路由可以正常工作
            this.isInitialized = true;

            // 加载URL哈希参数
            this.loadFromHash();

            await this.loadHomePage();

            // 启动WebSocket连接（替代轮询）
            this.initWebSocket();

            // 健康检查
            try {
                await this.api.healthCheck();
                console.log('API服务正常');
            } catch (error) {
                this.notifications.error('API服务连接失败');
            }
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.notifications.error('应用初始化失败');
        }
    }

    /**
     * 初始化WebSocket连接
     */
    async initWebSocket() {
        try {
            const wsUrl = `ws://${window.location.host}/ws`;
            await this.wsClient.connect(wsUrl);
            console.log('WebSocket已连接');

            // 将WebSocket客户端设置到API管理器
            this.api.setWebSocketClient(this.wsClient);

            // 注册推送消息处理器
            this.registerPushHandlers();
        } catch (error) {
            console.error('WebSocket连接失败:', error);
            // WebSocket连接失败时，回退到轮询
            this.startDownloadMonitoring();
        }
    }

    /**
     * 注册WebSocket推送消息处理器
     */
    registerPushHandlers() {
        // 下载状态更新推送
        this.wsClient.onPush('download:update', (tasks) => {
            if (this.currentPage === 'downloads') {
                this.renderDownloadList(tasks);
            }
            this.updateDownloadBadgeFromTasks(tasks);
        });

        // 下载完成推送
        this.wsClient.onPush('download:complete', (task) => {
            this.notifications.success(`下载完成: ${task.title}`);
            if (this.currentPage === 'downloads') {
                this.loadDownloads();
            }
        });

        // 下载错误推送
        this.wsClient.onPush('download:error', ({ taskId, error }) => {
            console.error(`下载错误 ${taskId}:`, error);
            if (this.currentPage === 'downloads') {
                this.loadDownloads();
            }
        });

        // 源切换推送
        this.wsClient.onPush('source:change', ({ sourceId, sourceName }) => {
            console.log(`源切换: ${sourceId} - ${sourceName}`);
            if (this.currentSource?.id !== sourceId) {
                this.loadActiveSource().then(() => {
                    this.reloadCurrentPage();
                });
            }
        });

        // 验证码请求推送
        this.wsClient.onPush('captcha:required', (data) => {
            console.log('收到验证码请求:', data);
            this.handleCaptchaRequired(data);
        });
    }

    /**
     * 处理验证码请求
     * @param {Object} data - 验证码请求数据
     */
    handleCaptchaRequired(data) {
        const { requestId, imageUrl, prompt } = data;

        // 构建验证码页面 URL
        const captchaUrl = `/captcha.html?requestId=${encodeURIComponent(requestId)}&imageUrl=${encodeURIComponent(imageUrl)}&prompt=${encodeURIComponent(prompt || '请输入验证码')}`;

        // 使用 iframe 显示验证码
        const overlay = DOMHelper.$('#captchaOverlay');
        const iframe = DOMHelper.$('#captchaIframe');

        if (overlay && iframe) {
            iframe.src = captchaUrl;
            DOMHelper.show(overlay);
        }
    }

    /**
     * 关闭验证码 iframe
     */
    closeCaptchaOverlay() {
        const overlay = DOMHelper.$('#captchaOverlay');
        const iframe = DOMHelper.$('#captchaIframe');

        if (overlay && iframe) {
            iframe.src = 'about:blank';
            DOMHelper.hide(overlay);
        }
    }

    /**
     * 从任务列表更新下载徽章
     * @param {DownloadTask[]} tasks
     */
    updateDownloadBadgeFromTasks(tasks) {
        const activeDownloads = tasks.filter(d =>
            d.status === 'downloading' || d.status === 'created'
        ).length;

        const badge = DOMHelper.$('#downloadBadge');
        if (badge) {
            badge.textContent = activeDownloads;
            badge.style.display = activeDownloads > 0 ? 'block' : 'none';
        }
    }
    
    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 监听 iframe 发来的消息
        DOMHelper.on(window, 'message', (e) => {
            if (e.data && e.data.type === 'captcha:close') {
                this.closeCaptchaOverlay();
            }
        });

        // 导航菜单
        const navItems = DOMHelper.$$('.nav-item');
        navItems.forEach(item => {
            DOMHelper.on(item, 'click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                if (page) {
                    this.switchPage(page);
                }
            });
        });

        // 搜索功能
        const searchBtn = DOMHelper.$('#searchBtn');
        const searchInput = DOMHelper.$('#searchInput');
        
        if (searchBtn) {
            DOMHelper.on(searchBtn, 'click', () => this.performSearch());
        }
        
        if (searchInput) {
            DOMHelper.on(searchInput, 'keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.performSearch();
                }
            });
        }
        
        // 模态框控制
        this.bindModalEvents();
        
        // 下载控制
        this.bindDownloadEvents();
        
        // 移动端支持
        this.bindMobileEvents();
        
        // 键盘快捷键
        this.bindKeyboardEvents();
    }
    
    /**
     * 绑定模态框事件
     */
    bindModalEvents() {
        const modalClose = DOMHelper.$('#modalClose');
        const videoModal = DOMHelper.$('#videoModal');
        const modalContent = DOMHelper.$('.video-modal-content');
        
        if (modalClose) {
            DOMHelper.on(modalClose, 'click', () => {
                this.closeVideoModal();
            });
        }
        
        if (videoModal) {
            DOMHelper.on(videoModal, 'click', (e) => {
                if (e.target === videoModal) {
                    this.closeVideoModal();
                }
            });
        }
        
        // 添加滑动关闭支持（移动端）
        if (modalContent && 'ontouchstart' in window) {
            let startY = 0;
            let currentY = 0;
            let isDragging = false;
            
            DOMHelper.on(modalContent, 'touchstart', (e) => {
                // 只在模态框顶部区域允许滑动
                const rect = modalContent.getBoundingClientRect();
                if (e.touches[0].clientY - rect.top < 80) {
                    startY = e.touches[0].clientY;
                    isDragging = true;
                    modalContent.classList.add('swiping');
                }
            }, { passive: true });
            
            DOMHelper.on(modalContent, 'touchmove', (e) => {
                if (!isDragging) return;
                currentY = e.touches[0].clientY;
                const offset = Math.max(0, currentY - startY);
                modalContent.style.setProperty('--swipe-offset', offset + 'px');
            }, { passive: true });
            
            DOMHelper.on(modalContent, 'touchend', () => {
                if (!isDragging) return;
                isDragging = false;
                modalContent.classList.remove('swiping');
                
                const offset = parseInt(modalContent.style.getPropertyValue('--swipe-offset') || '0');
                modalContent.style.removeProperty('--swipe-offset');
                
                // 如果滑动距离超过 150px，关闭模态框
                if (offset > 150) {
                    videoModal.classList.add('swipe-close');
                    setTimeout(() => {
                        videoModal.classList.remove('swipe-close');
                        this.closeVideoModal();
                    }, 300);
                }
            }, { passive: true });
        }
        
        // 复制链接按钮
        const copyLinkBtn = DOMHelper.$('#copyLinkBtn');
        if (copyLinkBtn) {
            DOMHelper.on(copyLinkBtn, 'click', () => {
                this.copyCurrentVideoLink();
            });
        }
    }
    
    /**
     * 绑定下载相关事件
     */
    bindDownloadEvents() {
        const clearCompletedBtn = DOMHelper.$('#clearCompletedBtn');
        const refreshDownloadsBtn = DOMHelper.$('#refreshDownloadsBtn');
        
        if (clearCompletedBtn) {
            DOMHelper.on(clearCompletedBtn, 'click', () => {
                this.clearCompletedDownloads();
            });
        }
        
        if (refreshDownloadsBtn) {
            DOMHelper.on(refreshDownloadsBtn, 'click', () => {
                this.loadDownloads();
            });
        }
    }
    
    /**
     * 绑定移动端事件
     */
    bindMobileEvents() {
        // 滑动隐藏/显示导航栏
        this.initSwipeToHideNav();

        if (window.innerWidth <= 768) {
            const sidebar = DOMHelper.$('#sidebar');
            const mainContent = DOMHelper.$('#mainContent');

            if (sidebar && mainContent) {
                DOMHelper.on(mainContent, 'click', () => {
                    sidebar.classList.remove('show');
                });
            }
        }
    }

    /**
     * 初始化滑动隐藏导航栏功能
     */
    initSwipeToHideNav() {
        if (window.innerWidth > 768) return;

        const topHeader = DOMHelper.$('.top-header');
        const sidebar = DOMHelper.$('#sidebar');
        const contentArea = DOMHelper.$('#contentArea');

        if (!topHeader || !sidebar || !contentArea) return;

        let startY = 0;
        let currentY = 0;
        let isScrolling = false;
        let lastScrollY = window.scrollY;
        let scrollThreshold = 10; // 滚动阈值

        // 监听滚动事件
        DOMHelper.on(window, 'scroll', () => {
            const currentScrollY = window.scrollY;
            const scrollDiff = currentScrollY - lastScrollY;

            // 向下滚动超过阈值，隐藏导航栏
            if (scrollDiff > scrollThreshold && currentScrollY > 100) {
                topHeader.classList.add('nav-hidden');
                sidebar.classList.add('nav-hidden');
            }
            // 向上滚动，显示导航栏
            else if (scrollDiff < -scrollThreshold) {
                topHeader.classList.remove('nav-hidden');
                sidebar.classList.remove('nav-hidden');
            }

            lastScrollY = currentScrollY;
        }, { passive: true });

        // 触摸滑动支持
        DOMHelper.on(contentArea, 'touchstart', (e) => {
            startY = e.touches[0].clientY;
            isScrolling = true;
        }, { passive: true });

        DOMHelper.on(contentArea, 'touchmove', (e) => {
            if (!isScrolling) return;
            currentY = e.touches[0].clientY;
        }, { passive: true });

        DOMHelper.on(contentArea, 'touchend', () => {
            if (!isScrolling) return;
            isScrolling = false;

            const diff = currentY - startY;
            // 向上滑动（隐藏）
            if (diff < -50) {
                topHeader.classList.add('nav-hidden');
                sidebar.classList.add('nav-hidden');
            }
            // 向下滑动（显示）
            else if (diff > 50) {
                topHeader.classList.remove('nav-hidden');
                sidebar.classList.remove('nav-hidden');
            }
        }, { passive: true });
    }

    /**
     * 绑定键盘事件
     */
    bindKeyboardEvents() {
        DOMHelper.on(document, 'keydown', (e) => {
            // ESC 关闭模态框或返回选集
            if (e.key === 'Escape') {
                const modal = DOMHelper.$('#videoModal');
                if (modal && !modal.classList.contains('hidden')) {
                    // 如果正在播放系列剧集（player存在且currentSeriesVideo存在），返回选集页面
                    if (this.currentSeriesVideo && this.playerManager.player) {
                        this.backToEpisodes();
                    } else {
                        this.closeVideoModal();
                    }
                }
            }
            
            // Ctrl/Cmd + K 聚焦搜索框
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const searchInput = DOMHelper.$('#searchInput');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
            
            // 数字键快速切换页面
            if (e.key >= '1' && e.key <= '4' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const pages = ['home', 'search', 'downloads', 'sources'];
                const pageIndex = parseInt(e.key) - 1;
                
                if (pageIndex < pages.length && document.activeElement.tagName !== 'INPUT') {
                    this.switchPage(pages[pageIndex]);
                }
            }
            
            // 左右箭头键留给播放器控制快进/后退
            // 上一集/下一集使用 ArtPlayer 内置的控件按钮
        });
    }
    
    /**
     * 切换页面
     * @param {PageType} page
     * @param {boolean} updateHash 是否更新哈希（默认true）
     */
    switchPage(page, updateHash = true) {
        if (!this.isInitialized) return;
        
        // 更新导航状态
        DOMHelper.$$('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeNavItem = DOMHelper.$(`[data-page="${page}"]`);
        if (activeNavItem) {
            activeNavItem.classList.add('active');
        }
        
        // 切换页面内容
        DOMHelper.$$('.page-content').forEach(content => {
            DOMHelper.hide(content);
        });
        
        const targetPage = DOMHelper.$(`#${page}Page`);
        if (targetPage) {
            DOMHelper.show(targetPage);
        }
        
        this.currentPage = page;
        
        // 更新URL哈希
        if (updateHash) {
            this.saveToHash();
        }
        
        // 加载页面数据
        this.loadPageData(page);
    }
    
    /**
     * 检查页面数据是否需要加载
     * @param {PageType} page
     * @returns {boolean}
     */
    shouldLoadPageData(page) {
        // 下载页面始终刷新（状态变化快）
        if (page === 'downloads') {
            return true;
        }
        
        const cache = this.pageCache[page];
        if (!cache) return true;
        
        // 未加载过或缓存已过期
        const now = Date.now();
        if (!cache.loaded || (now - cache.timestamp) > this.cacheTTL) {
            return true;
        }
        
        return false;
    }
    
    /**
     * 标记页面已加载
     * @param {PageType} page
     */
    markPageLoaded(page) {
        if (this.pageCache[page]) {
            this.pageCache[page].loaded = true;
            this.pageCache[page].timestamp = Date.now();
        }
    }
    
    /**
     * 清除页面缓存
     * @param {PageType} page - 指定页面，不指定则清除全部
     */
    clearPageCache(page) {
        if (page) {
            if (this.pageCache[page]) {
                this.pageCache[page].loaded = false;
                this.pageCache[page].timestamp = 0;
            }
        } else {
            // 清除全部
            for (const key of Object.keys(this.pageCache)) {
                this.pageCache[key].loaded = false;
                this.pageCache[key].timestamp = 0;
            }
        }
    }
    
    /**
     * 加载页面数据
     * @param {PageType} page
     * @param {boolean} forceRefresh - 是否强制刷新
     */
    async loadPageData(page, forceRefresh = false) {
        try {
            // 检查是否需要加载（强制刷新或缓存过期）
            if (!forceRefresh && !this.shouldLoadPageData(page)) {
                console.log(`页面 ${page} 数据仍在缓存中，跳过加载`);
                return;
            }
            
            switch (page) {
                case 'home':
                    await this.loadHomePage();
                    this.markPageLoaded('home');
                    break;
                case 'search':
                    if (this.searchQuery) {
                        await this.loadSearchResults();
                        this.markPageLoaded('search');
                    }
                    break;
                case 'downloads':
                    await this.loadDownloads();
                    // 下载页面不标记缓存，每次都要刷新
                    break;
                case 'sources':
                    await this.loadSources();
                    this.markPageLoaded('sources');
                    break;
            }
        } catch (error) {
            console.error(`加载${page}页面数据失败:`, error);
            this.notifications.error(`加载页面数据失败: ${error.message}`);
        }
    }
    
    /**
     * 加载活动视频源
     */
    async loadActiveSource() {
        try {
            const activeSource = await this.api.getActiveSource();
            this.currentSource = activeSource;
            this.updateCurrentSourceDisplay();
        } catch (error) {
            console.log('No active source set');
            this.currentSource = null;
            this.updateCurrentSourceDisplay();
        }
    }
    
    /**
     * 更新当前视频源显示
     */
    updateCurrentSourceDisplay() {
        const currentSourceEl = DOMHelper.$('#currentSource');
        const activeSourceNameEl = DOMHelper.$('#activeSourceName');
        
        const sourceName = this.currentSource ? this.currentSource.name : '未选择视频源';
        
        if (currentSourceEl) {
            currentSourceEl.textContent = sourceName;
        }
        
        if (activeSourceNameEl) {
            activeSourceNameEl.textContent = this.currentSource ? this.currentSource.name : '无';
        }
    }
    
    /**
     * 带加载状态的异步操作包装器
     * @param {Function} asyncFn - 异步操作函数
     * @param {string} [errorMsg] - 错误消息
     * @param {boolean} [showLoadingState=true] - 是否显示加载状态
     * @returns {Promise<any>} 操作结果
     */
    async withLoading(asyncFn, errorMsg, showLoadingState = true) {
        if (showLoadingState) this.showLoading();
        try {
            return await asyncFn();
        } catch (error) {
            if (errorMsg) this.notifications.error(errorMsg);
            console.error(errorMsg || '操作失败:', error);
            throw error;
        } finally {
            if (showLoadingState) this.hideLoading();
        }
    }

    /**
     * 加载视频源列表
     */
    async loadSources() {
        await this.withLoading(async () => {
            const data = await this.api.getSources();
            this.renderSources(data || []);
        }, '加载视频源失败');
    }
    
    /**
     * 渲染视频源列表
     * @param {VideoSource[]} sources
     */
    renderSources(sources) {
        const sourcesList = DOMHelper.$('#sourcesList');
        if (!sourcesList) return;
        
        sourcesList.innerHTML = '';
        
        if (sources.length === 0) {
            sourcesList.innerHTML = '<div class="text-center">暂无视频源</div>';
            return;
        }
        
        sources.forEach(source => {
            const isActive = this.currentSource && this.currentSource.id === source.id;
            const sourceItem = DOMHelper.create('div', 
                `source-item ${isActive ? 'active' : ''}`,
                `
                <div class="source-name">${source.name}</div>
                <div class="source-url">${source.baseUrl}</div>
                <div class="source-actions">
                    <button class="btn ${isActive ? 'btn-success' : 'btn-primary'} btn-small" 
                            data-source-id="${source.id}"
                            ${isActive ? 'disabled' : ''}>
                        ${isActive ? '当前源' : '选择'}
                    </button>
                </div>
                `
            );
            
            // 绑定整个卡片点击事件
            if (!isActive) {
                DOMHelper.on(sourceItem, 'click', (e) => {
                    // 防止按钮点击事件冒泡
                    if (e.target.tagName !== 'BUTTON') {
                        this.setActiveSource(source.id);
                    }
                });
                
                // 添加鼠标悬停效果
                sourceItem.style.cursor = 'pointer';
                sourceItem.title = '点击切换视频源';
            }
            
            // 绑定选择按钮事件
            const selectBtn = sourceItem.querySelector('button');
            if (selectBtn && !selectBtn.disabled) {
                DOMHelper.on(selectBtn, 'click', () => {
                    this.setActiveSource(source.id);
                });
            }
            
            sourcesList.appendChild(sourceItem);
        });
    }
    
    /**
     * 设置活动视频源
     * @param {string} source
     */
    async setActiveSource(source) {
        try {
            this.showLoading();
            await this.api.setActiveSource(source);
            this.notifications.success('视频源切换成功');
            
            await this.loadActiveSource();
            await this.loadSources();
            
            // 切换视频源后清除首页和搜索缓存
            this.clearPageCache('home');
            this.clearPageCache('search');
            
            // 重新加载当前页面数据并刷新页面
            await this.reloadCurrentPage();
            
            // 更新URL哈希
            this.saveToHash();
            
            // 如果是搜索页面，重新执行搜索
            if (this.currentPage === 'search' && this.searchQuery) {
                await this.performSearch();
            }
        } catch (error) {
            this.notifications.error('切换视频源失败');
            console.error('Set active source error:', error);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 加载首页视频
     * @param {number} page
     */
    async loadHomePage(page = 1) {
        if (!this.currentSource) {
            const homeVideoGrid = DOMHelper.$('#homeVideoGrid');
            if (homeVideoGrid) {
                homeVideoGrid.innerHTML = '<div class="text-center">请先选择视频源</div>';
            }
            return;
        }
        
        try {
            this.showLoading();
            
            // 首先渲染最近观看（第一页时）
            if (page === 1) {
                this.renderRecentWatch();
            }
            
            const data = await this.api.getHomeVideos(page);
            this.renderVideoGrid(data.videos || [], 'homeVideoGrid');
            this.renderPagination(data, 'home', 'homePagination');
            this.pagination.home = { 
                current: data.currentPage || 1, 
                total: data.totalPages || 1 
            };
        } catch (error) {
            this.notifications.error('加载首页视频失败');
            const homeVideoGrid = DOMHelper.$('#homeVideoGrid');
            if (homeVideoGrid) {
                homeVideoGrid.innerHTML = '<div class="text-center">加载失败，请检查网络连接</div>';
            }
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 渲染最近观看区域
     */
    renderRecentWatch() {
        const container = DOMHelper.$('#recentWatch');
        if (!container) return;
        
        // 清空容器
        container.innerHTML = '';
        
        // 获取最近观看记录
        const recent = this.playerManager.progress.getRecentWatch()
            .filter(e => e.source == this.currentSource.id)
            .slice(0, 4);
        if (recent.length === 0) return;
        
        // 创建最近观看区域
        const recentSection = DOMHelper.create('div', 'recent-watch-section');
        recentSection.innerHTML = `
            <div class="section-header">
                <h3><i class="fas fa-history"></i> 最近观看</h3>
                <button class="btn btn-large" id="clearRecentWatch">清除记录</button>
            </div>
            <div class="recent-watch-grid" id="recentWatchGrid"></div>
        `;
        
        const grid = recentSection.querySelector('#recentWatchGrid');
        
        recent.forEach(item => {
            const card = DOMHelper.create('div', 'video-card recent-watch-card');
            const progressPercent = item.duration > 0 
                ? Math.min(100, Math.round((item.progress / item.duration) * 100)) 
                : 0;
            
            card.innerHTML = `
                <div class="video-thumbnail">
                    <img src="${item.thumbnail || Utils.getDefaultThumbnail()}" 
                         alt="${item.title}" 
                         loading="lazy"
                         onerror="this.src='${Utils.getDefaultThumbnail()}'">
                    <div class="video-duration">${Utils.formatDuration(item.progress)} / ${Utils.formatDuration(item.duration)}</div>
                    <div class="watch-progress-bar" style="width: ${progressPercent}%"></div>
                    <div class="video-actions-overlay">
                        <button class="btn btn-large btn-primary video-resume-btn" title="继续观看">
                            <i class="fas fa-play"></i>
                        </button>
                    </div>
                    ${item.seriesId ? '<div class="series-badge">系列</div>' : ''}
                </div>
                <div class="video-info">
                    <div class="video-title" title="${item.seriesTitle || item.title}">${item.seriesTitle || item.title}</div>
                    <div class="video-meta">
                        ${item.episodeNumber ? `第${item.episodeNumber}集 · ` : ''}${item.source}
                    </div>
                    <div class="watch-time">${Utils.formatTimeAgo(item.lastWatch)}</div>
                </div>
            `;
            
            // 绑定继续播放事件
            const resumeBtn = card.querySelector('.video-resume-btn');
            if (resumeBtn) {
                DOMHelper.on(resumeBtn, 'click', (e) => {
                    e.stopPropagation();
                    this.resumeWatch(item);
                });
            }
            
            // 点击卡片也可以继续播放
            DOMHelper.on(card, 'click', () => {
                this.resumeWatch(item);
            });
            
            grid.appendChild(card);
        });
        
        // 绑定清除记录按钮
        const clearBtn = recentSection.querySelector('#clearRecentWatch');
        if (clearBtn) {
            DOMHelper.on(clearBtn, 'click', () => {
                if (confirm('确定要清除所有观看记录吗？')) {
                    this.playerManager.progress.clearAllProgress();
                    this.renderRecentWatch();
                }
            });
        }
        
        container.appendChild(recentSection);
    }
    
    /**
     * 继续观看
     * @param {Object} watchRecord - 观看记录
     */
    async resumeWatch(watchRecord) {
        try {
            this.showLoading();
            
            // 构造视频数据
            const videoData = {
                id: watchRecord.id,
                title: watchRecord.episodeTitle || watchRecord.title,
                thumbnail: watchRecord.thumbnail,
                url: '', // 需要通过API重新获取
                source: watchRecord.source
            };
            
            if (watchRecord.seriesId) {
                // 系列视频：打开系列详情页
                // 由于可能没有完整URL，需要通知用户
                this.notifications.info('正在加载系列详情...');
                // 这里简化处理，实际可能需要根据系列ID重新获取数据
                const seriesVideo = {
                    id: watchRecord.seriesId,
                    title: watchRecord.seriesTitle,
                    thumbnail: watchRecord.thumbnail,
                    url: '',
                    source: watchRecord.source,
                    contentType: 'series'
                };
                await this.showSeriesModal(seriesVideo);
            } else {
                // 单视频：直接播放
                // 由于URL可能过期，需要重新解析
                this.notifications.info('正在重新解析视频链接...');
                // 简化处理：通知用户从列表中选择
                this.notifications.warning('请从列表中重新选择该视频');
            }
        } catch (error) {
            console.error('继续观看失败:', error);
            this.notifications.error('继续观看失败，请从列表中重新选择');
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 执行搜索
     */
    async performSearch() {
        const searchInput = DOMHelper.$('#searchInput');
        if (!searchInput) return;

        const query = searchInput.value.trim();

        if (!query) {
            this.notifications.warning('请输入搜索关键词');
            return;
        }

        if (!this.currentSource) {
            this.notifications.warning('请先选择视频源');
            return;
        }

        this.searchQuery = query;
        // 新搜索清除缓存
        this.clearPageCache('search');
        this.saveToHash(); // 保存搜索状态到哈希
        this.switchPage('search');
        // switchPage中的loadPageData会自动调用loadSearchResults，不需要重复调用
    }
    
    /**
     * 加载搜索结果
     * @param {number} page
     */
    async loadSearchResults(page = 1) {
        if (!this.searchQuery || !this.currentSource) return;
        
        try {
            this.showLoading();
            const data = await this.api.searchVideos(this.searchQuery, page);
            this.renderVideoGrid(data.videos || [], 'searchVideoGrid');
            this.renderPagination(data, 'search', 'searchPagination');
            this.pagination.search = { 
                current: data.currentPage || 1, 
                total: data.totalPages || 1 
            };
        } catch (error) {
            this.notifications.error('搜索失败');
            const searchVideoGrid = DOMHelper.$('#searchVideoGrid');
            if (searchVideoGrid) {
                searchVideoGrid.innerHTML = '<div class="text-center">搜索失败，请重试</div>';
            }
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 渲染视频网格
     * @param {VideoItem[]} videos
     * @param {string} containerId
     */
    renderVideoGrid(videos, containerId) {
        const container = DOMHelper.$(`#${containerId}`);
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!videos || videos.length === 0) {
            container.innerHTML += '<div class="text-center">暂无视频</div>';
            return;
        }
        
        videos.forEach(video => {
            const videoCard = this.createVideoCard(video);
            container.appendChild(videoCard);
        });
    }
    
    /**
     * 创建视频卡片
     * @param {VideoItem} video
     * @returns {HTMLElement}
     */
    createVideoCard(video) {
        const card = DOMHelper.create('div', 'video-card');
        const isSeries = video.contentType === 'series';
        const isInfinite = video.contentType === 'infinite';

        // 处理缩略图
        const thumbnailUrl = video.thumbnail ?
            this.api.getImageProxyUrl(video.thumbnail, video.source) :
            Utils.getDefaultThumbnail();

        // 检查播放进度
        let progressBadge = '';
        if (isSeries && video.seriesInfo?.currentEpisode) {
            progressBadge = `<div class="series-progress">看到第${video.seriesInfo.currentEpisode}集</div>`;
        }

        // 徽章
        let badgeHtml = '';
        if (isInfinite) {
            badgeHtml = '<div class="series-badge infinite-badge">无限</div>';
        } else if (isSeries) {
            badgeHtml = '<div class="series-badge">系列</div>';
        }

        card.innerHTML = `
            <div class="video-thumbnail">
                <img src="${thumbnailUrl}"
                     alt="${video.title}"
                     loading="lazy"
                     onerror="this.src='${Utils.getDefaultThumbnail()}'">
                <div class="video-duration">${video.duration || '未知'}</div>
                ${badgeHtml}
                ${progressBadge}
                <div class="video-actions-overlay">
                    <button class="btn btn-large btn-primary video-preview-btn" title="${isInfinite ? '无限播放' : isSeries ? '选集播放' : '预览'}">
                        <i class="fas ${isInfinite ? 'fa-infinity' : isSeries ? 'fa-list' : 'fa-play'}"></i>
                    </button>
                    ${!isSeries && !isInfinite ? `
                    <button class="btn btn-large btn-success video-download-btn" title="直接下载">
                        <i class="fas fa-download"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-meta">
                    ${isSeries ? `系列 · ${video.seriesInfo?.totalEpisodes || '?'}集` : `来源: ${video.source}`}
                </div>
            </div>
        `;
        
        // 绑定预览按钮点击事件
        const previewBtn = card.querySelector('.video-preview-btn');
        if (previewBtn) {
            DOMHelper.on(previewBtn, 'click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isSeries) {
                    this.showSeriesModal(video);
                } else {
                    this.showVideoModal(video);
                }
            });
        }
        
        // 绑定下载按钮点击事件（仅视频）
        if (!isSeries) {
            const downloadBtn = card.querySelector('.video-download-btn');
            if (downloadBtn) {
                DOMHelper.on(downloadBtn, 'click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.directDownload(video);
                });
            }
        }
        
        // 绑定卡片点击事件 - 只对非按钮区域生效
        DOMHelper.on(card, 'click', (e) => {
            // 如果点击的是按钮或按钮内的元素，不处理
            if (e.target.closest('.video-actions-overlay button') ||
                e.target.closest('.video-preview-btn') ||
                e.target.closest('.video-download-btn')) {
                return;
            }
            if (isInfinite) {
                this.startInfiniteMode(video);
            } else if (isSeries) {
                this.showSeriesModal(video);
            } else {
                this.showVideoModal(video);
            }
        });

        return card;
    }

    /**
     * 开始无限播放模式
     * @param {VideoItem} infiniteVideo
     */
    async startInfiniteMode(infiniteVideo) {
        this.isInfiniteMode = true;
        this.infiniteVideo = infiniteVideo;
        this.infiniteQueue = [];
        this.infiniteIndex = 0;

        // 加载第一批视频
        await this.loadInfiniteBatch();

        // 开始播放第一个
        if (this.infiniteQueue.length > 0) {
            this.playInfiniteVideo(0);
        }
    }

    /**
     * 加载无限模式的视频批次
     */
    async loadInfiniteBatch() {
        try {
            this.showLoading();
            const result = await this.api.getSeries(this.infiniteVideo.id);
            if (result && result.episodes && result.episodes.length > 0) {
                // episodes 中的 url 是视频链接
                this.infiniteQueue = result.episodes;
                this.infiniteIndex = 0;
            }
        } catch (error) {
            console.error('加载无限视频批次失败:', error);
            this.notifications.error('加载视频失败');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 播放无限模式中的视频
     * @param {number} index
     */
    async playInfiniteVideo(index) {
        // 处理边界情况
        if (index < 0) return;
        if (index >= this.infiniteQueue.length) {
            await this.loadInfiniteBatch();
            if (this.infiniteQueue.length > 0) {
                index = 0;
            } else {
                this.notifications.info('没有更多视频了');
                return;
            }
        }

        this.infiniteIndex = index;
        const episode = this.infiniteQueue[index];
        const titleParts = episode.title ? episode.title.split('/') : [];
        const videoTitle = titleParts[0] || episode.title || `第${index + 1}个`;
        const authorName = titleParts[1] || '';
        const displayTitle = authorName ? `${videoTitle} - ${authorName}` : videoTitle;

        const success = await this.initVideoPlayback({
            title: displayTitle,
            url: episode.url,
            source: this.infiniteVideo.source,
            thumbnail: episode.thumbnail || this.infiniteVideo.thumbnail,
            parseVideoFn: async () => {
                const parseResult = await this.api.parseVideo(episode.url, this.infiniteVideo.source);
                return parseResult.results || [];
            },
            renderControlsFn: () => `
                <div class="infinite-controls">
                    <span class="infinite-progress"><i class="fas fa-infinity"></i> ${index + 1} / ${this.infiniteQueue.length}</span>
                    <button class="btn btn-secondary btn-lg" id="infinitePrev" ${index === 0 ? 'disabled' : ''}>
                        <i class="fas fa-step-backward"></i> 上一个
                    </button>
                    <button class="btn btn-secondary btn-lg" id="infiniteNext">
                        下一个 <i class="fas fa-step-forward"></i>
                    </button>
                    <button class="btn btn-primary btn-lg" id="infiniteDownload">
                        <i class="fas fa-download"></i> 下载
                    </button>
                </div>
            `,
            playerOptions: {
                isInfinite: true,
                onEnded: () => this.handleInfiniteEnded(),
                onPrev: () => this.playInfiniteVideo(index - 1),
                onNext: () => this.playInfiniteVideo(index + 1)
            },
            loadingText: '正在加载...'
        });

        if (success) {
            const prevBtn = DOMHelper.$('#infinitePrev');
            const nextBtn = DOMHelper.$('#infiniteNext');
            const downloadBtn = DOMHelper.$('#infiniteDownload');
            if (prevBtn) DOMHelper.on(prevBtn, 'click', () => this.playInfiniteVideo(index - 1));
            if (nextBtn) DOMHelper.on(nextBtn, 'click', () => this.playInfiniteVideo(index + 1));
            if (downloadBtn) {
                DOMHelper.on(downloadBtn, 'click', () => {
                    const selectedQuality = this.getSelectedQuality();
                    if (selectedQuality) {
                        this.downloadVideo(displayTitle, selectedQuality.url);
                    } else {
                        this.notifications.warning('请选择视频质量');
                    }
                });
            }
        }
    }

    /**
     * 处理无限模式视频播放结束
     */
    async handleInfiniteEnded() {
        if (!this.isInfiniteMode) return;

        // 还有下一个
        if (this.infiniteIndex < this.infiniteQueue.length - 1) {
            this.playInfiniteVideo(this.infiniteIndex + 1);
        } else {
            // 当前批次播完，加载新批次
            await this.loadInfiniteBatch();
            if (this.infiniteQueue.length > 0) {
                this.playInfiniteVideo(0);
            } else {
                this.notifications.info('没有更多视频了');
            }
        }
    }

    /**
     * 显示系列详情模态框（选集）
     * @param {VideoItem} seriesVideo
     */
    async showSeriesModal(seriesVideo) {
        const modal = DOMHelper.$('#videoModal');
        const modalTitle = DOMHelper.$('#modalTitle');
        const videoPlayer = DOMHelper.$('#videoPlayer');
        const videoDetailInfo = DOMHelper.$('#videoDetailInfo');
        const qualitySelection = DOMHelper.$('#qualitySelection');
        
        if (!modal || !modalTitle || !videoPlayer || !videoDetailInfo) return;
        
        // 清理播放器状态，确保显示选集页面而不是直接播放
        this.playerManager.destroy();
        this.currentSeriesVideo = seriesVideo;
        this.currentEpisodes = [];
        
        modalTitle.textContent = seriesVideo.title;
        videoPlayer.innerHTML = '<div class="loading-placeholder"><i class="fas fa-spinner fa-spin"></i><span>加载系列信息...</span></div>';
        videoDetailInfo.innerHTML = '';
        qualitySelection.innerHTML = '';
        
        DOMHelper.show(modal);
        
        try {
            this.showLoading();
            const detail = await this.api.getSeriesDetail(seriesVideo.id, seriesVideo.url);
            
            if (!detail || !detail.episodes || detail.episodes.length === 0) {
                videoPlayer.innerHTML = '<div class="loading-placeholder"><i class="fas fa-exclamation-circle"></i><span>暂无剧集信息</span></div>';
                return;
            }
            
            // 保存当前系列和剧集列表
            this.currentSeriesVideo = seriesVideo;
            this.currentEpisodes = detail.episodes;
            
            // 渲染系列信息（左侧）
            const thumbnailUrl = seriesVideo.thumbnail ? 
                this.api.getImageProxyUrl(seriesVideo.thumbnail, seriesVideo.source) : 
                Utils.getDefaultThumbnail();
            
            videoDetailInfo.innerHTML = `
                <div class="series-detail-card">
                    <div class="series-poster">
                        <img src="${thumbnailUrl}" alt="${detail.title}" onerror="this.src='${Utils.getDefaultThumbnail()}'">
                    </div>
                    <div class="series-info-content">
                        <h3 class="series-title">${detail.title}</h3>
                        ${detail.originalTitle ? `<p class="series-original-title">${detail.originalTitle}</p>` : ''}
                        <div class="series-meta-tags">
                            ${detail.type ? `<span class="meta-tag type-tag"><i class="fas fa-film"></i> ${Utils.getTypeText(detail.type)}</span>` : ''}
                            ${detail.status ? `<span class="meta-tag status-tag ${detail.status}"><i class="fas fa-circle"></i> ${Utils.getStatusText(detail.status)}</span>` : ''}
                            ${detail.year ? `<span class="meta-tag"><i class="fas fa-calendar"></i> ${detail.year}</span>` : ''}
                            ${detail.rating ? `<span class="meta-tag rating-tag"><i class="fas fa-star"></i> ${detail.rating}</span>` : ''}
                        </div>
                        <div class="series-stats">
                            <span><i class="fas fa-list-ol"></i> 共 ${detail.totalEpisodes} 集</span>
                            ${detail.views ? `<span><i class="fas fa-eye"></i> ${Utils.formatViews(detail.views)}</span>` : ''}
                        </div>
                        ${detail.tags && detail.tags.length > 0 ? `
                        <div class="series-tags">
                            ${detail.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                        </div>
                        ` : ''}
                        ${detail.description ? `
                        <div class="series-description">
                            <p>${detail.description}</p>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
            
            // 渲染剧集列表（右侧播放器区域）
            videoPlayer.innerHTML = `
                <div class="episodes-container">
                    <div class="episodes-header">
                        <h4><i class="fas fa-play-circle"></i> 选集播放</h4>
                        <div class="episodes-actions">
                            <button class="btn btn-small btn-secondary" id="selectAllEpisodes">
                                <i class="fas fa-check-square"></i> 全选
                            </button>
                            <button class="btn btn-small btn-secondary" id="invertSelectEpisodes">
                                <i class="fas fa-random"></i> 反选
                            </button>
                            <button class="btn btn-small btn-primary" id="downloadSelectedEpisodes">
                                <i class="fas fa-download"></i> 下载选中
                            </button>
                            <button class="btn btn-small btn-primary" id="artFullScreen">
                                <i class="fas fa-fullscreen"></i> 全屏
                            </button>
                            <div class="episodes-count">共 ${detail.episodes.length} 集</div>
                        </div>
                    </div>
                    <div class="episodes-grid" id="episodesGrid"></div>
                </div>
            `;
            
            // 计算默认选中的剧集（满足 episodeNumber 最大范围且靠前）
            const selectedEpisodes = this.calculateDefaultSelection(detail.episodes);
            
            const episodesGrid = videoPlayer.querySelector('#episodesGrid');
            if (episodesGrid) {
                detail.episodes.forEach((ep, index) => {
                    // 获取该集的播放进度
                    const savedPosition = this.playerManager.progress.getEpisodePosition(ep.id);
                    const hasProgress = savedPosition > 10; // 超过10秒算有进度
                    const isSelected = selectedEpisodes.has(ep.id);
                    
                    const epBtn = DOMHelper.create('div', `episode-card ${hasProgress ? 'has-progress' : ''} ${isSelected ? 'selected' : ''}`, `
                        <div class="episode-checkbox">
                            <input type="checkbox" class="ep-checkbox" data-ep-id="${ep.id}" ${isSelected ? 'checked' : ''}>
                        </div>
                        <div class="episode-number-badge">${ep.episodeNumber || index + 1}</div>
                        <div class="episode-info">
                            <div class="episode-name">${ep.title || `第${ep.episodeNumber || index + 1}集`}</div>
                            ${ep.duration ? `<div class="episode-duration"><i class="fas fa-clock"></i> ${ep.duration}</div>` : ''}
                        </div>
                        <div class="episode-play-icon"><i class="fas fa-play"></i></div>
                        ${hasProgress ? `<div class="episode-progress-indicator" style="width: ${Math.min((savedPosition / 1440) * 100, 100)}%"></div>` : ''}
                    `);
                    
                    // 复选框点击事件 - 阻止冒泡
                    const checkbox = epBtn.querySelector('.ep-checkbox');
                    if (checkbox) {
                        DOMHelper.on(checkbox, 'click', (e) => {
                            e.stopPropagation();
                            epBtn.classList.toggle('selected', checkbox.checked);
                        });
                    }
                    
                    // 点击卡片播放
                    DOMHelper.on(epBtn, 'click', (e) => {
                        // 如果点击的是复选框，不播放
                        if (e.target.classList.contains('ep-checkbox')) {
                            return;
                        }
                        // 关闭系列选择，打开播放器
                        this.playEpisode(seriesVideo, ep, savedPosition);
                    });
                    
                    episodesGrid.appendChild(epBtn);
                });
            }
            
            // 绑定全选按钮
            const selectAllBtn = videoPlayer.querySelector('#selectAllEpisodes');
            if (selectAllBtn) {
                DOMHelper.on(selectAllBtn, 'click', () => this.toggleSelectAll(selectAllBtn));
            }
            
            // 绑定反选按钮
            const invertSelectBtn = videoPlayer.querySelector('#invertSelectEpisodes');
            if (invertSelectBtn) {
                DOMHelper.on(invertSelectBtn, 'click', () => this.invertEpisodeSelection());
            }
            
            // 绑定下载按钮
            const downloadBtn = videoPlayer.querySelector('#downloadSelectedEpisodes');
            if (downloadBtn) {
                DOMHelper.on(downloadBtn, 'click', () => this.downloadSelectedEpisodes(seriesVideo));
            }

            // 绑定全屏
            const fullscreenBtn = videoPlayer.querySelector('#artFullScreen');
            if (fullscreenBtn) {
                DOMHelper.on(fullscreenBtn, 'click', () => this.playerManager.player.fullscreen = true);
            }
        } catch (error) {
            console.error('加载系列详情失败:', error);
            videoPlayer.innerHTML = '<div class="loading-placeholder error"><i class="fas fa-times-circle"></i><span>加载失败，请重试</span></div>';
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 计算默认选中的剧集
     * 规则：凑够 episodeNumber 最大范围，每个位置选第一个出现的（靠前的）
     * 例如：a1,a2,a3,b1,b2,b3,b4,c1,c2,c3,c4,c5 -> 选中 a1,a2,a3,b4,c5 (凑够1-5集)
     * @param {Array} episodes - 剧集列表（按顺序排列）
     * @returns {Set} 选中的剧集ID集合
     */
    calculateDefaultSelection(episodes) {
        if (!episodes || episodes.length === 0) return new Set();
        
        // 按 episodeNumber 分组（相同 episodeNumber 的归为一组）
        const numGroups = new Map();
        
        episodes.forEach(ep => {
            const epNum = parseInt(ep.episodeNumber) || 0;
            if (!numGroups.has(epNum)) {
                numGroups.set(epNum, []);
            }
            numGroups.get(epNum).push(ep);
        });
        
        // 找出最大的 episodeNumber
        let maxEpNum = 0;
        for (const num of numGroups.keys()) {
            if (num > maxEpNum) {
                maxEpNum = num;
            }
        }
        
        // 选择每个 episodeNumber 的第一个（最靠前的）
        const selectedIds = new Set();
        for (let i = 1; i <= maxEpNum; i++) {
            const eps = numGroups.get(i);
            if (eps && eps.length > 0) {
                // 选择该 episodeNumber 的第一个（最靠前的）
                selectedIds.add(eps[0].id);
            }
        }
        
        return selectedIds;
    }
    
    /**
     * 切换全选/取消全选
     * @param {HTMLElement} btn - 按钮元素
     */
    toggleSelectAll(btn) {
        const checkboxes = DOMHelper.$$('.ep-checkbox');
        const episodeCards = DOMHelper.$$('.episode-card');
        
        // 检查是否所有都已选中
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        const newState = !allChecked;
        
        checkboxes.forEach((checkbox, index) => {
            checkbox.checked = newState;
            if (episodeCards[index]) {
                episodeCards[index].classList.toggle('selected', newState);
            }
        });
        
        // 更新按钮文字
        btn.innerHTML = newState ? 
            '<i class="fas fa-square"></i> 取消全选' : 
            '<i class="fas fa-check-square"></i> 全选';
    }
    
    /**
     * 反选剧集
     */
    invertEpisodeSelection() {
        const checkboxes = DOMHelper.$$('.ep-checkbox');
        const episodeCards = DOMHelper.$$('.episode-card');
        
        checkboxes.forEach((checkbox, index) => {
            checkbox.checked = !checkbox.checked;
            if (episodeCards[index]) {
                episodeCards[index].classList.toggle('selected', checkbox.checked);
            }
        });
    }
    
    /**
     * 下载选中的剧集
     * @param {VideoItem} seriesVideo - 系列视频信息
     */
    async downloadSelectedEpisodes(seriesVideo) {
        const checkboxes = DOMHelper.$$('.ep-checkbox:checked');
        
        if (checkboxes.length === 0) {
            this.notifications.warning('请先选择要下载的剧集');
            return;
        }
        
        // 获取选中的剧集
        const selectedEpIds = Array.from(checkboxes).map(cb => cb.dataset.epId);
        const selectedEpisodes = this.currentEpisodes.filter(ep => selectedEpIds.includes(ep.id));
        
        this.showLoading();
        this.notifications.info(`开始下载 ${selectedEpisodes.length} 个剧集...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const episode of selectedEpisodes) {
            try {
                // 解析视频链接
                const parseResult = await this.api.parseVideo(episode.url, seriesVideo.source);
                const results = parseResult.results || [];
                
                if (results && results.length > 0) {
                    // 选择最高质量
                    const highestQuality = results.reduce((prev, current) => {
                        const prevBandwidth = prev.bandwidth || 0;
                        const currentBandwidth = current.bandwidth || 0;
                        return currentBandwidth > prevBandwidth ? current : prev;
                    });
                    
                    // 创建下载任务
                    const downloadTitle = `${seriesVideo.title} - ${episode.title || episode.episodeNumber}`;
                    await this.createSeriesDownload(downloadTitle, highestQuality.url, episode.url);
                    successCount++;
                } else {
                    failCount++;
                    console.error(`无法获取剧集下载链接: ${episode.title}`);
                }
            } catch (error) {
                failCount++;
                console.error(`下载剧集失败: ${episode.title}`, error);
            }
        }
        
        this.hideLoading();
        
        if (successCount > 0) {
            this.notifications.success(`成功添加 ${successCount} 个下载任务`);
        }
        if (failCount > 0) {
            this.notifications.error(`${failCount} 个剧集添加失败`);
        }
    }
    
    /**
     * 创建系列视频下载任务
     */
    async createSeriesDownload(title, m3u8Url, referer) {
        const result = await this.createDownload(title, m3u8Url, referer);
        if (result.task) {
            await this.api.startDownload(result.task.id);
        }
        return result;
    }
    

    
    /**
     * 通用的视频播放初始化
     * @param {Object} params - 播放参数
     * @param {string} params.title - 视频标题
     * @param {string} params.url - 视频URL
     * @param {string} params.source - 视频源
     * @param {string} [params.thumbnail] - 缩略图
     * @param {Function} params.parseVideoFn - 解析视频的异步函数
     * @param {Function} params.renderControlsFn - 渲染控制按钮的函数
     * @param {Object} [params.playerOptions] - 播放器选项
     * @param {string} [params.loadingText='正在加载...'] - 加载提示文字
     * @returns {Promise<boolean>} - 是否成功播放
     */
    async initVideoPlayback(params) {
        const { title, url, source, thumbnail, parseVideoFn, renderControlsFn, playerOptions = {}, loadingText = '正在加载...' } = params;
        
        const modal = DOMHelper.$('#videoModal');
        const modalTitle = DOMHelper.$('#modalTitle');
        const videoPlayer = DOMHelper.$('#videoPlayer');
        const videoDetailInfo = DOMHelper.$('#videoDetailInfo');
        const qualitySelection = DOMHelper.$('#qualitySelection');
        
        if (!modal || !videoPlayer) return false;
        
        modalTitle.textContent = title;
        videoPlayer.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">${loadingText}</div>`;
        videoDetailInfo.innerHTML = '';
        qualitySelection.innerHTML = '';
        
        DOMHelper.show(modal);
        
        try {
            this.showLoading();
            const results = await parseVideoFn();
            
            if (results && results.length > 0) {
                videoPlayer.innerHTML = '';
                
                await this.playerManager.initPlayer(videoPlayer, {
                    title,
                    url,
                    source,
                    thumbnail: thumbnail || ''
                }, playerOptions);
                
                this.playerManager.setQualities(results);
                this.renderQualitySelection(results);
                
                if (renderControlsFn) {
                    videoDetailInfo.innerHTML = renderControlsFn();
                }
                
                return true;
            } else {
                videoPlayer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">无法获取播放链接</div>';
                return false;
            }
        } catch (error) {
            console.error('视频播放初始化失败:', error);
            videoPlayer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">加载失败</div>';
            return false;
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 播放剧集
     * @param {VideoItem} seriesVideo - 系列视频信息
     * @param {Object} episode - 剧集信息 {id, title, url, episodeNumber, ...}
     * @param {number} [startTime=0] - 开始播放时间（秒）
     * @returns {Promise<void>}
     */
    async playEpisode(seriesVideo, episode, startTime = 0) {
        if (!seriesVideo || !episode) {
            console.error('playEpisode: 缺少必要参数');
            return;
        }
        
        this.currentSeriesVideo = seriesVideo;
        this.currentSeriesId = seriesVideo.id;
        this.currentEpisodeId = episode.id;
        
        const success = await this.initVideoPlayback({
            title: `${seriesVideo.title} - ${episode.title}`,
            url: episode.url,
            source: seriesVideo.source,
            thumbnail: seriesVideo.thumbnail,
            parseVideoFn: async () => {
                const parseResult = await this.api.parseVideo(episode.url, seriesVideo.source);
                return parseResult.results || [];
            },
            renderControlsFn: () => `
                <button class="btn btn-secondary" id="backToEpisodesBtn">
                    <i class="fas fa-list"></i> 返回选集
                </button>
            `,
            playerOptions: {
                seriesId: seriesVideo.id,
                episodeId: episode.id,
                startTime: startTime,
                episodes: this.currentEpisodes,
                onClose: () => this.backToEpisodes(),
                onEpisodeChange: (ep, index) => this.handleEpisodeChange(ep, index)
            },
            loadingText: '正在加载播放链接...'
        });
        
        if (success) {
            const backBtn = DOMHelper.$('#backToEpisodesBtn');
            if (backBtn) {
                DOMHelper.on(backBtn, 'click', () => this.backToEpisodes());
            }
        }
    }
    
    /**
     * 显示视频详情模态框
     * @param {VideoItem} video
     */
    async showVideoModal(video) {
        const downloadBtn = DOMHelper.$('#downloadVideoBtn');
        
        // 清理系列视频状态
        this.playerManager.destroy();
        this.currentSeriesVideo = null;
        this.currentEpisodes = [];
        
        const success = await this.initVideoPlayback({
            title: video.title,
            url: video.url,
            source: video.source,
            thumbnail: video.thumbnail,
            parseVideoFn: async () => {
                const parseResult = await this.api.parseVideo(video.url, video.source);
                return parseResult.results || [];
            },
            renderControlsFn: () => `
                <div class="video-info-item">
                    <span class="video-info-label">标题:</span>
                    <span class="video-info-value">${video.title}</span>
                </div>
                <div class="video-info-item">
                    <span class="video-info-label">时长:</span>
                    <span class="video-info-value">${video.duration || '未知'}</span>
                </div>
                <div class="video-info-item">
                    <span class="video-info-label">来源:</span>
                    <span class="video-info-value">${video.source}</span>
                </div>
                <div class="video-info-item">
                    <span class="video-info-label">链接:</span>
                    <span class="video-info-value" style="word-break: break-all;">${video.url}</span>
                </div>
            `,
            loadingText: '正在解析视频...'
        });
        
        if (success && downloadBtn) {
            const newDownloadBtn = downloadBtn.cloneNode(true);
            downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
            
            DOMHelper.on(newDownloadBtn, 'click', () => {
                const selectedQuality = this.getSelectedQuality();
                if (selectedQuality) {
                    this.downloadVideo(video.title, selectedQuality.url);
                } else {
                    this.notifications.warning('请选择视频质量');
                }
            });
        }
    }
    
    /**
     * 渲染画质选择
     * @param {M3U8Result[]} qualities
     */
    renderQualitySelection(qualities) {
        const qualitySelection = DOMHelper.$('#qualitySelection');
        if (!qualitySelection) return;

        if (qualities.length == 0) {
            qualitySelection.hidden = true;
            return;
        } else {
            qualitySelection.hidden = false;
        }
        
        qualitySelection.innerHTML = `
            <h4>选择画质</h4>
            <div class="quality-options" id="qualityOptions"></div>
        `;
        
        const qualityOptions = DOMHelper.$('#qualityOptions');
        if (!qualityOptions) return;
        
        qualities.forEach((quality, index) => {
            const option = DOMHelper.create('div', 
                `quality-option ${index === 0 ? 'active' : ''}`,
                `
                <div class="quality-info">
                    <div class="quality-name">${quality.quality || '标清'}</div>
                    <div class="quality-resolution">${quality.resolution || '未知分辨率'}</div>
                </div>
                <div class="quality-bandwidth">${Utils.formatBandwidth(quality.bandwidth)}</div>
                `
            );
            
            DOMHelper.on(option, 'click', () => {
                // 移除其他选项的active状态
                DOMHelper.$$('.quality-option').forEach(opt => {
                    opt.classList.remove('active');
                });
                
                // 添加当前选项的active状态
                option.classList.add('active');
                
                // 切换播放器质量
                this.playerManager.switchQuality(quality, index);
            });
            
            qualityOptions.appendChild(option);
        });
    }
    
    /**
     * 获取选中的画质
     * @returns {M3U8Result|null}
     */
    getSelectedQuality() {
        return this.playerManager.getCurrentQuality();
    }
    
    /**
     * 关闭视频模态框
     */
    closeVideoModal() {
        const modal = DOMHelper.$('#videoModal');
        if (modal) {
            DOMHelper.hide(modal);
        }
        this.playerManager.destroy();
        // 清理系列视频状态
        this.currentSeriesVideo = null;
        this.currentEpisodes = [];
    }
    
    /**
     * 返回选集页面
     */
    backToEpisodes() {
        // 如果当前正在播放系列剧集，返回选集页面
        if (this.currentSeriesVideo) {
            this.showSeriesModal(this.currentSeriesVideo);
        } else {
            this.closeVideoModal();
        }
    }
    
    /**
     * 处理剧集切换
     * @param {Object} episode - 要切换到的剧集
     * @param {number} index - 剧集索引
     */
    async handleEpisodeChange(episode, index) {
        if (!this.currentSeriesVideo || !episode) return;
        
        // 获取播放进度（返回的是秒数）
        const startTime = this.playerManager.progress.getEpisodePosition(episode.id);
        
        // 播放新剧集
        await this.playEpisode(this.currentSeriesVideo, episode, startTime);
    }
    
    /**
     * 复制当前视频链接
     */
    async copyCurrentVideoLink() {
        const selectedQuality = this.getSelectedQuality();
        if (!selectedQuality) {
            this.notifications.warning('请先选择视频质量');
            return;
        }
        
        const proxyUrl = window.location.origin + this.api.getProxyUrl(selectedQuality.url, this.playerManager.currentVideo.source);
        
        const success = await Utils.copyToClipboard(proxyUrl);
        if (success) {
            this.notifications.success('链接已复制到剪贴板');
        } else {
            this.notifications.error('复制失败');
        }
    }
    
    /**
     * 下载视频
     * @param {string} title
     * @param {string} m3u8Url
     */
    async downloadVideo(title, m3u8Url) {
        try {
            const download = await this.api.createDownload(title, m3u8Url, undefined, this.playerManager.currentVideo.url);
            await this.api.startDownload(download.task.id);
            this.notifications.success('下载任务已创建');
            this.updateDownloadBadge();
        } catch (error) {
            this.notifications.error(`创建下载任务失败: ${error.message}`);
        }
    }
    
    /**
     * 加载下载列表
     */
    async loadDownloads() {
        await this.withLoading(async () => {
            const data = await this.api.getDownloads();
            this.renderDownloadList(data.tasks || []);
            this.updateDownloadBadge();
        }, '加载下载列表失败', false);
    }
    
    /**
     * 渲染下载列表
     * @param {DownloadTask[]} downloads
     */
    renderDownloadList(downloads) {
        const container = DOMHelper.$('#downloadList');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!downloads || downloads.length === 0) {
            container.innerHTML = '<div class="text-center">暂无下载任务</div>';
            return;
        }
        
        downloads.forEach(download => {
            const downloadItem = this.createDownloadItem(download);
            container.appendChild(downloadItem);
        });
    }
    
    /**
     * 创建下载项
     * @param {DownloadTask} download
     * @returns {HTMLElement}
     */
    createDownloadItem(download) {
        const item = DOMHelper.create('div', 'download-item');
        const progress = download.progress || 0;
        
        item.innerHTML = `
            <div class="download-info">
                <div class="download-title">${download.title}</div>
                <div class="download-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${this.getProgressClass(download)}" style="width: ${progress}%"></div>
                    </div>
                    <span>${progress.toFixed(2)}%</span>
                </div>
                <div class="download-status">
                    ${this.getDownloadStatusText(download.status)} 
                    ${download.speed ? `- ${download.speed}` : ''}
                </div>
            </div>
            <div class="download-actions">
                ${this.getDownloadActions(download)}
            </div>
        `;
        
        // 绑定操作按钮事件
        const actionBtn = item.querySelector('.download-actions button');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const downloadId = download.id;
            
            if (action === 'cancel') {
                DOMHelper.on(actionBtn, 'click', () => this.cancelDownload(downloadId));
            } else if (action === 'retry') {
                DOMHelper.on(actionBtn, 'click', () => this.retryDownload(downloadId));
            } else if (action === 'start') {
                DOMHelper.on(actionBtn, 'click', () => this.startDownload(downloadId));
            }
        }
        
        return item;
    }
    
    /**
     * 获取进度条样式
     * @param {DownloadTask} download
     * @returns {string}
     */
    getProgressClass(download) {
        switch (download.status) {
            case 'downloading':
                return 'progress-bar-striped progress-bar-animated';
            case 'completed':
                return 'bg-success';
            case 'error':
            case 'cancelled':
                return 'bg-danger';
            default:
                return 'bg-secondary';
        }
    }
    
    /**
     * 获取下载状态文本
     * @param {string} status
     * @returns {string}
     */
    getDownloadStatusText(status) {
        const statusMap = {
            'created': '已创建',
            'pending': '等待中',
            'downloading': '下载中',
            'completed': '已完成',
            'error': '失败',
            'cancelled': '已取消'
        };
        return statusMap[status] || status;
    }
    
    /**
     * 获取下载操作按钮
     * @param {DownloadTask} download
     * @returns {string}
     */
    getDownloadActions(download) {
        switch (download.status) {
            case 'downloading':
                return `<button class="btn btn-danger btn-small" data-action="cancel">
                    <i class="fas fa-stop"></i> 取消
                </button>`;
            case 'error':
                return `<button class="btn btn-primary btn-small" data-action="retry">
                    <i class="fas fa-redo"></i> 重试
                </button>`;
            case 'completed':
                return `<button class="btn btn-success btn-small" disabled>
                    <i class="fas fa-check"></i> 已完成
                </button>`;
            case 'created':
            case 'pending':
                return `<button class="btn btn-primary btn-small" data-action="start">
                    <i class="fas fa-play"></i> 开始
                </button>`;
            default:
                return '';
        }
    }
    
    /**
     * 执行下载操作并处理通用逻辑
     * @param {Function} apiFn - API调用函数
     * @param {string} successMsg - 成功消息
     * @param {string} errorMsg - 错误消息
     * @param {boolean} [reloadList=true] - 是否刷新列表
     * @param {boolean} [logError=true] - 是否记录错误日志
     */
    async executeDownloadAction(apiFn, successMsg, errorMsg, reloadList = true, logError = true) {
        try {
            const result = await apiFn();
            if (successMsg) this.notifications.success(successMsg);
            if (reloadList) await this.loadDownloads();
            return result;
        } catch (error) {
            if (logError) console.error(`${errorMsg}:`, error);
            this.notifications.error(errorMsg);
            throw error;
        }
    }

    /**
     * 开始下载
     * @param {string} id
     */
    async startDownload(id) {
        await this.executeDownloadAction(
            () => this.api.startDownload(id),
            '下载已开始',
            '开始下载失败'
        );
    }

    /**
     * 取消下载
     * @param {string} id
     */
    async cancelDownload(id) {
        await this.executeDownloadAction(
            () => this.api.cancelDownload(id),
            '下载已取消',
            '取消下载失败'
        );
    }

    /**
     * 重试下载
     * @param {string} id
     */
    async retryDownload(id) {
        await this.executeDownloadAction(
            () => this.api.startDownload(id),
            '下载已重新开始',
            '重试下载失败'
        );
    }

    /**
     * 清除已完成的下载
     */
    async clearCompletedDownloads() {
        try {
            const result = await this.api.clearCompletedDownloads();
            if (result.success) {
                await this.loadDownloads();
                this.notifications.success('已清除所有完成的下载任务');
            } else {
                this.notifications.warning('没有已完成的下载任务可清除');
            }
        } catch (error) {
            console.error('清除已完成下载失败:', error);
            this.notifications.error('清除已完成下载失败');
        }
    }
    
    /**
     * 渲染分页
     * @param {Object} data
     * @param {string} type
     * @param {string} containerId
     */
    renderPagination(data, type, containerId) {
        const container = DOMHelper.$(`#${containerId}`);
        if (!container) return;
        
        const { currentPage = 1, totalPages = 1 } = data;
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let paginationHTML = '';
        
        // 添加页码跳转输入框
        paginationHTML += `
            <div class="pagination-info">
                <div class="page-info">
                    <span>当前第 ${currentPage} 页，共 ${totalPages} 页</span>
                </div>
                <div class="page-jump">
                    <span>跳转到第</span>
                    <input type="number" min="1" max="${totalPages}" id="pageJumpInput" value="${currentPage}" class="page-jump-input">
                    <button class="page-jump-btn" id="pageJumpBtn">确定</button>
                    <span>页</span>
                </div>
            </div>
            <div class="pagination-controls">
        `;
        
        // 上一页
        paginationHTML += `
            <button ${currentPage <= 1 ? 'disabled' : ''} 
                    onclick="app.goToPage('${type}', ${currentPage - 1})"
                    title="上一页">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
        
        // 页码显示逻辑 - 改进显示更多页码
        const maxVisiblePages = 7; // 最多显示的页码数
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = startPage + maxVisiblePages - 1;
        
        // 调整范围以确保不超过总页数
        if (endPage > totalPages) {
            endPage = totalPages;
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        // 如果不是从第一页开始，显示第一页和省略号
        if (startPage > 1) {
            paginationHTML += `<button onclick="app.goToPage('${type}', 1)">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
        }
        
        // 显示页码范围
        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="${i === currentPage ? 'current-page' : ''}"
                        onclick="app.goToPage('${type}', ${i})">
                    ${i}
                </button>
            `;
        }
        
        // 如果不是到最后一页，显示省略号和最后一页
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
            paginationHTML += `<button onclick="app.goToPage('${type}', ${totalPages})">${totalPages}</button>`;
        }
        
        // 下一页
        paginationHTML += `
            <button ${currentPage >= totalPages ? 'disabled' : ''} 
                    onclick="app.goToPage('${type}', ${currentPage + 1})"
                    title="下一页">
                <i class="fas fa-chevron-right"></i>
            </button>
            </div>
        `;
        
        container.innerHTML = paginationHTML;
        
        // 添加回车键支持和跳转按钮事件
        const pageJumpInput = container.querySelector('#pageJumpInput');
        const pageJumpBtn = container.querySelector('#pageJumpBtn');
        
        if (pageJumpInput) {
            pageJumpInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const page = parseInt(pageJumpInput.value);
                    if (page >= 1 && page <= totalPages) {
                        this.goToPage(type, page);
                    } else {
                        this.notifications.warning(`请输入1到${totalPages}之间的页码`);
                        pageJumpInput.value = currentPage;
                    }
                }
            });
        }
        
        if (pageJumpBtn) {
            DOMHelper.on(pageJumpBtn, 'click', () => {
                const page = parseInt(pageJumpInput.value);
                if (page >= 1 && page <= totalPages) {
                    this.goToPage(type, page);
                } else {
                    this.notifications.warning(`请输入1到${totalPages}之间的页码`);
                    pageJumpInput.value = currentPage;
                }
            });
        }
    }
    
    /**
     * 跳转到指定页
     * @param {string} type
     * @param {number} page
     */
    async goToPage(type, page) {
        // 确保页码是有效的数字
        const pageNum = parseInt(page);
        if (isNaN(pageNum) || pageNum < 1) {
            this.notifications.warning('请输入有效的页码');
            return;
        }
        
        // 滚动到顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // 切换页码时清除对应缓存
        this.clearPageCache(type);
        
        if (type === 'home') {
            await this.loadHomePage(pageNum);
        } else if (type === 'search') {
            await this.loadSearchResults(pageNum);
        }
        
        // 更新URL哈希
        this.saveToHash();
    }
    
    /**
     * 开始下载监控
     */
    startDownloadMonitoring() {
        // 清除现有的定时器
        if (this.downloadInterval) {
            clearInterval(this.downloadInterval);
        }

        // 每2s更新一次下载状态
        this.downloadInterval = setInterval(async () => {
            if (this.currentPage === 'downloads') {
                await this.loadDownloads();
            } else {
                // 只更新徽章，不重新加载整个列表
                await this.updateDownloadBadge();
            }
        }, 2000);
    }
    
    /**
     * 更新下载徽章
     */
    async updateDownloadBadge() {
        try {
            const data = await this.api.getDownloads();
            // 修复：使用正确的属性名tasks而不是downloads（适配后端返回格式）
            const activeDownloads = data.tasks ? data.tasks.filter(d => 
                d.status === 'downloading' || d.status === 'created'
            ).length : 0;
            
            const badge = DOMHelper.$('#downloadBadge');
            if (badge) {
                badge.textContent = activeDownloads;
                badge.style.display = activeDownloads > 0 ? 'block' : 'none';
            }
        } catch (error) {
            console.error('Failed to update download badge:', error);
        }
    }
    
    /**
     * 显示加载指示器
     */
    showLoading() {
        const loading = DOMHelper.$('#loading');
        if (loading) {
            DOMHelper.show(loading);
        }
    }
    
    /**
     * 隐藏加载指示器
     */
    hideLoading() {
        const loading = DOMHelper.$('#loading');
        if (loading) {
            DOMHelper.hide(loading);
        }
    }


    /**
     * 直接下载视频（无需预览）
     * @param {VideoItem} video
     */
    async directDownload(video) {
        try {
            this.showLoading();
            this.notifications.info(`正在解析视频: ${video.title}`);
            
            // 解析视频链接
            const parseResult = await this.api.parseVideo(video.url, video.source);
            
            // 根据实际返回的数据结构处理
            const results = parseResult.results || [];
            
            if (results && results.length > 0) {
                // 默认选择最高质量
                const highestQuality = results.reduce((prev, current) => {
                    const prevBandwidth = prev.bandwidth || 0;
                    const currentBandwidth = current.bandwidth || 0;
                    return currentBandwidth > prevBandwidth ? current : prev;
                });
                
                // 开始下载
                const download = await this.createDownload(video.title, highestQuality.url, video.url);
                await this.api.startDownload(download.task.id);
                this.notifications.success(`已添加到下载队列: ${video.title}`);
            } else {
                this.notifications.error('无法获取视频下载链接');
            }
        } catch (error) {
            console.error('Direct download error:', error);
            this.notifications.error(`直接下载失败: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 创建下载任务
     * @param {string} title
     * @param {string} m3u8Url
     * @param {string} referer
     */
    async createDownload(title, m3u8Url, referer) {
        try {
            const result = await this.api.createDownload(title, m3u8Url, undefined, referer);
            if (result.task) {
                // 如果当前在下载页面，刷新下载列表
                if (this.currentPage === 'downloads') {
                    await this.loadDownloads();
                } else {
                    // 否则只更新徽章
                    await this.updateDownloadBadge();
                }
                return result;
            } else {
                throw new Error('创建下载任务失败');
            }
        } catch (error) {
            console.error('Create download error:', error);
            this.notifications.error(`创建下载任务失败: ${error.message}`);
            throw error;
        }
    }

}

// 全局变量
/** @type {VideoManager|null} */
let app = null;

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    app = new VideoManager();
    // 添加管理按钮事件监听器
    const manageSourceBtn = DOMHelper.$('#manageSourceBtn');
    if (manageSourceBtn) {
        DOMHelper.on(manageSourceBtn, 'click', () => {
            if (app) {
                app.switchPage('sources');
            }
        });
    }
});

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    if (app && app.notifications) {
        app.notifications.error('发生未知错误');
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (app && app.notifications) {
        app.notifications.error('操作失败');
    }
});

// 响应式处理
window.addEventListener('resize', () => {
    const sidebar = DOMHelper.$('#sidebar');
    if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.remove('show');
    }
});

// 页面可见性变化处理
document.addEventListener('visibilitychange', () => {
    if (!app) return;
    
    if (document.hidden) {
        // 页面隐藏时暂停下载监控
        if (app.downloadInterval) {
            clearInterval(app.downloadInterval);
            app.downloadInterval = null;
        }
    } else {
        // 页面显示时恢复下载监控
        app.startDownloadMonitoring();
    }
});