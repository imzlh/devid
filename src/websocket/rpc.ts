/**
 * WebSocket RPC 服务器
 * 提供与 HTTP API 对应的 RPC 接口
 */

import { logDebug, logError, logInfo } from "../utils/logger.ts";

// RPC 消息类型
export interface RPCMessage {
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
        const parsed = JSON.parse(String(event.data));
        const normalized = normalizeRPCMessage(parsed);
        const response = normalized.ok
          ? await this.handleMessage(normalized.message)
          : normalized.response;
        this.sendSafely(ws, JSON.stringify(response));
      } catch (error) {
        logError("处理 RPC 消息失败:", error);
        this.sendSafely(
          ws,
          JSON.stringify({
            id: "",
            error: {
              code: -32700,
              message: "Parse error",
            },
          }),
        );
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
          message: `Method not found: ${method}`,
        },
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
          message: error instanceof Error ? error.message : "Internal error",
        },
      };
    }
  }

  /**
   * 广播消息给所有客户端
   */
  broadcast(method: string, data: unknown): void {
    let message: string;
    try {
      message = JSON.stringify({ method, data });
    } catch (error) {
      logError(`广播消息序列化失败: ${method}`, error);
      return;
    }

    this.clients.forEach((ws) => {
      this.sendSafely(ws, message);
    });
  }

  /**
   * 获取连接数
   */
  getClientCount(): number {
    return this.clients.size;
  }

  private sendSafely(ws: WebSocket, message: string): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      this.clients.delete(ws);
      return false;
    }

    try {
      ws.send(message);
      return true;
    } catch (error) {
      this.clients.delete(ws);
      logError("WebSocket 发送失败:", error);
      return false;
    }
  }
}

export function normalizeRPCMessage(value: unknown):
  | { ok: true; message: RPCMessage }
  | { ok: false; response: RPCResponse } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidRPCRequest("", "Invalid request");
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";

  if (typeof record.id !== "string" || id.length === 0) {
    return invalidRPCRequest(id, "Invalid request id");
  }
  if (typeof record.method !== "string" || record.method.trim().length === 0) {
    return invalidRPCRequest(id, "Invalid request method");
  }
  if (record.params !== undefined && !Array.isArray(record.params)) {
    return {
      ok: false,
      response: {
        id,
        error: {
          code: -32602,
          message: "Invalid params",
        },
      },
    };
  }

  return {
    ok: true,
    message: {
      id,
      method: record.method.trim(),
      params: record.params as unknown[] | undefined,
    },
  };
}

function invalidRPCRequest(id: string, message: string): {
  ok: false;
  response: RPCResponse;
} {
  return {
    ok: false,
    response: {
      id,
      error: {
        code: -32600,
        message,
      },
    },
  };
}

// 单例实例
export const rpcServer = new WebSocketRPCServer();
