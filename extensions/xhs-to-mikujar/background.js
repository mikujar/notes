const REFERER_XHS = "https://www.xiaohongshu.com/";
const REFERER_BILI = "https://www.bilibili.com/";
/** 超过则不上传视频，提示用户自行下载（与分片上传上限无关，避免极慢/失败） */
const MAX_CLIP_VIDEO_BYTES = 150 * 1024 * 1024;

/**
 * MV3：长时间上传时 Service Worker 可能被挂起，导致与 popup 的 runtime.connect 断开。
 * 周期唤醒，避免分片传视频中途被掐断。
 */
function createServiceWorkerKeepAlive() {
  const id = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch {
      /* ignore */
    }
  }, 15000);
  return () => clearInterval(id);
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCardHtml({ title, body }) {
  const paras = body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  return `<p><strong>${escapeHtml(title)}</strong></p>${paras || "<p>（无正文）</p>"}`;
}

function newCustomPropId() {
  return `cp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 与主站 CardProperty 一致：链接、作者；有简介时增加「简介」（B 站投稿）。
 */
function buildClipCustomProps(pageUrl, authorNickname, intro) {
  const url = String(pageUrl || "").trim();
  const author = String(authorNickname || "").trim();
  const introTrim = String(intro ?? "").trim();
  const out = [
    {
      id: newCustomPropId(),
      name: "链接",
      type: "url",
      value: url || null,
    },
    {
      id: newCustomPropId(),
      name: "作者",
      type: "text",
      value: author || null,
    },
  ];
  if (introTrim) {
    out.push({
      id: newCustomPropId(),
      name: "简介",
      type: "text",
      value: introTrim,
    });
  }
  return out;
}

function newCardId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function appendUserId(url, userId) {
  const uid = String(userId || "").trim();
  if (!uid) return url;
  const u = new URL(url);
  u.searchParams.set("userId", uid);
  return u.toString();
}

async function getSettings() {
  const s = await chrome.storage.sync.get([
    "apiBase",
    "bearerToken",
    "userId",
    "collectionId",
    "insertNewNotesAtTop",
  ]);
  const apiBase = String(s.apiBase || "")
    .trim()
    .replace(/\/$/, "");
  const bearerToken = String(s.bearerToken || "").trim();
  const userId = String(s.userId || "").trim();
  const collectionId = String(s.collectionId || "").trim();
  /** 与网页「笔记设置 → 新建笔记位置」一致；未设置时默认顶部（与主站 localStorage 默认相同） */
  const insertNewNotesAtTop = s.insertNewNotesAtTop !== false;
  return { apiBase, bearerToken, userId, collectionId, insertNewNotesAtTop };
}

async function ensureApiPermission(apiBase) {
  let url;
  try {
    url = new URL(apiBase);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const originPattern = `${url.origin}/*`;
  const has = await chrome.permissions.contains({
    origins: [originPattern],
  });
  if (has) return true;
  return chrome.permissions.request({ origins: [originPattern] });
}

/** 把 fetch / HTTP / 常见英文错译成用户可理解的说明 */
function explainNetworkError(err) {
  const msg = String(err?.message || err || "");
  if (/Failed to fetch|NetworkError|network|Load failed|ECONNREFUSED/i.test(msg)) {
    return "网络异常或浏览器拦截了跨域请求（源站 CDN 可能不允许扩展直接拉取）";
  }
  if (/aborted|AbortError/i.test(msg)) {
    return "请求被中断";
  }
  return msg || "未知网络错误";
}

function explainHttpStatus(status) {
  if (status === 401 || status === 403) {
    return `服务器拒绝访问(${status})，链接可能已过期，视频请先点播放再保存`;
  }
  if (status === 404) {
    return `资源不存在(${status})，地址可能已失效`;
  }
  if (status === 416) {
    return `Range 请求不被接受(${status})，可刷新页面后重试`;
  }
  if (status >= 500) {
    return `源站或 CDN 异常(${status})，请稍后重试`;
  }
  return `下载失败(HTTP ${status})`;
}

function explainUploadOrPresignError(message) {
  const m = String(message || "");
  if (/401|Unauthorized|未授权|无效.*token|token/i.test(m)) {
    return "登录凭证无效：请检查扩展选项里的 Token 是否过期";
  }
  if (/403|Forbidden|禁止/.test(m)) {
    return "无权限：Token 或合集权限不足";
  }
  if (/未开启 COS|presign|预签名|direct/.test(m)) {
    return "服务端上传配置异常（预签名/COS）";
  }
  if (/上传 COS|PUT/.test(m)) {
    return "上传到对象存储失败，请稍后重试";
  }
  return m;
}

/** 与主站一致：大于 8MB 走分片；并行度与 src/api/upload.ts 对齐 */
const MULTIPART_PARALLEL = 4;

/** COS 分片 PUT 后读 ETag（需桶 CORS 暴露 ETag） */
async function cosPutPartFetchEtag(putUrl, partBlob) {
  const r = await fetch(putUrl, {
    method: "PUT",
    body: partBlob,
    mode: "cors",
    credentials: "omit",
  });
  if (!r.ok) {
    throw new Error(`分片上传失败 ${r.status}`);
  }
  const etag = r.headers.get("etag");
  if (!etag) {
    throw new Error(
      "分片响应缺少 ETag（请在 COS 控制台为该桶 CORS 增加暴露头 ETag）"
    );
  }
  return etag;
}

async function abortMultipartUpload(apiBase, token, userId, key, uploadId, fileSize) {
  try {
    await fetch(
      appendUserId(`${apiBase}/api/upload/multipart/abort`, userId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, uploadId, fileSize }),
      }
    );
  } catch {
    /* 尽力中止 */
  }
}

