import { getAdminToken } from "../auth/token";
import type { NoteMediaKind } from "../types";
import { apiBase, apiFetchInit } from "./apiBase";
import { xhrPutBlob } from "./xhrUpload";

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
  /** 视频截帧 / 图片 WebP 列表预览（thumbnailUrl） */
  thumbnailUrl?: string;
  /** 主文件大小（写入笔记 JSON 供统计） */
  sizeBytes?: number;
};

export type UploadCardMediaOptions = {
  /** 0–100，预签名 PUT 阶段按已上传字节更新；收尾 finalize 期间保持 100 */
  onProgress?: (percent: number) => void;
};

/**
 * 通过 COS 预签名直传上传媒体文件。
 * 若服务端未配置 COS 则抛出错误（不再 fallback 到 multipart）。
 */
export async function uploadCardMedia(
  file: File,
  options?: UploadCardMediaOptions
): Promise<UploadMediaResult> {
  const onProgress = options?.onProgress;
  const base = apiBase();
  const pres = await fetch(
    `${base}/api/upload/presign`,
    apiFetchInit({
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
    })
  );

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
    throw new Error(
      typeof pj.error === "string" ? pj.error : "上传预约失败惹，等等再试～"
    );
  }

  // 未配置对象存储或 direct !== true
  if (pj.direct !== true || typeof pj.putUrl !== "string") {
    throw new Error(
      typeof pj.error === "string"
        ? pj.error
        : "附件小仓库今天有点挤，稍候再来贴贴纸～"
    );
  }

  // 直传 COS（xhr 以获取真实上传进度）
  const headers: Record<string, string> = { ...(pj.headers ?? {}) };
  try {
    await xhrPutBlob(pj.putUrl, headers, file, {
      expectedBytes: file.size,
      onProgress,
    });
  } catch {
    throw new Error("文件上传路上绊了一下，再试一次好不好？");
  }
  onProgress?.(100);

  const kind = pj.kind as NoteMediaKind;
  if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "file") {
    throw new Error("上传结果怪怪的…刷新下再试？");
  }
  if (typeof pj.url !== "string" || !pj.url) {
    throw new Error("上传结果怪怪的…刷新下再试？");
  }

  // 音频：提取内嵌封面
  let coverUrl: string | undefined;
  if (kind === "audio" && typeof pj.key === "string") {
    const fin = await fetch(
      `${base}/api/upload/finalize-audio`,
      apiFetchInit({
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: pj.key }),
      })
    );
    const fj = (await fin.json().catch(() => ({}))) as {
      coverUrl?: unknown;
      error?: unknown;
    };
    if (!fin.ok) {
      throw new Error(
        typeof fj.error === "string" ? fj.error : "音频封面没抠出来…先听听歌也行～"
      );
    }
    if (typeof fj.coverUrl === "string" && fj.coverUrl.trim()) {
      coverUrl = fj.coverUrl.trim();
    }
  }

  // 视频：服务端截帧生成缩略图（失败不阻断上传，仍可播原片）
  let thumbnailUrl: string | undefined;
  if (kind === "video" && typeof pj.key === "string") {
    try {
      const fin = await fetch(
        `${base}/api/upload/finalize-video`,
        apiFetchInit({
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ key: pj.key }),
        })
      );
      const fj = (await fin.json().catch(() => ({}))) as {
        thumbnailUrl?: unknown;
      };
      if (fin.ok && typeof fj.thumbnailUrl === "string" && fj.thumbnailUrl.trim()) {
        thumbnailUrl = fj.thumbnailUrl.trim();
      }
    } catch {
      /* 忽略：无缩略图时轮播仍用 video 首帧 */
    }
  }

  // 图片：服务端生成 WebP 预览（失败不阻断，列表仍用原图）
  if (kind === "image" && typeof pj.key === "string") {
    try {
      const fin = await fetch(
        `${base}/api/upload/finalize-image`,
        apiFetchInit({
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ key: pj.key }),
        })
      );
      const fj = (await fin.json().catch(() => ({}))) as {
        thumbnailUrl?: unknown;
      };
      if (fin.ok && typeof fj.thumbnailUrl === "string" && fj.thumbnailUrl.trim()) {
        thumbnailUrl = fj.thumbnailUrl.trim();
      }
    } catch {
      /* 忽略 */
    }
  }

  const out: UploadMediaResult = {
    url: pj.url,
    kind,
    sizeBytes: file.size,
  };
  if (typeof pj.name === "string" && pj.name.trim()) {
    out.name = pj.name.trim();
  }
  if (coverUrl) out.coverUrl = coverUrl;
  if (thumbnailUrl) out.thumbnailUrl = thumbnailUrl;
  return out;
}
