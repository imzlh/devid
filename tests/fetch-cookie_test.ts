import { assertEquals } from "@std/assert";
import {
  buildCookieHeader,
  cookiePathMatches,
  imagePayloadError,
  isImageLikeContentType,
} from "../src/utils/fetch.ts";

Deno.test("cookiePathMatches follows path segment boundaries", () => {
  assertEquals(cookiePathMatches("/foo", "/foo"), true);
  assertEquals(cookiePathMatches("/foo/bar", "/foo"), true);
  assertEquals(cookiePathMatches("/foobar", "/foo"), false);
  assertEquals(cookiePathMatches("/foo", "/"), true);
  assertEquals(cookiePathMatches("/foo", "/foo/"), false);
  assertEquals(cookiePathMatches("/foo/bar", "/foo/"), true);
});

Deno.test("buildCookieHeader respects domain host-only path and secure rules", () => {
  const cookies = [
    {
      name: "host",
      value: "a",
      domain: "www.example.test",
      path: "/",
      hostOnly: true,
    },
    {
      name: "parent",
      value: "b",
      domain: "example.test",
      path: "/app",
    },
    {
      name: "secure",
      value: "c",
      domain: "example.test",
      path: "/",
      secure: true,
    },
    {
      name: "other",
      value: "d",
      domain: "other.example.test",
      path: "/",
    },
  ];

  assertEquals(
    buildCookieHeader(cookies, "https://www.example.test/app/page", "manual=1"),
    "manual=1; host=a; parent=b; secure=c",
  );
  assertEquals(
    buildCookieHeader(cookies, "http://www.example.test/app/page"),
    "host=a; parent=b",
  );
  assertEquals(
    buildCookieHeader(cookies, "https://api.example.test/app/page"),
    "parent=b; secure=c",
  );
  assertEquals(
    buildCookieHeader(cookies, "https://www.example.test/application"),
    "host=a; secure=c",
  );
});

Deno.test("buildCookieHeader drops malformed cookie entries", () => {
  const cookies = [
    null,
    { name: "", value: "missing-name", domain: "example.test" },
    { name: "bad-value", value: 1, domain: "example.test" },
    {
      name: " kept ",
      value: " value ",
      domain: ".example.test",
      path: "/app",
      secure: "yes",
      expires: "bad date",
    },
  ];

  assertEquals(
    buildCookieHeader(cookies, "https://www.example.test/app/page"),
    "kept=value",
  );
});

Deno.test("isImageLikeContentType rejects explicit non-image responses", () => {
  assertEquals(isImageLikeContentType("image/jpeg"), true);
  assertEquals(isImageLikeContentType("image/webp; charset=binary"), true);
  assertEquals(isImageLikeContentType("application/octet-stream"), true);
  assertEquals(isImageLikeContentType("text/html; charset=utf-8"), false);
  assertEquals(isImageLikeContentType("application/json"), false);
});

Deno.test("imagePayloadError rejects empty or non-image image proxy payloads", () => {
  assertEquals(
    imagePayloadError(new Uint8Array([1, 2, 3]), "image/jpeg"),
    null,
  );
  assertEquals(
    imagePayloadError(new Uint8Array(), "image/jpeg"),
    "图片响应为空",
  );
  assertEquals(
    imagePayloadError(new Uint8Array([1]), "text/html; charset=utf-8"),
    "图片响应类型无效",
  );
});