/**
 * 大文件分片上传（与 /api/upload/presign 返回 multipart: true 配套）
 */
async function presignAndUploadMultipart(apiBase, token, userId, blob, pj) {
  const key = typeof pj.key === "string" ? pj.key : "";
  const uploadId = typeof pj.uploadId === "string" ? pj.uploadId : "";
  const partSize = Number(pj.partSize);
  const partCount = Number(pj.partCount);
  if (
    !key ||
    !uploadId ||
    !Number.isFinite(partSize) ||
    partSize < 1 ||
    !Number.isFinite(partCount) ||
    partCount < 1
  ) {
    throw new Error(explainUploadOrPresignError("分片参数无效"));
  }

  const parts = /** @type {{ PartNumber: number; ETag: string }[]} */ ([]);
  let nextPart = 0;

  async function uploadOnePart(partIdx) {
    const start = partIdx * partSize;
    const end = Math.min(blob.size, start + partSize);
    const slice = blob.slice(start, end);
    const prs = await fetch(
      appendUserId(`${apiBase}/api/upload/multipart/part-url`, userId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          uploadId,
          partNumber: partIdx + 1,
        }),
      }
    );
    const prj = await prs.json().catch(() => ({}));
    if (!prs.ok || typeof prj.putUrl !== "string") {
      throw new Error(
        explainUploadOrPresignError(
          typeof prj.error === "string" ? prj.error : "分片预签名失败"
        )
      );
    }
    const etag = await cosPutPartFetchEtag(prj.putUrl, slice);
    parts[partIdx] = { PartNumber: partIdx + 1, ETag: etag };
  }

  async function worker() {
    for (;;) {
      const i = nextPart++;
      if (i >= partCount) return;
      await uploadOnePart(i);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(MULTIPART_PARALLEL, partCount) }, () =>
        worker()
      )
    );
  } catch (e) {
    await abortMultipartUpload(apiBase, token, userId, key, uploadId, blob.size);
    throw e;
  }

  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
  const comp = await fetch(
    appendUserId(`${apiBase}/api/upload/multipart/complete`, userId),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key, uploadId, parts: sorted }),
    }
  );
  const cj = await comp.json().catch(() => ({}));
  if (!comp.ok) {
    await abortMultipartUpload(apiBase, token, userId, key, uploadId, blob.size);
    throw new Error(
      explainUploadOrPresignError(
        typeof cj.error === "string" ? cj.error : "分片合并失败"
      )
    );
  }
}

