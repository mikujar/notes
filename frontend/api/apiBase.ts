import { Capacitor } from "@capacitor/core";
import { authUsesHttpOnlyCookie } from "../auth/token";
import { getAppDataMode } from "../appDataModeStorage";
import { CLIENT_INSTANCE_HEADER, CLIENT_INSTANCE_ID } from "../clientInstance";

/** Tauri 未配置 `VITE_API_BASE` 时的默认云端 API */
export const DEFAULT_TAURI_REMOTE_API =
  "https://notes-production-b59f.up.railway.app";

/**
 * 云端 API 根（不受「本地/云端数据模式」影响），供登录、/me 等鉴权请求使用。
 */
/** Tauri / Capacitor 等原生壳内无 Vite 代理，须直连绝对 API 地址 */
function isNativeWebViewShell(): boolean {
  return (
    (typeof __TAURI_BUILD__ !== "undefined" && __TAURI_BUILD__) ||
    Capacitor.isNativePlatform()
  );
}

function remoteApiBaseResolved(): string {
  const b = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (b) return b.replace(/\/$/, "");
  if (isNativeWebViewShell()) {
    const override = (
      import.meta.env.VITE_TAURI_API_PORT as string | undefined
    )?.trim();
    if (
      (typeof __TAURI_BUILD__ !== "undefined" && __TAURI_BUILD__) &&
      override &&
      /^\d+$/.test(override)
    ) {
      return `http://127.0.0.1:${override}`;
    }
    return DEFAULT_TAURI_REMOTE_API.replace(/\/$/, "");
  }
  return "";
}

/** 与 {@link apiBase} 相同，但本地数据模式下仍返回云端根地址，用于校验会话、避免误清 token */
export function remoteApiBase(): string {
  return remoteApiBaseResolved();
}

/**
 * API 根地址（无尾部斜杠）。
 * - **本地数据模式**：不连远程（返回 `""`；笔记读写走本地存储）。
 * - **云端数据模式** + `VITE_API_BASE`：优先使用该地址（Vercel 等）。
 * - **云端数据模式** + Tauri / Capacitor 原生且未配 `VITE_API_BASE`：`DEFAULT_TAURI_REMOTE_API`。
 * - **云端数据模式** + 浏览器开发：`""`，走 Vite 对 `/api`、`/uploads` 的代理。
 */
export function apiBase(): string {
  if (getAppDataMode() === "local") return "";
  return remoteApiBaseResolved();
}

/**
 * 仅当启用 `VITE_AUTH_HTTPONLY_COOKIE` 时跨域请求才 `include`（须服务端 CORS `credentials: true`）。
 * 默认用 Bearer + localStorage 时用 `omit`，避免要求 `Access-Control-Allow-Credentials`（与未配全的 CORS 兼容）。
 * 走 Vite 同源 `/api` 代理时为 `same-origin`。
 */
export function apiFetchCredentials(): RequestCredentials {
  const raw = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  const absoluteRemote =
    (raw && /^https?:\/\//i.test(raw)) || isNativeWebViewShell();
  if (!absoluteRemote) return "same-origin";
  if (authUsesHttpOnlyCookie()) return "include";
  return "omit";
}

/** 合并 fetch 第二参数，默认带上 {@link apiFetchCredentials} 与客户端实例 header(写操作) */
export function apiFetchInit(extra?: RequestInit): RequestInit {
  const method = (extra?.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const headers: Record<string, string> = {
    ...((extra?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (isWrite && !headers[CLIENT_INSTANCE_HEADER]) {
    headers[CLIENT_INSTANCE_HEADER] = CLIENT_INSTANCE_ID;
  }
  return {
    ...extra,
    credentials: extra?.credentials ?? apiFetchCredentials(),
    headers,
  };
}
