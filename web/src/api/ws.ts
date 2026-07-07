type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PushHandler<T = unknown> = (data: T) => void;

export type RpcClientMessage =
  | {
    kind: "response";
    id: string;
    result?: unknown;
    errorMessage?: string;
  }
  | {
    kind: "push";
    method: string;
    data: unknown;
  };

export function normalizeRpcClientMessage(
  data: string,
): RpcClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const message = parsed as {
    id?: unknown;
    error?: unknown;
    result?: unknown;
    method?: unknown;
    data?: unknown;
  };

  if (typeof message.id === "string") {
    const id = message.id.trim();
    if (!id) return null;
    let errorMessage: string | undefined;
    if (message.error && typeof message.error === "object") {
      const rawMessage = (message.error as { message?: unknown }).message;
      errorMessage = typeof rawMessage === "string" && rawMessage.trim()
        ? rawMessage.trim()
        : "RPC error";
    } else if (typeof message.error === "string" && message.error.trim()) {
      errorMessage = message.error.trim();
    } else if (message.error) {
      errorMessage = "RPC error";
    }
    return {
      kind: "response",
      id,
      result: message.result,
      errorMessage,
    };
  }

  const method = typeof message.method === "string"
    ? message.method.trim()
    : "";
  if (!method) return null;
  return { kind: "push", method, data: message.data };
}

export class RpcClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingCall>();
  private handlers = new Map<string, Set<PushHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private connectionId = 0;

  connected = false;

  connect(path = "/ws"): void {
    this.closedByUser = false;
    this.connectionId++;
    const connectionId = this.connectionId;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectPending(new Error("WebSocket disconnected"));
    this.ws?.close();
    const location = globalThis.location;
    const WebSocketCtor = globalThis.WebSocket;
    if (!location?.host || typeof WebSocketCtor !== "function") {
      this.connected = false;
      return;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}${path}`;
    try {
      this.ws = new WebSocketCtor(url);
    } catch {
      this.connected = false;
      this.ws = null;
      return;
    }

    this.ws.onopen = () => {
      if (connectionId !== this.connectionId) return;
      this.connected = true;
    };

    this.ws.onmessage = (event) => {
      if (connectionId !== this.connectionId) return;
      this.handleMessage(event.data);
    };

    this.ws.onclose = () => {
      if (connectionId !== this.connectionId) return;
      this.connected = false;
      this.rejectPending(new Error("WebSocket disconnected"));
      if (!this.closedByUser) {
        this.reconnectTimer = setTimeout(() => this.connect(path), 3000);
      }
    };

    this.ws.onerror = () => {
      if (connectionId !== this.connectionId) return;
      this.connected = false;
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    this.connectionId++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.rejectPending(new Error("WebSocket disconnected"));
  }

  call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }

    const id = crypto.randomUUID();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const payload = JSON.stringify({ id, method, params });
      const createdTimeoutId = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new Error("RPC timeout"));
      }, 30000);
      timeoutId = createdTimeoutId;

      const promise = new Promise<T>((resolve, reject) => {
        this.pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeoutId: createdTimeoutId,
        });
      });

      this.ws.send(payload);
      return promise;
    } catch (error) {
      this.pending.delete(id);
      if (timeoutId) clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      return Promise.reject(
        new Error(`WebSocket send failed${message ? `: ${message}` : ""}`),
      );
    }
  }

  on<T>(method: string, handler: PushHandler<T>): () => void {
    const set = this.handlers.get(method) ?? new Set<PushHandler>();
    set.add(handler as PushHandler);
    this.handlers.set(method, set);
    return () => {
      set.delete(handler as PushHandler);
      if (set.size === 0) this.handlers.delete(method);
    };
  }

  private handleMessage(data: string): void {
    const message = normalizeRpcClientMessage(data);
    if (!message) return;

    if (message.kind === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeoutId);
      if (message.errorMessage) {
        pending.reject(new Error(message.errorMessage));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    const handlers = this.handlers.get(message.method);
    handlers?.forEach((handler) => {
      try {
        handler(message.data);
      } catch (error) {
        console.error(`RPC push handler failed: ${message.method}`, error);
      }
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