async function fetchAsBlob(imageUrl, referer = REFERER_XHS) {
  const headers = {
    Referer: referer,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
  if (referer === REFERER_BILI) {
    headers.Origin = "https://www.bilibili.com";
  }
  let r;
  try {
    r = await fetch(imageUrl, {
      headers,
      credentials: "omit",
      mode: "cors",
    });
  } catch (e) {
    throw new Error(explainNetworkError(e));
  }
  if (!r.ok) throw new Error(explainHttpStatus(r.status));
  return await r.blob();
}

/**
 * B 站封面：候选须为同一 archive 基准的变体（内容脚本保证）；在 @ 大图与基准间取字节最大。
 * @param {string[]} candidateUrls
 * @param {string} referer
 * @returns {Promise<{ blob: Blob; url: string }>}
 */
async function fetchBilibiliCoverBlobBestOfCandidates(candidateUrls, referer) {
  const list = (candidateUrls || []).filter(
    (u) => typeof u === "string" && u.trim()
  );
  if (!list.length) {
    throw new Error("无封面候选地址");
  }
  let best = null;
  let bestUrl = list[0];
  let bestSize = 0;
  let lastErr = null;
  for (const u of list) {
    try {
      const blob = await fetchAsBlob(u, referer);
      if (blob.size > bestSize) {
        bestSize = blob.size;
        best = blob;
        bestUrl = u;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!best) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr || "封面下载失败"));
  }
  return { blob: best, url: bestUrl };
}

function guessFilename(url, i, prefix = "xhs") {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "";
    if (base && /\.(jpe?g|png|gif|webp)$/i.test(base)) return base;
  } catch {
    /* ignore */
  }
  return `${prefix}-${i + 1}.jpg`;
}

function guessContentType(blob, filename) {
  if (blob.type && blob.type.startsWith("image/")) return blob.type;
  const low = filename.toLowerCase();
  if (low.endsWith(".png")) return "image/png";
  if (low.endsWith(".webp")) return "image/webp";
  if (low.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function guessVideoFilename(url, i, prefix = "xhs") {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "";
    if (base && /\.mp4$/i.test(base.split("?")[0])) return base.split("?")[0];
  } catch {
    /* ignore */
  }
  return `${prefix}-video-${i + 1}.mp4`;
}

function guessVideoContentType(blob, filename) {
  if (blob.type && blob.type.startsWith("video/")) return blob.type;
  const low = filename.toLowerCase();
  if (low.endsWith(".webm")) return "video/webm";
  if (low.endsWith(".mov")) return "video/quicktime";
  if (low.endsWith(".m4s")) return "video/mp4";
  return "video/mp4";
}

/** B 站 DASH 音轨：按文件名推断，便于 presign 走 audio/mp4 → m4a */
function guessBiliDashAudioContentType(blob, filename) {
  if (blob.type && blob.type.startsWith("audio/")) return blob.type;
  const low = filename.toLowerCase();
  if (low.endsWith(".m4a") || low.endsWith(".m4s")) return "audio/mp4";
  if (low.endsWith(".aac")) return "audio/aac";
  return "audio/mp4";
}

async function presignAndUpload(apiBase, token, userId, blob, filename, contentType) {
  const pres = await fetch(appendUserId(`${apiBase}/api/upload/presign`, userId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename,
      contentType,
      fileSize: blob.size,
    }),
  });
  const pj = await pres.json().catch(() => ({}));
  if (!pres.ok) {
    throw new Error(
      explainUploadOrPresignError(pj.error || `预签名失败 ${pres.status}`)
    );
  }
  if (pj.direct !== true) {
    throw new Error(
      explainUploadOrPresignError(pj.error || "服务端未开启 COS 直传")
    );
  }

  /** 与主站一致：大于 8MB 为分片，无 putUrl */
  if (pj.multipart === true) {
    if (
      typeof pj.url !== "string" ||
      !pj.url ||
      typeof pj.kind !== "string"
    ) {
      throw new Error(explainUploadOrPresignError("无效分片上传响应"));
    }
    await presignAndUploadMultipart(apiBase, token, userId, blob, pj);
    return {
      url: pj.url,
      kind: pj.kind || "image",
      name: typeof pj.name === "string" ? pj.name : filename,
    };
  }

  if (typeof pj.putUrl !== "string") {
    throw new Error(
      explainUploadOrPresignError(pj.error || "服务端未开启 COS 直传")
    );
  }
  const putHeaders = { ...(pj.headers || {}) };
  const putRes = await fetch(pj.putUrl, {
    method: "PUT",
    headers: putHeaders,
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(
      explainUploadOrPresignError(`上传 COS 失败 ${putRes.status}`)
    );
  }
  if (typeof pj.url !== "string" || !pj.url) {
    throw new Error(explainUploadOrPresignError("无效上传响应"));
  }
  return {
    url: pj.url,
    kind: pj.kind || "image",
    name: typeof pj.name === "string" ? pj.name : filename,
  };
}

