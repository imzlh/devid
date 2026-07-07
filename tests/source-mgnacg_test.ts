import { assertEquals, assertThrows } from "@std/assert";
import {
  mgnacgVerifyMessage,
  resolveMgnacgPlayerPath,
} from "../src/sources/mgnacg.ts";

Deno.test("resolveMgnacgPlayerPath keeps unencrypted player URLs", () => {
  assertEquals(
    resolveMgnacgPlayerPath({ encrypt: 0, url: "/player/raw.html" }),
    "/player/raw.html",
  );
});

Deno.test("resolveMgnacgPlayerPath decodes escaped and base64 player URLs", () => {
  assertEquals(
    resolveMgnacgPlayerPath({
      encrypt: 1,
      url: "/player/%E7%AC%AC1%E9%9B%86.html",
    }),
    "/player/第1集.html",
  );
  assertEquals(
    resolveMgnacgPlayerPath({
      encrypt: 2,
      url: btoa("/player/%E7%AC%AC2%E9%9B%86.html"),
    }),
    "/player/第2集.html",
  );
});

Deno.test("resolveMgnacgPlayerPath rejects unknown encryption modes", () => {
  assertThrows(
    () => resolveMgnacgPlayerPath({ encrypt: 99, url: "/player/raw.html" }),
    Error,
    "Unknown encrypt type 99",
  );
});

Deno.test("mgnacgVerifyMessage handles empty malformed and JSON responses", () => {
  assertEquals(mgnacgVerifyMessage(""), "");
  assertEquals(mgnacgVerifyMessage("not json"), "验证码错误");
  assertEquals(mgnacgVerifyMessage('{"msg":" 再试一次 "}'), "再试一次");
  assertEquals(mgnacgVerifyMessage('{"ok":false}'), "验证码错误");
});
