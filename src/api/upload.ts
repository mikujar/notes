import { getAdminToken } from "../auth/token";
import type { NoteMediaKind } from "../types";
import { apiBase } from "./apiBase";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const admin = getAdminToken();
  if (admin) h.Authorization = `Bearer ${admin}`;
  else {
    const t = (import.meta.env.VITE_API_TOKEN as string | undefined)?.trim();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

export type UploadMediaResult = {
  url: string;
  kind: NoteMediaKind;
  name?: string;
  /** 音频内嵌封面 */
  coverUrl?: string;
};

/**
 * 通过 COS 预签名直传上传媒体文件。
 * 若服务端未配置 COS 则抛出错误（不再 fallback 到 multipart）。
 */
export async function uploadCardMedia(file: File): Promise<UploadMediaResult> {
  const base = apiBase();
  const pres = await fetch(`${base}/api/upload/presign`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
    }),
  });

  const pj = (await pres.json().catch(() => ({}))) as {
    direct?: unknown;
    putUrl?: unknown;
    headers?: Record<string, string>;
    key?: unknown;
    url?: unknown;
    kind?: unknown;
    name?: unknown;
    error?: unknown;
    code?: unknown;
  };

  if (!pres.ok) {
    throw new Error(typeof pj.error === "string" ? pj.error : "预签名失败");
  }

  // COS 未配置或 direct !== true：直接报错，不再 fallback 到 multipart
  if (pj.direct !== true || typeof pj.putUrl !== "string") {
    throw new Error(
      typeof pj.error === "string"
        ? pj.error
        : "当前服务端未配置对象存储（COS），无法上传媒体文件"
    );
  }

  // 直传 COS
  const headers: Record<string, string> = { ...(pj.headers ?? {}) };
  const putRes = await fetch(pj.putUrl, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`直传对象存储失败（HTTP ${putRes.status}）`);
  }

  const kind = pj.kind as NoteMediaKind;
  if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "file") {
    throw new Error("上传响应无效");
  }
  if (typeof pj.url !== "string" || !pj.url) {
    throw new Error("上传响应无效");
  }

  // 音频：提取内嵌封面
  let coverUrl: string | undefined;
  if (kind === "audio" && typeof pj.key === "string") {
    const fin = await fetch(`${base}/api/upload/finalize-audio`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: pj.key }),
    });
    const fj = (await fin.json().catch(() => ({}))) as {
      coverUrl?: unknown;
      error?: unknown;
    };
    if (!fin.ok) {
      throw new Error(typeof fj.error === "string" ? fj.error : "音频封面处理失败");
    }
    if (typeof fj.coverUrl === "string" && fj.coverUrl.trim()) {
      coverUrl = fj.coverUrl.trim();
    }
  }

  const out: UploadMediaResult = { url: pj.url, kind };
  if (typeof pj.name === "string" && pj.name.trim()) {
    out.name = pj.name.trim();
  }
  if (coverUrl) out.coverUrl = coverUrl;
  return out;
}