/**
 * B 站 DASH 音画二轨 → 服务端 ffmpeg 无损 mux 为单 MP4（需 API 已部署 /api/upload/merge-bili-dash）。
 */
async function mergeBiliDashOnServer(apiBase, token, userId, videoBlob, audioBlob) {
  const fd = new FormData();
  fd.append("video", videoBlob, "bili-dash-video.mp4");
  fd.append("audio", audioBlob, "bili-dash-audio.m4a");
  const r = await fetch(
    appendUserId(`${apiBase}/api/upload/merge-bili-dash`, userId),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      explainUploadOrPresignError(j.error || `合并接口 ${r.status}`)
    );
  }
  if (typeof j.url !== "string" || !j.url || typeof j.kind !== "string") {
    throw new Error(explainUploadOrPresignError("合并响应无效"));
  }
  return {
    url: j.url,
    kind: j.kind,
    name: typeof j.name === "string" ? j.name : "bilibili-clip.mp4",
    sizeBytes: Number.isFinite(j.sizeBytes)
      ? Math.floor(j.sizeBytes)
      : Math.floor(videoBlob.size + audioBlob.size),
  };
}

async function createCard(apiBase, token, userId, collectionId, card) {
  const r = await fetch(
    appendUserId(
      `${apiBase}/api/collections/${encodeURIComponent(collectionId)}/cards`,
      userId
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(card),
    }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const raw = j.error || `创建笔记失败 ${r.status}`;
    if (r.status === 401 || r.status === 403) {
      throw new Error("无法创建笔记：Token 无效或无写入该合集的权限");
    }
    if (r.status === 404) {
      throw new Error("无法创建笔记：合集不存在或 ID 填错");
    }
    if (r.status >= 500) {
      throw new Error("服务器繁忙，创建笔记失败，请稍后重试");
    }
    throw new Error(String(raw));
  }
  return j;
}

/**
 * 在页面 MAIN world 读取 __playinfo__ / videoData（不能用内联 script：B 站 CSP 会拦截）。
 */
async function collectBiliMainWorldPlaySnapshot(tabId) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const out = { dash: null, bvid: null, cid: null, pic: null };
        try {
          const p = window.__playinfo__;
          if (p?.data?.dash) {
            const dv = p.data.dash.video || [];
            const da = p.data.dash.audio || [];
            out.dash = {
              video: dv.map((v) => ({
                id: v.id,
                bandwidth: v.bandwidth,
                codecid: v.codecid,
                baseUrl: v.baseUrl || v.base_url,
              })),
              audio: da.map((a) => ({
                id: a.id,
                bandwidth: a.bandwidth,
                baseUrl: a.baseUrl || a.base_url,
              })),
            };
          }
        } catch {
          /* ignore */
        }
        try {
          const vd = window.__INITIAL_STATE__?.videoData;
          if (vd) {
            out.bvid = vd.bvid;
            out.cid =
              typeof vd.cid === "number"
                ? vd.cid
                : parseInt(String(vd.cid), 10) || null;
            out.pic =
              vd.pic ||
              vd.cover ||
              (vd.pages && vd.pages[0] && vd.pages[0].pic) ||
              null;
          }
        } catch {
          /* ignore */
        }
        return out;
      },
    });
    return r[0]?.result ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {number} tabId
 * @param {(msg: { type: string, value?: number, text?: string, ok?: boolean, message?: string }) => void} emit
 */
