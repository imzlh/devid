import { crypto } from "jsr:@std/crypto";
import { encodeHex } from "jsr:@std/encoding/hex";

/**
 * 图片URL防盗链签名
 * 注意：盐值排序后是固定字符串 "alc0gM2L4b8FKsX1V9J70NGZAExhyk9"
 */
async function signImageUrl(url: string): Promise<string> {
  // 提取路径（含前导斜杠）
  const urlObj = new URL(url);
  const path = urlObj.pathname;  // /data/aaquv2/.../xxx.dat
  
  // 时间戳（秒）
  const timestamp = Math.floor(Date.now() / 1000);
  
  // 两个0-9999随机数
  const rand1 = Math.floor(Math.random() * 10000);
  const rand2 = Math.floor(Math.random() * 10000);
  
  // 固定盐值（已排序后的结果）
  const salt = "alc0gM2L4b8FKsX1V9J70NGZAExhyk9";
  
  // 签名原文：/path/to/file.dat-timestamp-rand1-rand2-salt
  const signSource = `${path}-${timestamp}-${rand1}-${rand2}-${salt}`;
  
  // MD5
  const hashBuffer = await crypto.subtle.digest(
    "MD5", 
    new TextEncoder().encode(signSource)
  );
  const signature = encodeHex(hashBuffer);
  
  // 参数名：t（venTen[3].toLowerCase()）
  return `${url}?t=${timestamp}-${rand1}-${rand2}-${signature}`;
}

// 验证你提供的调试数据
async function verify() {
  const testSource = "/data/aaquv2/wsnbbp.zzyfc.com/ce218/dcc-file/17/172ecdf306174c5fd546d46c32824022.dat-1771323127-9427-9621-alc0gM2L4b8FKsX1V9J70NGZAExhyk9";
  
  const hashBuffer = await crypto.subtle.digest(
    "MD5", 
    new TextEncoder().encode(testSource)
  );
  const md5 = encodeHex(hashBuffer);
  
  console.log("计算MD5:", md5);
  console.log("目标MD5:", "ed399abdbb7dd9069aee839b4d31685d");
  console.log("匹配:", md5 === "ed399abdbb7dd9069aee839b4d31685d");
}

verify();