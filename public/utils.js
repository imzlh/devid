/**
 * @typedef {Object} NotificationOptions
 * @property {string} message - 通知消息
 * @property {'success'|'error'|'warning'|'info'} type - 通知类型
 * @property {number} duration - 显示时长(毫秒)
 */

/**
 * DOM操作工具类
 */
class DOMHelper {
    /**
     * 查询单个元素
     * @param {string} selector - CSS选择器
     * @returns {HTMLElement|null}
     */
    static $(selector) {
        return document.querySelector(selector);
    }

    /**
     * 查询多个元素
     * @param {string} selector - CSS选择器
     * @returns {NodeListOf<HTMLElement>}
     */
    static $$(selector) {
        return document.querySelectorAll(selector);
    }

    /**
     * 创建元素
     * @param {string} tag - 标签名
     * @param {string} className - 类名
     * @param {string} innerHTML - 内容
     * @returns {HTMLElement}
     */
    static create(tag, className = '', innerHTML = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (innerHTML) element.innerHTML = innerHTML;
        return element;
    }

    /**
     * 显示元素
     * @param {HTMLElement} element
     */
    static show(element) {
        if (element) element.classList.remove('hidden');
    }

    /**
     * 隐藏元素
     * @param {HTMLElement} element
     */
    static hide(element) {
        if (element) element.classList.add('hidden');
    }

    /**
     * 切换元素显示状态
     * @param {HTMLElement} element
     */
    static toggle(element) {
        if (element) element.classList.toggle('hidden');
    }

    /**
     * 绑定事件
     * @param {HTMLElement} element
     * @param {string} event
     * @param {Function} handler
     */
    static on(element, event, handler) {
        if (element && typeof handler === 'function') {
            element.addEventListener(event, handler);
        }
    }

    /**
     * 解绑事件
     * @param {HTMLElement} element
     * @param {string} event
     * @param {Function} handler
     */
    static off(element, event, handler) {
        if (element && typeof handler === 'function') {
            element.removeEventListener(event, handler);
        }
    }
}

/**
 * 通知管理类
 */
class NotificationManager {
    constructor() {
        /** @type {HTMLElement|null} */
        this.container = DOMHelper.$('#notifications');

        if (!this.container) {
            console.warn('Notifications container not found');
        }
    }

    /**
     * 显示通知
     * @param {string} message - 消息内容
     * @param {'success'|'error'|'warning'|'info'} type - 通知类型
     * @param {number} duration - 显示时长
     */
    show(message, type = 'success', duration = 3000) {
        if (!this.container) return;

        const notification = DOMHelper.create('div', `notification ${type}`, message);
        this.container.appendChild(notification);

        // 自动移除
        const timeoutId = setTimeout(() => {
            this.removeNotification(notification);
        }, duration);

        // 点击移除
        DOMHelper.on(notification, 'click', () => {
            clearTimeout(timeoutId);
            this.removeNotification(notification);
        });
    }

    /**
     * 移除通知
     * @param {HTMLElement} notification
     */
    removeNotification(notification) {
        if (notification && notification.parentNode) {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }

    /**
     * 成功通知
     * @param {string} message
     */
    success(message) {
        this.show(message, 'success');
    }

    /**
     * 错误通知
     * @param {string} message
     */
    error(message) {
        this.show(message, 'error', 5000);
    }

    /**
     * 警告通知
     * @param {string} message
     */
    warning(message) {
        this.show(message, 'warning');
    }

    /**
     * 信息通知
     * @param {string} message
     */
    info(message) {
        this.show(message, 'info');
    }
}

/**
 * 主题管理类
 */
class ThemeManager {
    constructor() {
        /** @type {HTMLElement|null} */
        this.themeToggle = DOMHelper.$('#themeToggle');
        /** @type {HTMLElement|null} */
        this.themeIcon = DOMHelper.$('.theme-icon');
        /** @type {'light'|'dark'} */
        this.currentTheme = 'light';

        this.init();
    }

    /**
     * 初始化主题管理器
     */
    init() {
        if (!this.themeToggle || !this.themeIcon) {
            console.warn('Theme elements not found');
            return;
        }

        // 从本地存储加载主题
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);

        // 绑定切换事件
        DOMHelper.on(this.themeToggle, 'click', () => {
            const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
            this.setTheme(newTheme);
        });
    }

    /**
     * 设置主题
     * @param {'light'|'dark'} theme
     */
    setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);

        // 更新图标
        if (this.themeIcon) {
            if (theme === 'dark') {
                this.themeIcon.className = 'fas fa-sun theme-icon';
            } else {
                this.themeIcon.className = 'fas fa-moon theme-icon';
            }
        }

        localStorage.setItem('theme', theme);
    }

    /**
     * 获取当前主题
     * @returns {'light'|'dark'}
     */
    getTheme() {
        return this.currentTheme;
    }
}

/**
 * 工具函数类
 */
class Utils {
    /**
     * 格式化文件大小
     * @param {number} bytes - 字节数
     * @returns {string}
     */
    static formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';

        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * 格式化时长
     * @param {number} seconds - 秒数
     * @returns {string}
     */
    static formatDuration(seconds) {
        if (!seconds || seconds === 0) return '00:00';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }

    /**
     * 格式化带宽
     * @param {number} bandwidth - 带宽(bps)
     * @returns {string}
     */
    static formatBandwidth(bandwidth) {
        if (!bandwidth) return '';

        const mbps = (bandwidth / 1000000).toFixed(1);
        return `${mbps} Mbps`;
    }

    /**
     * 防抖函数
     * @param {Function} func - 要防抖的函数
     * @param {number} wait - 等待时间
     * @returns {Function}
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 复制到剪贴板
     * @param {string} text - 要复制的文本
     * @returns {Promise<boolean>}
     */
    static async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // 降级方案
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();

            try {
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                return successful;
            } catch (err) {
                document.body.removeChild(textArea);
                return false;
            }
        }
    }
}
