/**
 * 参数校验工具函数
 */

/**
 * 校验字符串参数是否存在且非空
 * @param value 要校验的值
 * @param fieldName 字段名称，用于错误消息
 * @returns 校验通过返回true，否则返回false
 */
export function validateRequiredString(value: any, fieldName: string): boolean {
    if (value === undefined || value === null || value === '') {
        return false;
    }
    return typeof value === 'string';
}

/**
 * 校验数字参数是否存在且有效
 * @param value 要校验的值
 * @param fieldName 字段名称，用于错误消息
 * @param min 最小值（可选）
 * @param max 最大值（可选）
 * @returns 校验通过返回true，否则返回false
 */
export function validateNumber(value: any, fieldName: string, min?: number, max?: number): boolean {
    if (value === undefined || value === null) {
        return false;
    }
    
    const num = Number(value);
    if (isNaN(num)) {
        return false;
    }
    
    if (min !== undefined && num < min) {
        return false;
    }
    
    if (max !== undefined && num > max) {
        return false;
    }
    
    return true;
}

/**
 * 校验URL参数是否有效
 * @param url 要校验的URL
 * @returns 校验通过返回true，否则返回false
 */
export function validateUrl(url: string): boolean {
    if (!validateRequiredString(url, 'url')) {
        return false;
    }
    
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * 校验请求体中的必需字段
 * @param body 请求体对象
 * @param requiredFields 必需字段名数组
 * @returns 缺失的字段名数组，如果没有缺失则返回空数组
 */
export function validateRequiredFields(body: any, requiredFields: string[]): string[] {
    const missingFields: string[] = [];
    
    for (const field of requiredFields) {
        if (body[field] === undefined || body[field] === null || body[field] === '') {
            missingFields.push(field);
        }
    }
    
    return missingFields;
}

/**
 * 校验分页参数
 * @param page 页码
 * @param limit 每页数量（可选）
 * @returns 校验通过返回true，否则返回false
 */
export function validatePagination(page: any, limit?: any): boolean {
    const pageValid = validateNumber(page, 'page', 1);
    
    if (!pageValid) {
        return false;
    }
    
    if (limit !== undefined) {
        return validateNumber(limit, 'limit', 1, 100);
    }
    
    return true;
}

/**
 * 创建标准化的错误响应
 * @param message 错误消息
 * @param status HTTP状态码（默认400）
 * @returns 错误响应对象
 */
export function createErrorResponse(message: string, status: number = 400) {
    return {
        status,
        body: { error: message }
    };
}