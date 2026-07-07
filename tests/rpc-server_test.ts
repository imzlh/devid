import { assertEquals } from "@std/assert";
import {
  normalizeRPCMessage,
  WebSocketRPCServer,
} from "../src/websocket/rpc.ts";
import { normalizePushTasks, pushedTaskId } from "../src/websocket/push.ts";
import { registerRpcHandlers } from "../src/server/rpc-routes.ts";
import {
  captcha,
  clearAllPending,
  getPendingCount,
} from "../src/utils/captcha.ts";
import { rpcServer } from "../src/websocket/rpc.ts";

Deno.test("normalizeRPCMessage accepts valid RPC calls", () => {
  const result = normalizeRPCMessage({
    id: "call-1",
    method: " videos.parse ",
    params: ["https://example.test/watch"],
  });

  assertEquals(result, {
    ok: true,
    message: {
      id: "call-1",
      method: "videos.parse",
      params: ["https://example.test/watch"],
    },
  });
});

Deno.test("WebSocketRPCServer broadcast drops failed clients and continues", () => {
  const server = new WebSocketRPCServer();
  const failed = createFakeSocket({ throwOnSend: true });
  const healthy = createFakeSocket();

  server.handleConnection(failed.socket);
  server.handleConnection(healthy.socket);

  server.broadcast("download:update", [{ id: "task-1" }]);

  assertEquals(server.getClientCount(), 1);
  assertEquals(healthy.sent, [
    JSON.stringify({ method: "download:update", data: [{ id: "task-1" }] }),
  ]);
});

Deno.test("pushedTaskId tolerates malformed download push payloads", () => {
  assertEquals(pushedTaskId(null), "unknown");
  assertEquals(pushedTaskId({}), "unknown");
  assertEquals(pushedTaskId({ id: " task-1 " }), "task-1");
});

Deno.test("normalizePushTasks rejects malformed download update payloads", () => {
  const tasks = [{ id: "task-1" }];

  assertEquals(normalizePushTasks(tasks), tasks);
  assertEquals(normalizePushTasks(null), []);
  assertEquals(normalizePushTasks({ length: 1 }), []);
});

Deno.test("registered download RPC handlers use normalized task ids", async () => {
  const handlers = new Map<string, (...params: unknown[]) => unknown>();
  const calls: string[] = [];
  registerRpcHandlers({
    rpcServer: {
      register(method: string, handler: (...params: unknown[]) => unknown) {
        handlers.set(method, handler);
      },
      getClientCount() {
        return 0;
      },
    },
    videoSourceManager: {},
    downloadManager: {
      getDownloadTask(id: string) {
        calls.push(`get:${id}`);
        return id === "task-1" ? { id, status: "pending" } : null;
      },
      startDownload(id: string) {
        calls.push(`start:${id}`);
        return true;
      },
      saveToKV() {
        calls.push("save");
        return Promise.resolve();
      },
    },
  } as never);

  const result = await handlers.get("downloads.start")?.(" task-1 ");

  assertEquals(result, {
    success: true,
    message: "任务已加入下载队列",
    task: { id: "task-1", status: "pending" },
  });
  assertEquals(calls, ["get:task-1", "start:task-1", "save", "get:task-1"]);
});

Deno.test("registered captcha RPC handlers trim request ids answers and reasons", async () => {
  clearAllPending();
  const handlers = new Map<string, (...params: unknown[]) => unknown>();
  const broadcasts: Array<{ method: string; data: unknown }> = [];
  const target = rpcServer as unknown as {
    broadcast: (method: string, data: unknown) => void;
  };
  const originalBroadcast = target.broadcast.bind(rpcServer);
  target.broadcast = (method, data) => broadcasts.push({ method, data });

  try {
    registerRpcHandlers({
      rpcServer: {
        register(method: string, handler: (...params: unknown[]) => unknown) {
          handlers.set(method, handler);
        },
        getClientCount() {
          return 0;
        },
      },
      videoSourceManager: {},
      downloadManager: {},
    } as never);

    const pending = captcha({
      imageUrl: "https://example.test/captcha.png",
      timeout: 10_000,
    });
    const required = broadcasts.find((item) =>
      item.method === "captcha:required"
    );
    const request = required?.data as { requestId?: unknown };
    const requestId = typeof request.requestId === "string"
      ? request.requestId
      : "";

    assertEquals(
      await handlers.get("captcha.submit")?.(` ${requestId} `, "  1234  "),
      { success: true },
    );
    assertEquals(await pending, "1234");
    assertEquals(getPendingCount(), 0);

    const second = captcha({
      imageUrl: "https://example.test/captcha-2.png",
      timeout: 10_000,
    });
    const secondRequired = broadcasts
      .filter((item) => item.method === "captcha:required")
      .at(-1);
    const secondRequest = secondRequired?.data as { requestId?: unknown };
    const secondRequestId = typeof secondRequest.requestId === "string"
      ? secondRequest.requestId
      : "";

    assertEquals(
      await handlers.get("captcha.cancel")?.(
        ` ${secondRequestId} `,
        "  用户关闭  ",
      ),
      { success: true },
    );
    await second.catch((error) => {
      assertEquals(
        error instanceof Error ? error.message : String(error),
        "用户关闭",
      );
    });
    assertEquals(getPendingCount(), 0);
  } finally {
    clearAllPending();
    target.broadcast = originalBroadcast;
  }
});

function createFakeSocket(options: { throwOnSend?: boolean } = {}): {
  socket: WebSocket;
  sent: string[];
} {
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send(message: string) {
      if (options.throwOnSend) throw new Error("send failed");
      sent.push(message);
    },
    onmessage: null,
    onclose: null,
    onerror: null,
  } as unknown as WebSocket;

  return { socket, sent };
}

Deno.test("normalizeRPCMessage keeps request id on invalid params", () => {
  const result = normalizeRPCMessage({
    id: " call-2 ",
    method: "videos.parse",
    params: { url: "https://example.test/watch" },
  });

  assertEquals(result, {
    ok: false,
    response: {
      id: "call-2",
      error: {
        code: -32602,
        message: "Invalid params",
      },
    },
  });
});

Deno.test("normalizeRPCMessage rejects malformed requests without throwing", () => {
  assertEquals(normalizeRPCMessage(null), {
    ok: false,
    response: {
      id: "",
      error: {
        code: -32600,
        message: "Invalid request",
      },
    },
  });

  assertEquals(normalizeRPCMessage({ id: "call-3" }), {
    ok: false,
    response: {
      id: "call-3",
      error: {
        code: -32600,
        message: "Invalid request method",
      },
    },
  });

  assertEquals(normalizeRPCMessage({ id: "   ", method: "videos.parse" }), {
    ok: false,
    response: {
      id: "",
      error: {
        code: -32600,
        message: "Invalid request id",
      },
    },
  });
});
