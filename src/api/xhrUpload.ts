import { apiFetchCredentials } from "./apiBase";

function mapCredentials(c: RequestCredentials): boolean {
  return c === "include";
}

/**
 * 预签名 PUT 直传对象存储（跨域、不带 Cookie）。
 */
export function xhrPutBlob(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  opts?: {
    /** 部分环境 lengthComputable 不可靠时用字节数估算 */
    expectedBytes?: number;
    onProgress?: (percent: number) => void;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    for (const [k, v] of Object.entries(headers)) {
      if (v != null && v !== "") xhr.setRequestHeader(k, v);
    }
    const hint = opts?.expectedBytes ?? body.size;
    xhr.upload.onprogress = (ev) => {
      if (!opts?.onProgress) return;
      let pct: number;
      if (ev.lengthComputable && ev.total > 0) {
        pct = Math.min(100, Math.round((100 * ev.loaded) / ev.total));
      } else if (hint > 0) {
        pct = Math.min(100, Math.round((100 * ev.loaded) / hint));
      } else {
        return;
      }
      opts.onProgress(pct);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("网络异常"));
    xhr.send(body);
  });
}

/**
 * 带鉴权头的 POST（如 multipart 头像），与 {@link apiFetchCredentials} 一致。
 */
export function xhrPostWithBody(
  url: string,
  headers: Record<string, string>,
  body: FormData | Blob | string,
  opts?: {
    expectedBytes?: number;
    onProgress?: (percent: number) => void;
  }
): Promise<{ ok: boolean; status: number; responseText: string }> {
  const creds = apiFetchCredentials();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = mapCredentials(creds);
    for (const [k, v] of Object.entries(headers)) {
      const kl = k.toLowerCase();
      if (kl === "content-type") continue;
      if (v != null && v !== "") xhr.setRequestHeader(k, v);
    }
    const hint =
      opts?.expectedBytes ??
      (body instanceof FormData
        ? (() => {
            const f = body.get("file");
            return f instanceof File ? f.size : 0;
          })()
        : body instanceof Blob
          ? body.size
          : typeof body === "string"
            ? new Blob([body]).size
            : 0);
    xhr.upload.onprogress = (ev) => {
      if (!opts?.onProgress) return;
      let pct: number;
      if (ev.lengthComputable && ev.total > 0) {
        pct = Math.min(100, Math.round((100 * ev.loaded) / ev.total));
      } else if (hint > 0) {
        pct = Math.min(100, Math.round((100 * ev.loaded) / hint));
      } else {
        return;
      }
      opts.onProgress(pct);
    };
    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        responseText: xhr.responseText ?? "",
      });
    };
    xhr.onerror = () => reject(new Error("网络异常"));
    xhr.send(body);
  });
}
