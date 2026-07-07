import { assertEquals, assertRejects } from "@std/assert";
import {
  cancelCaptcha,
  captcha,
  clearAllPending,
  getCaptchaImageUrl,
  getPendingCount,
  resolveCaptcha,
} from "../src/utils/captcha.ts";
import { rpcServer } from "../src/websocket/rpc.ts";

type Broadcast = { method: string; data: unknown };

function captureBroadcasts(): {
  broadcasts: Broadcast[];
  restore: () => void;
} {
  const broadcasts: Broadcast[] = [];
  const target = rpcServer as unknown as {
    broadcast: (method: string, data: unknown) => void;
  };
  const original = target.broadcast.bind(rpcServer);
  target.broadcast = (method, data) => {
    broadcasts.push({ method, data });
  };
  return {
    broadcasts,
    restore: () => {
      target.broadcast = original;
    },
  };
}

Deno.test("captcha rejects malformed image URLs before creating pending requests", async () => {
  clearAllPending();
  await assertRejects(
    () => captcha({ imageUrl: "javascript:alert(1)" }),
    Error,
    "无效的验证码图片URL",
  );
  assertEquals(getPendingCount(), 0);
});

Deno.test("captcha normalizes request ids, image URLs, prompts and answers", async () => {
  clearAllPending();
  const { broadcasts, restore } = captureBroadcasts();
  try {
    const promise = captcha({
      imageUrl: " https://example.test/captcha.png?x=1 ",
      prompt: "  Solve it  ",
      timeout: 10_000,
    });

    const required = broadcasts.find((item) =>
      item.method === "captcha:required"
    );
    const request = required?.data as { requestId?: unknown; prompt?: unknown };
    const requestId = typeof request.requestId === "string"
      ? request.requestId
      : "";

    assertEquals(request.prompt, "Solve it");
    assertEquals(getPendingCount(), 1);
    assertEquals(
      getCaptchaImageUrl(`  ${requestId}  `),
      "https://example.test/captcha.png?x=1",
    );
    assertEquals(resolveCaptcha(`  ${requestId}  `, "  1234  "), true);
    assertEquals(await promise, "1234");
    assertEquals(getPendingCount(), 0);
    assertEquals(
      broadcasts.some((item) => item.method === "captcha:resolved"),
      true,
    );
  } finally {
    clearAllPending();
    restore();
  }
});

Deno.test("captcha cancel trims request ids and reasons", async () => {
  clearAllPending();
  const { broadcasts, restore } = captureBroadcasts();
  try {
    const promise = captcha({
      imageUrl: "https://example.test/captcha.jpg",
      timeout: 10_000,
    });
    const required = broadcasts.find((item) =>
      item.method === "captcha:required"
    );
    const request = required?.data as { requestId?: unknown };
    const requestId = typeof request.requestId === "string"
      ? request.requestId
      : "";

    assertEquals(cancelCaptcha(` ${requestId} `, "  用户关闭  "), true);
    await assertRejects(() => promise, Error, "用户关闭");
    assertEquals(getPendingCount(), 0);
    assertEquals(
      broadcasts.find((item) => item.method === "captcha:cancelled")?.data,
      { requestId, reason: "用户关闭" },
    );
  } finally {
    clearAllPending();
    restore();
  }
});
