/**
 * COS 私有读：预签名 URL 每次换参，浏览器 HTTP 缓存难命中。
 * 对「整文件体积可接受」的资源拉取一次后以稳定键写入 IndexedDB，下次直接 blob: 展示。
 * 视频等大文件仍用预签名直链流式加载，避免整文件进内存/IDB。
 */
import { resolveCosMediaUrlIfNeeded } from "./api/auth";

const DB_NAME = "mikujar-media-blobs";
const DB_VER = 1;
const STORE = "blobs";
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

const sessionBlobUrl = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** 与 {@link resolveCosMediaDisplayWithPersistentCache} 使用同一键（经 {@link resolveMediaUrl} 后的稳定 URL） */
export function getSessionCachedBlobUrl(
  stableResolvedUrl: string
): string | undefined {
  return sessionBlobUrl.get(stableResolvedUrl);
}

function isProbablyLargeVideo(stableUrl: string): boolean {
  return /\.(mp4|webm|m4v|mov|mkv|avi)(\?|#|$)/i.test(stableUrl);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

async function idbGet(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDb();
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(blob, key);
    });
  } catch {
    /* 配额满或隐私模式：静默跳过 */
  }
}

async function resolveInner(stableResolvedUrl: string): Promise<string> {
  const cached = await idbGet(stableResolvedUrl);
  if (cached) {
    const u = URL.createObjectURL(cached);
    sessionBlobUrl.set(stableResolvedUrl, u);
    return u;
  }

  const presigned = await resolveCosMediaUrlIfNeeded(stableResolvedUrl);

  if (isProbablyLargeVideo(stableResolvedUrl)) {
    return presigned;
  }

  let useStreamOnly = false;
  try {
    const head = await fetch(presigned, { method: "HEAD", mode: "cors" });
    const ct = head.headers.get("Content-Type") || "";
    const cl = head.headers.get("Content-Length");
    const n = cl ? parseInt(cl, 10) : NaN;
    if (ct.startsWith("video/")) {
      useStreamOnly = !Number.isFinite(n) || n > MAX_CACHE_BYTES;
    } else if (Number.isFinite(n) && n > MAX_CACHE_BYTES) {
      useStreamOnly = true;
    }
  } catch {
    /* HEAD 不可用：宁可走直链，避免未知体积时整文件 GET */
    useStreamOnly = isProbablyLargeVideo(stableResolvedUrl);
  }

  if (useStreamOnly) {
    return presigned;
  }

  const res = await fetch(presigned, { mode: "cors" });
  if (!res.ok) {
    return presigned;
  }
  const blob = await res.blob();
  if (blob.size > MAX_CACHE_BYTES) {
    const u = URL.createObjectURL(blob);
    sessionBlobUrl.set(stableResolvedUrl, u);
    return u;
  }
  await idbPut(stableResolvedUrl, blob);
  const u = URL.createObjectURL(blob);
  sessionBlobUrl.set(stableResolvedUrl, u);
  return u;
}

/**
 * 将「需换签的 COS 媒体」解析为可用于 img/video 的 src：
 * 优先会话内 blob URL → IndexedDB → 网络拉取；大视频仅返回预签名 URL。
 */
export async function resolveCosMediaDisplayWithPersistentCache(
  stableResolvedUrl: string
): Promise<string> {
  const hitMem = sessionBlobUrl.get(stableResolvedUrl);
  if (hitMem) {
    return hitMem;
  }

  let p = inflight.get(stableResolvedUrl);
  if (!p) {
    p = resolveInner(stableResolvedUrl);
    inflight.set(stableResolvedUrl, p);
    void p.finally(() => {
      inflight.delete(stableResolvedUrl);
    });
  }
  return p;
}
