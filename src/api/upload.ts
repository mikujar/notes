import { getAdminToken } from "../auth/token";
import type { NoteMediaKind } from "../types";

function apiBase(): string {
  const b = import.meta.env.VITE_API_BASE as string | undefined;
  return b?.replace(/\/$/, "") ?? "";
}

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
};

export async function uploadCardMedia(
  file: File
): Promise<UploadMediaResult> {
  const base = apiBase();
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const j = (await r.json().catch(() => ({}))) as {
    error?: unknown;
    url?: unknown;
    kind?: unknown;
    name?: unknown;
  };
  if (!r.ok) {
    throw new Error(
      typeof j.error === "string" ? j.error : "上传失败"
    );
  }
  if (typeof j.url !== "string" || typeof j.kind !== "string") {
    throw new Error("上传响应无效");
  }
  const kind = j.kind as NoteMediaKind;
  if (
    kind !== "image" &&
    kind !== "video" &&
    kind !== "audio" &&
    kind !== "file"
  ) {
    throw new Error("上传响应无效");
  }
  const out: UploadMediaResult = { url: j.url, kind };
  if (typeof j.name === "string" && j.name.trim()) {
    out.name = j.name;
  }
  return out;
}