async function runSave(tabId, emit) {
  emit({ type: "progress", value: 5, text: "读取配置…" });
  const settings = await getSettings();
  if (!settings.apiBase || !settings.bearerToken || !settings.collectionId) {
    emit({
      type: "done",
      ok: false,
      message: "请先在「扩展选项」填写 API、Token、合集 ID。",
    });
    return;
  }

  emit({ type: "progress", value: 10, text: "检查 API 访问权限…" });
  const okPerm = await ensureApiPermission(settings.apiBase);
  if (!okPerm) {
    emit({
      type: "done",
      ok: false,
      message: "需要授权访问你的 API 域名；请打开选项页保存一次以触发授权。",
    });
    return;
  }

  emit({ type: "progress", value: 18, text: "抓取页面内容…" });
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    emit({ type: "done", ok: false, message: "无法读取当前标签页。" });
    return;
  }
  const tabUrl = String(tab.url || "");
  const isBili = /bilibili\.com\/video\//i.test(tabUrl);
  const isXhs = /xiaohongshu\.com/i.test(tabUrl);
  const referer = isBili ? REFERER_BILI : REFERER_XHS;

  if (!isBili && !isXhs) {
    emit({
      type: "done",
      ok: false,
      message:
        "当前页面不支持：请在哔哩哔哩投稿页（/video/BV…）或小红书笔记详情页打开后再试。",
    });
    return;
  }

  let scraped;
  const scrapeFailHint = isBili
    ? "无法连接内容脚本：请确认在哔哩哔哩投稿页 (bilibili.com/video/…)，刷新后重试；刚安装扩展需刷新页面。"
    : "无法连接内容脚本：请确认当前是小红书笔记详情页，刷新后重试；若刚安装扩展需刷新页面再点图标。";
  let mainWorldPlay = null;
  if (isBili) {
    try {
      mainWorldPlay = await collectBiliMainWorldPlaySnapshot(tabId);
    } catch {
      mainWorldPlay = null;
    }
  }
  try {
    scraped = await chrome.tabs.sendMessage(
      tabId,
      isBili ? { type: "SCRAPE_BILI", mainWorldPlay } : { type: "SCRAPE" }
    );
  } catch {
    emit({ type: "done", ok: false, message: scrapeFailHint });
    return;
  }

  if (!scraped?.ok) {
    emit({
      type: "done",
      ok: false,
      message:
        scraped?.error ||
        (isBili
          ? "页面抓取失败：请刷新投稿页；若需登录请先登录。"
          : "页面抓取失败：请刷新笔记页；若页面有验证码需先在浏览器里通过验证。"),
    });
    return;
  }

  const {
    title,
    body,
    imageUrls,
    coverFetchCandidates = [],
    videoUrls = [],
    dashUrls,
    pageUrl,
    authorNickname,
    intro = null,
  } = scraped.data;
  const media = [];
  const errors = [];

  const imgs = imageUrls || [];
  const vids = videoUrls || [];
  const dashSlots =
    isBili && dashUrls?.videoUrl ? (dashUrls.audioUrl ? 2 : 1) : 0;
  const totalUploads = imgs.length + dashSlots + vids.length;
  let skipBiliLegacyMp4 = false;
  const uploadSpan = totalUploads > 0 ? 62 : 0;
  const baseAfterScrape = 25;

  function emitStepProgress(stepIndex, label) {
    const pct =
      totalUploads > 0
        ? baseAfterScrape +
          Math.round((uploadSpan * stepIndex) / Math.max(totalUploads, 1))
        : 86;
    emit({
      type: "progress",
      value: Math.min(pct, 85),
      text: label,
    });
  }

  for (let i = 0; i < imgs.length; i++) {
    const url = imgs[i];
    emitStepProgress(i, `图片 ${i + 1} / ${imgs.length}…`);
    try {
      let blob;
      let pickedUrl = url;
      if (
        isBili &&
        i === 0 &&
        Array.isArray(coverFetchCandidates) &&
        coverFetchCandidates.length > 0
      ) {
        const picked = await fetchBilibiliCoverBlobBestOfCandidates(
          coverFetchCandidates,
          referer
        );
        blob = picked.blob;
        pickedUrl = picked.url;
      } else {
        blob = await fetchAsBlob(url, referer);
      }
      if (blob.size < 200) {
        errors.push(
          `图${i + 1}：下载结果过小(${blob.size}B)，可能是防盗链或地址无效`
        );
        continue;
      }
      const filename = guessFilename(pickedUrl, i, isBili ? "bili" : "xhs");
      const contentType = guessContentType(blob, filename);
      const up = await presignAndUpload(
        settings.apiBase,
        settings.bearerToken,
        settings.userId,
        blob,
        filename,
        contentType
      );
      media.push({
        url: up.url,
        kind: up.kind === "video" ? "video" : "image",
        name: up.name || filename,
        /** 与主站一致，供「所有附件」等展示体积；缺省则 UI 为 – */
        sizeBytes: Math.floor(blob.size),
      });
    } catch (e) {
      errors.push(`图${i + 1}：${e?.message || e}`);
    }
  }

  if (isBili && dashUrls?.videoUrl) {
    const dStep0 = imgs.length;
    emitStepProgress(dStep0, "B 站 DASH：下载画面轨…");
    /** @type {Blob | null} */
    let dashVideoBlob = null;
    /** @type {Blob | null} */
    let dashAudioBlob = null;
    try {
      dashVideoBlob = await fetchAsBlob(dashUrls.videoUrl, referer);
      if (dashVideoBlob.size < 2048) {
        errors.push(
          `DASH 画面轨：文件过小(${dashVideoBlob.size}B)，链接可能失效，请先播放几秒再试`
        );
        dashVideoBlob = null;
      } else if (dashVideoBlob.size > MAX_CLIP_VIDEO_BYTES) {
        const mb = Math.round(dashVideoBlob.size / (1024 * 1024));
        errors.push(
          `DASH 画面轨：约 ${mb}MB，超过上传上限（${Math.round(
            MAX_CLIP_VIDEO_BYTES / (1024 * 1024)
          )}MB）`
        );
        dashVideoBlob = null;
      }
    } catch (e) {
      errors.push(`DASH 画面轨：${e?.message || e}`);
    }

    if (dashUrls.audioUrl && dashVideoBlob) {
      emitStepProgress(dStep0 + 1, "B 站 DASH：下载音轨…");
      try {
        dashAudioBlob = await fetchAsBlob(dashUrls.audioUrl, referer);
        if (dashAudioBlob.size < 500) {
          errors.push(
            `DASH 音轨：文件过小(${dashAudioBlob.size}B)，可能未返回独立音轨`
          );
          dashAudioBlob = null;
        } else if (dashAudioBlob.size > MAX_CLIP_VIDEO_BYTES) {
          const mb = Math.round(dashAudioBlob.size / (1024 * 1024));
          errors.push(
            `DASH 音轨：约 ${mb}MB，超过上传上限（${Math.round(
              MAX_CLIP_VIDEO_BYTES / (1024 * 1024)
            )}MB）`
          );
          dashAudioBlob = null;
        }
      } catch (e) {
        errors.push(`DASH 音轨：${e?.message || e}`);
      }
    }

    if (dashVideoBlob) {
      let dashHandled = false;
      if (dashAudioBlob) {
        emitStepProgress(dStep0 + 1, "B 站 DASH：服务端合并音画…");
        try {
          const upM = await mergeBiliDashOnServer(
            settings.apiBase,
            settings.bearerToken,
            settings.userId,
            dashVideoBlob,
            dashAudioBlob
          );
          media.push({
            url: upM.url,
            kind: upM.kind === "video" ? "video" : "image",
            name: upM.name,
            sizeBytes: upM.sizeBytes,
          });
          dashHandled = true;
          skipBiliLegacyMp4 = true;
        } catch (mergeErr) {
          errors.push(
            `DASH 合并：${mergeErr?.message || mergeErr}；已改为分轨上传。`
          );
        }
      }
      if (!dashHandled) {
        try {
          const vfn = "bili-dash-video.mp4";
          const upV = await presignAndUpload(
            settings.apiBase,
            settings.bearerToken,
            settings.userId,
            dashVideoBlob,
            vfn,
            "video/mp4"
          );
          media.push({
            url: upV.url,
            kind: upV.kind === "video" ? "video" : "image",
            name: upV.name || vfn,
            sizeBytes: Math.floor(dashVideoBlob.size),
          });
          skipBiliLegacyMp4 = true;
        } catch (e) {
          errors.push(`DASH 画面轨：${e?.message || e}`);
        }
        if (dashAudioBlob) {
          try {
            const afn = "bili-dash-audio.m4a";
            const act = guessBiliDashAudioContentType(dashAudioBlob, afn);
            const upA = await presignAndUpload(
              settings.apiBase,
              settings.bearerToken,
              settings.userId,
              dashAudioBlob,
              afn,
              act
            );
            media.push({
              url: upA.url,
              kind:
                upA.kind === "audio"
                  ? "audio"
                  : upA.kind === "video"
                    ? "video"
                    : "file",
              name: upA.name || afn,
              sizeBytes: Math.floor(dashAudioBlob.size),
            });
          } catch (e) {
            errors.push(`DASH 音轨：${e?.message || e}`);
          }
        }
      }
    }
  }

  for (let j = 0; j < vids.length; j++) {
    const url = vids[j];
    emitStepProgress(
      imgs.length + dashSlots + j,
      skipBiliLegacyMp4
        ? `跳过缓存 MP4（已用 DASH） ${j + 1} / ${vids.length}…`
        : `视频 ${j + 1} / ${vids.length}（大文件请稍候）…`
    );
    if (skipBiliLegacyMp4) continue;
    try {
      const blob = await fetchAsBlob(url, referer);
      if (blob.size < 4096) {
        errors.push(
          `视频${j + 1}：文件过小(${blob.size}B)，多半未拉到真实 mp4；请先在页内播放几秒再保存，或当前为 m3u8 流（扩展仅支持直链 mp4）`
        );
        continue;
      }
      if (blob.size > MAX_CLIP_VIDEO_BYTES) {
        const mb = Math.round(blob.size / (1024 * 1024));
        errors.push(
          `视频${j + 1}：约 ${mb}MB，超过扩展上传上限（${Math.round(
            MAX_CLIP_VIDEO_BYTES / (1024 * 1024)
          )}MB），请自行下载后从网页版添加附件`
        );
        continue;
      }
      const filename = guessVideoFilename(url, j, isBili ? "bili" : "xhs");
      const contentType = guessVideoContentType(blob, filename);
      const up = await presignAndUpload(
        settings.apiBase,
        settings.bearerToken,
        settings.userId,
        blob,
        filename,
        contentType
      );
      media.push({
        url: up.url,
        kind: up.kind === "video" ? "video" : "image",
        name: up.name || filename,
        sizeBytes: Math.floor(blob.size),
      });
    } catch (e) {
      errors.push(`视频${j + 1}：${e?.message || e}`);
    }
  }

  emit({ type: "progress", value: 90, text: "创建笔记…" });
  const now = new Date();
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const card = {
    id: newCardId(),
    text: buildCardHtml({ title, body }),
    minutesOfDay,
    addedOn: todayYMD(),
    tags: [],
    customProps: buildClipCustomProps(pageUrl, authorNickname, intro),
    media,
    insertAtStart: settings.insertNewNotesAtTop,
  };

  try {
    await createCard(
      settings.apiBase,
      settings.bearerToken,
      settings.userId,
      settings.collectionId,
      card
    );
    const nImg = media.filter((m) => m.kind === "image").length;
    const nVid = media.filter((m) => m.kind === "video").length;
    const nAud = media.filter((m) => m.kind === "audio").length;
    let msg;
    const errTail =
      errors.length > 0
        ? (() => {
            const shown = errors.slice(0, 2).join("；");
            const more =
              errors.length > 2 ? ` …共 ${errors.length} 项附件未成功。` : "";
            return ` ${shown}${more}`;
          })()
        : "";
    if (media.length > 0) {
      const parts = [];
      if (nImg) parts.push(`${nImg} 张图`);
      if (nVid) parts.push(`${nVid} 个视频`);
      if (nAud) parts.push(`${nAud} 段音频`);
      msg = `成功：正文已保存，${parts.join("、")}。`;
      if (errors.length > 0) {
        msg += `部分附件失败：${errTail.trim()}`;
      }
    } else if (errors.length > 0) {
      msg = `成功：正文已保存；全部附件未成功。${errTail.trim()}`;
    } else {
      msg = isBili
        ? "成功：正文与属性已保存。未上传视频：请先登录并在页内播放几秒；若仍失败可刷新后再试（扩展会尝试 DASH 与缓存 MP4）。"
        : "成功：正文已保存。未检测到可上传的图片/视频（视频请先播放几秒；纯图文笔记无视频属正常）。";
    }
    emit({ type: "progress", value: 100, text: msg });
    emit({ type: "done", ok: true, message: msg });
  } catch (e) {
    emit({
      type: "done",
      ok: false,
      message: String(e?.message || e),
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "clip-save" && port.name !== "xhs-save") return;
  const emit = (data) => {
    try {
      port.postMessage(data);
    } catch {
      /* popup 已关闭 */
    }
  };
  port.onMessage.addListener((msg) => {
    if (msg?.type !== "start" || typeof msg.tabId !== "number") return;
    void (async () => {
      const stopKeepAlive = createServiceWorkerKeepAlive();
      try {
        await runSave(msg.tabId, emit);
      } catch (e) {
        let text = String(e?.message || e);
        if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
          text = explainNetworkError(e);
        }
        emit({ type: "done", ok: false, message: `处理异常：${text}` });
      } finally {
        stopKeepAlive();
      }
    })();
  });
});
