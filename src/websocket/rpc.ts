/**
 * WebSocket RPC 服务器
 * 提供与 HTTP API 对应的 RPC 接口
 */

import { logInfo, logError, logDebug } from "../utils/logger.ts";

// RPC 消息类型
interface RPCMessage {
    id: string;
    method: string;
    params?: unknown[];
}

interface RPCResponse {
    id: string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}

// RPC 方法处理器
export type RPCHandler = (...params: unknown[]) => Promise<unknown> | unknown;

export class WebSocketRPCServer {
    private handlers: Map<string, RPCHandler> = new Map();
    private clients: Set<WebSocket> = new Set();

    /**
     * 注册 RPC 方法
     */
    register(method: string, handler: RPCHandler): void {
        this.handlers.set(method, handler);
        logDebug(`注册 RPC 方法: ${method}`);
    }

    /**
     * 处理 WebSocket 连接
     */
    handleConnection(ws: WebSocket): void {
        this.clients.add(ws);
        logInfo("WebSocket 客户端连接");

        ws.onmessage = async (event) => {
            try {
                const message: RPCMessage = JSON.parse(event.data);
                const response = await this.handleMessage(message);
                ws.send(JSON.stringify(response));
            } catch (error) {
                logError("处理 RPC 消息失败:", error);
                ws.send(JSON.stringify({
                    id: "",
                    error: {
                        code: -32700,
                        message: "Parse error"
                    }
                }));
            }
        };

        ws.onclose = () => {
            this.clients.delete(ws);
            logInfo("WebSocket 客户端断开");
        };

        ws.onerror = (error) => {
            logError("WebSocket 错误:", (error as ErrorEvent).message);
        };
    }

    /**
     * 处理单个 RPC 消息
     */
    private async handleMessage(message: RPCMessage): Promise<RPCResponse> {
        const { id, method, params = [] } = message;

        const handler = this.handlers.get(method);
        if (!handler) {
            return {
                id,
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`
                }
            };
        }

        try {
            const result = await handler(...params);
            return { id, result };
        } catch (error) {
            logError(`RPC 方法 ${method} 执行失败:`, error);
            return {
                id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : "Internal error"
                }
            };
        }
    }

    /**
     * 广播消息给所有客户端
     */
    broadcast(method: string, data: unknown): void {
        const message = JSON.stringify({ method, data });
        this.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });
    }

    /**
     * 获取连接数
     */
    getClientCount(): number {
        return this.clients.size;
    }
}

// 单例实例
export const rpcServer = new WebSocketRPCServer();
