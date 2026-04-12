import { getAdminToken } from "../auth/token";
import type { NoteMediaKind } from "../types";
import { apiBase, apiFetchInit } from "./apiBase";
import { xhrPutBlob, xhrPutBlobEtag } from "./xhrUpload";

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
  /** 0–100，上传阶段按已上传字节更新；收尾 finalize 期间保持 100 */
  onProgress?: (percent: number) => void;
};

/** 并行分片数（每片独立预签名 PUT） */
const MULTIPART_PARALLEL = 4;

type PresignJson = {
  direct?: unknown;
  multipart?: unknown;
  putUrl?: unknown;
  headers?: Record<string, string>;
  key?: unknown;
  uploadId?: unknown;
  partSize?: unknown;
  partCount?: unknown;
  url?: unknown;
  kind?: unknown;
  name?: unknown;
  contentType?: unknown;
  error?: unknown;
  code?: unknown;
};

async function abortMultipartUpload(
  base: string,
  key: string,
  uploadId: string,
  fileSize: number
) {
  try {
    await fetch(
      `${base}/api/upload/multipart/abort`,
      apiFetchInit({
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, uploadId, fileSize }),
      })
    );
  } catch {
    /* 尽力中止 */
  }
}

async function finalizeAfterUpload(
  base: string,
  key: string,
  kind: NoteMediaKind
): Promise<{ coverUrl?: string; thumbnailUrl?: string }> {
  let coverUrl: string | undefined;
  if (kind === "audio") {
    const fin = await fetch(
      `${base}/api/upload/finalize-audio`,
      apiFetchInit({
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
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

  let thumbnailUrl: string | undefined;
  if (kind === "video") {
    try {
      const fin = await fetch(
        `${base}/api/upload/finalize-video`,
        apiFetchInit({
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ key }),
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

  if (kind === "image") {
    try {
      const fin = await fetch(
        `${base}/api/upload/finalize-image`,
        apiFetchInit({
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ key }),
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

  return { coverUrl, thumbnailUrl };
}

/**
 * 通过 COS 预签名直传上传媒体文件（大于 8MB 时自动分片并行上传）。
 * 若服务端未配置 COS 则抛出错误（不再 fallback 到 multipart form）。
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

  const pj = (await pres.json().catch(() => ({}))) as PresignJson;

  if (!pres.ok) {
    throw new Error(
      typeof pj.error === "string" ? pj.error : "上传预约失败惹，等等再试～"
    );
  }

  if (pj.direct !== true) {
    throw new Error(
      typeof pj.error === "string"
        ? pj.error
        : "附件小仓库今天有点挤，稍候再来贴贴纸～"
    );
  }

  const isMultipart = pj.multipart === true;
  if (!isMultipart && typeof pj.putUrl !== "string") {
    throw new Error(
      typeof pj.error === "string"
        ? pj.error
        : "附件小仓库今天有点挤，稍候再来贴贴纸～"
    );
  }

  if (
    typeof pj.key !== "string" ||
    typeof pj.url !== "string" ||
    !pj.url ||
    typeof pj.kind !== "string"
  ) {
    throw new Error("上传结果怪怪的…刷新下再试？");
  }

  const kind = pj.kind as NoteMediaKind;
  if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "file") {
    throw new Error("上传结果怪怪的…刷新下再试？");
  }

  const key = pj.key;

  if (isMultipart) {
    const uploadId = typeof pj.uploadId === "string" ? pj.uploadId : "";
    const partSize = Number(pj.partSize);
    const partCount = Number(pj.partCount);
    if (
      !uploadId ||
      !Number.isFinite(partSize) ||
      partSize < 1 ||
      !Number.isFinite(partCount) ||
      partCount < 1
    ) {
      throw new Error("分片参数无效，请重试");
    }

    const partProgress = new Float64Array(partCount);
    const emit = () => {
      let sum = 0;
      for (let i = 0; i < partCount; i++) sum += partProgress[i];
      onProgress?.(
        Math.min(100, Math.round((100 * sum) / Math.max(1, file.size)))
      );
    };

    const parts: { PartNumber: number; ETag: string }[] = [];

    async function uploadPart(partIdx: number) {
      const start = partIdx * partSize;
      const end = Math.min(file.size, start + partSize);
      const blob = file.slice(start, end);
      const prs = await fetch(
        `${base}/api/upload/multipart/part-url`,
        apiFetchInit({
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key,
            uploadId,
            partNumber: partIdx + 1,
          }),
        })
      );
      const prj = (await prs.json().catch(() => ({}))) as {
        putUrl?: unknown;
        error?: unknown;
      };
      if (!prs.ok || typeof prj.putUrl !== "string") {
        throw new Error(
          typeof prj.error === "string" ? prj.error : "分片预签名失败"
        );
      }
      const etag = await xhrPutBlobEtag(prj.putUrl, {}, blob, {
        expectedBytes: blob.size,
        onUploadedBytes: (loaded) => {
          partProgress[partIdx] = loaded;
          emit();
        },
      });
      partProgress[partIdx] = blob.size;
      emit();
      parts[partIdx] = { PartNumber: partIdx + 1, ETag: etag };
    }

    let nextPart = 0;
    async function worker() {
      for (;;) {
        const i = nextPart++;
        if (i >= partCount) return;
        await uploadPart(i);
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(MULTIPART_PARALLEL, partCount) }, () =>
          worker()
        )
      );

      const sorted = [...parts].sort(
        (a, b) => a.PartNumber - b.PartNumber
      );

      const comp = await fetch(
        `${base}/api/upload/multipart/complete`,
        apiFetchInit({
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key,
            uploadId,
            parts: sorted,
          }),
        })
      );
      const cj = (await comp.json().catch(() => ({}))) as { error?: unknown };
      if (!comp.ok) {
        throw new Error(
          typeof cj.error === "string" ? cj.error : "分片合并失败"
        );
      }
      onProgress?.(100);
    } catch (err) {
      void abortMultipartUpload(base, key, uploadId, file.size);
      throw err instanceof Error
        ? err
        : new Error("分片上传失败，再试一次好不好？");
    }
  } else {
    const headers: Record<string, string> = { ...(pj.headers ?? {}) };
    try {
      await xhrPutBlob(pj.putUrl as string, headers, file, {
        expectedBytes: file.size,
        onProgress,
      });
    } catch {
      throw new Error("文件上传路上绊了一下，再试一次好不好？");
    }
    onProgress?.(100);
  }

  const { coverUrl, thumbnailUrl } = await finalizeAfterUpload(base, key, kind);

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
