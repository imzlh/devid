import { assertEquals } from "@std/assert";
import {
  normalizeDownloadFormatInput,
  normalizeUrlProxyInput,
  optionalTrimmedString,
} from "../src/utils/validation.ts";
import { URLProxy } from "../src/types/index.ts";

Deno.test("validation helpers normalize optional route inputs", () => {
  assertEquals(optionalTrimmedString("  source-a  "), "source-a");
  assertEquals(optionalTrimmedString("   "), undefined);
  assertEquals(optionalTrimmedString(1), undefined);
});

Deno.test("validation helpers normalize download format and proxy inputs", () => {
  assertEquals(normalizeDownloadFormatInput(" M3U8 "), "m3u8");
  assertEquals(normalizeDownloadFormatInput(" h5 "), "h5");
  assertEquals(normalizeDownloadFormatInput("video"), undefined);

  assertEquals(normalizeUrlProxyInput(URLProxy.LOCAL), URLProxy.LOCAL);
  assertEquals(normalizeUrlProxyInput("2"), URLProxy.REMOTE);
  assertEquals(normalizeUrlProxyInput(""), undefined);
  assertEquals(normalizeUrlProxyInput(999), undefined);
});
