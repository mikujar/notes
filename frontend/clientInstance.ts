/**
 * 浏览器标签页粒度的客户端实例 ID。
 * 用于 SSE 自我识别:本标签页发起的写操作,后端推 SSE 时带回此 ID,
 * 收到后跳过"全树重拉"(避免闪回旧数据)。
 *
 * 不持久化:刷新页面 = 新 ID = 与服务端"已知此页"无关,这正是我们想要的。
 */

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: 14-char hex(36 位熵足够)
  const arr = new Uint8Array(7);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const CLIENT_INSTANCE_ID = generateId();

/** 写操作请求时附带的 HTTP header,后端 notifyCollectionsSync 会读取并塞回 SSE payload */
export const CLIENT_INSTANCE_HEADER = "X-Client-Instance-Id";
