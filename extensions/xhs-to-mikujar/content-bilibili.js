/**
 * 哔哩哔哩投稿页（/video/BV…）摘录。
 * 与小红书 content 一样在 isolated world，无法读页面 JS 变量，依赖 meta + 内联 JSON 片段 + DOM 兜底。
 */
function textOf(el) {
  return el?.innerText?.trim() || "";
}

function metaProp(prop) {
  return (
    document
      .querySelector(`meta[property="${prop}"]`)
      ?.getAttribute("content")
      ?.trim() || ""
  );
}

function metaName(name) {
  return (
    document
      .querySelector(`meta[name="${name}"]`)
      ?.getAttribute("content")
      ?.trim() || ""
  );
}

/** B 站常见 //i0.hdslb.com/...，扩展与 fetch 需要绝对 URL */
function normalizeHttpUrl(raw) {
  let s = String(raw || "").trim();
  if (!s || /^blob:/i.test(s)) return "";
  if (s.startsWith("//")) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) return "";
  return s;
}

function isBilibiliImageCdnHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return /(?:^|\.)hdslb\.com$/.test(h) || /(?:^|\.)biliimg\.com$/.test(h);
}

/**
 * 投稿封面应落在 archive/story/pgc 等；`bfs/face`、feedface 等与作者头像同源，不可当封面。
 * @param {string} url 已 normalize 的绝对 URL
 */
function isBilibiliVideoCoverAssetUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!isBilibiliImageCdnHost(u.hostname)) return false;
    const path = u.pathname.toLowerCase();
    if (/\/bfs\/face\b|\/bfs\/feedface\b|\/bfs\/noface\b/i.test(path))
      return false;
    if (/\/bfs\/archive\//.test(path)) return true;
    if (/\/bfs\/story\//.test(path)) return true;
    if (/\/bfs\/(pgc|bangumi)\//.test(path)) return true;
    if (
      /\/bfs\/static\//.test(path) &&
      !/(face|avatar|emoji|icon|\/nav\/)/i.test(path)
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * CDN 常在扩展名后加 @100w_100h_1c.png、@.webp、@57h_1c 等处理段；去掉整段 @… 再拉原档。
 * 与 Bilibili-Evolved / 社区约定一致：hdslb、biliimg 上 `.(jpg|png|…)@…` 多为缩放图。
 */
function stripBilibiliCdnImageProcessorSuffix(url) {
  const s = String(url || "").trim();
  if (!s) return s;
  let host = "";
  try {
    host = new URL(s).hostname;
  } catch {
    return s;
  }
  if (!isBilibiliImageCdnHost(host)) return s;
  const qIdx = s.indexOf("?");
  const query = qIdx === -1 ? "" : s.slice(qIdx);
  let pathPart = qIdx === -1 ? s : s.slice(0, qIdx);
  let prev = "";
  while (prev !== pathPart) {
    prev = pathPart;
    pathPart = pathPart.replace(
      /(\.(?:jpe?g|png|gif|webp|avif))(?:@[^?#/]*)+$/i,
      "$1"
    );
  }
  return pathPart + query;
}

/**
 * 得到干净封面地址：去 @ 处理段、去 query/hash（bfs 静态资源上的 ? 常为缩略参数）。
 */
function polishBilibiliCoverUrl(raw) {
  let n = normalizeHttpUrl(raw);
  if (!n) return "";
  n = stripBilibiliCdnImageProcessorSuffix(n);
  try {
    const u = new URL(n);
    if (!isBilibiliImageCdnHost(u.hostname)) return n;
    if (!/\/bfs\//i.test(u.pathname)) return n;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return n;
  }
}

/** 按来源优先级收集互不重复的 polish 后 URL（靠前的优先尝试下载）。 */
function bilibiliUniquePolishesInPriorityOrder(rawList) {
  const seen = new Set();
  const out = [];
  for (const raw of rawList) {
    const p = polishBilibiliCoverUrl(typeof raw === "string" ? raw : "");
    if (!p || seen.has(p)) continue;
    if (!isBilibiliVideoCoverAssetUrl(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Evolved「高清图」思路：在已去 @ 的基准 URL 上再请求大尺寸 CDN 变体，取体积最大者更接近原图。
 */
function bilibiliCoverFetchCandidateUrls(polishedPrimary) {
  const p = String(polishedPrimary || "").trim();
  const out = [];
  if (!p || !isBilibiliVideoCoverAssetUrl(p)) return out;
  out.push(p);
  try {
    const u = new URL(p);
    if (!isBilibiliImageCdnHost(u.hostname)) return out;
    if (!/\/bfs\//i.test(u.pathname)) return out;
    if (/@/i.test(u.pathname)) return out;
    if (!/\.(?:jpe?g|png|gif|webp|avif)$/i.test(u.pathname)) return out;
    const baseNoQuery = `${u.origin}${u.pathname}`;
    const variants = [
      `${baseNoQuery}@4096w_4096h_1e_1c.webp`,
      `${baseNoQuery}@3840w_2160h_1e_1c.webp`,
      `${baseNoQuery}@1920w_1080h_1e_1c.webp`,
    ];
    for (const v of variants) {
      if (!out.includes(v)) out.push(v);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function imgUrlFromEl(el) {
  if (!el) return "";
  if (el.tagName === "IMG" || el.tagName === "img") {
    return (
      normalizeHttpUrl(el.getAttribute("src")) ||
      normalizeHttpUrl(el.getAttribute("data-src")) ||
      normalizeHttpUrl(el.src)
    );
  }
  if (el.tagName === "SOURCE" || el.tagName === "source") {
    return (
      normalizeHttpUrl(el.getAttribute("src")) ||
      normalizeHttpUrl(
        el.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0]
      )
    );
  }
  return "";
}

/**
 * 新版详情常为 desc_v2：JSON 串或对象数组，分段里多为 raw_text。
 * @param {unknown} raw
 */
function bilibiliDecodeDescV2(raw) {
  if (raw == null) return "";
  let arr = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return "";
    try {
      arr = JSON.parse(s);
    } catch {
      return s;
    }
  }
  if (!Array.isArray(arr)) return "";
  const parts = [];
  for (const seg of arr) {
    if (!seg || typeof seg !== "object") continue;
    if (typeof seg.raw_text === "string") parts.push(seg.raw_text);
    else if (typeof seg.text === "string") parts.push(seg.text);
  }
  return parts.join("").trim();
}

/** 多路简介合并：取最长非空串，避免接口偶发空串时丢掉更长的内联 desc */
function bilibiliPickLongestDescription(...candidates) {
  let best = "";
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s.length > best.length) best = s;
  }
  return best;
}

/** 从含 videoData 的内联脚本里抽 title / desc / owner.name / pic（截取片段后正则，避免嵌套 {} 匹配失败） */
function scrapeFromInlineVideoJson() {
  let title = "";
  let desc = "";
  let author = "";
  let pic = "";
  let bvid = "";
  let cid = 0;
  for (const script of document.querySelectorAll("script:not([src])")) {
    const t = script.textContent || "";
    if (t.length < 200 || t.length > 2_500_000) continue;
    const idx = t.indexOf('"videoData"');
    if (idx === -1) continue;
    /** 简介可能很长且排在 JSON 后部；过小切片会截断字符串导致正则只匹配到残缺或误匹配嵌套里较短的 desc */
    const chunk = t.slice(idx, idx + 800_000);

    const mTitle = chunk.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mTitle?.[1]) {
      title = mTitle[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .trim();
    }
    /** 同一段里可能出现多处 "desc"（分 P、字幕等）；取解码后最长的一条作为主简介 */
    let bestDescLen = 0;
    for (const mDesc of chunk.matchAll(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      if (!mDesc?.[1]) continue;
      const decoded = mDesc[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .trim();
      if (decoded.length > bestDescLen) {
        bestDescLen = decoded.length;
        desc = decoded;
      }
    }
    const ownerIdx = chunk.indexOf('"owner"');
    if (ownerIdx !== -1) {
      const ownerChunk = chunk.slice(ownerIdx, ownerIdx + 8000);
      const mOwner = ownerChunk.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (mOwner?.[1]) {
        author = mOwner[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, " ")
          .trim();
      }
    }
    /** 封面：只认 archive/story/pgc 等；勿用「含 hdslb」宽泛条件，否则会命中 owner 的 bfs/face 头像 */
    for (const mPic of chunk.matchAll(/"pic"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const u = normalizeHttpUrl(mPic[1].replace(/\\"/g, '"').trim());
      if (!u || !isBilibiliVideoCoverAssetUrl(u)) continue;
      pic = u;
      break;
    }
    if (!pic) {
      const mPic = chunk.match(/"pic"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (mPic?.[1]) {
        const u = normalizeHttpUrl(mPic[1].replace(/\\"/g, '"').trim());
        if (u && isBilibiliVideoCoverAssetUrl(u)) pic = u;
      }
    }
    if (!pic) {
      const mCover = chunk.match(/"cover"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (mCover?.[1]) {
        const u = normalizeHttpUrl(mCover[1].replace(/\\"/g, '"').trim());
        if (u && isBilibiliVideoCoverAssetUrl(u)) pic = u;
      }
    }
    const mb = chunk.match(/"bvid"\s*:\s*"(BV[0-9A-Za-z]+)"/);
    if (mb?.[1]) bvid = mb[1];
    const mc = chunk.match(/"cid"\s*:\s*(\d+)/);
    if (mc?.[1]) {
      const n = parseInt(mc[1], 10);
      if (Number.isFinite(n) && n > 0) cid = n;
    }
    if (title || desc || author || pic || bvid || cid) break;
  }
  return { title, desc, author, pic, bvid, cid };
}

function scrapeAuthorDom() {
  const sels = [
    ".up-name",
    "a.up-name",
    ".username",
    '[class*="up-name"]',
    "a[name]",
    ".video-info-meta .name",
  ];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    const t = textOf(el);
    if (t && t.length <= 64) return t;
  }
  return "";
}

function scrapeCoverFromLdJson() {
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    let text = script.textContent?.trim() || "";
    if (!text) continue;
    try {
      const j = JSON.parse(text);
      const nodes = Array.isArray(j) ? j : [j];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const cand =
          node.thumbnailUrl ||
          node.image ||
          (Array.isArray(node.image) ? node.image[0] : null);
        const u =
          typeof cand === "string"
            ? cand
            : cand?.url || cand?.["@id"] || "";
        const out = normalizeHttpUrl(u);
        if (out && isBilibiliVideoCoverAssetUrl(out)) return out;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

function scrapeCoverDom() {
  for (const v of document.querySelectorAll("video")) {
    const poster = normalizeHttpUrl(v.getAttribute("poster"));
    if (poster && isBilibiliVideoCoverAssetUrl(poster)) return poster;
  }

  const linkHref = normalizeHttpUrl(
    document.querySelector('link[rel="image_src"]')?.getAttribute("href")
  );
  if (linkHref && isBilibiliVideoCoverAssetUrl(linkHref)) return linkHref;

  const metaCandidates = [
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
  ];
  for (const sel of metaCandidates) {
    const u = normalizeHttpUrl(document.querySelector(sel)?.getAttribute("content"));
    if (u && isBilibiliVideoCoverAssetUrl(u)) return u;
  }

  const imgSelectors = [
    ".video-cover img",
    ".bilibili-player-video-cover img",
    ".bpx-player-primary-area .b-img img",
    ".bpx-player-primary-area img[src*='bfs/archive']",
    ".bpx-player-state-wrap img",
    '[class*="video-cover"] img',
    ".archive-cover img",
    "img[src*='bfs/archive']",
    "img[src*='hdslb.com/bfs/archive']",
    "picture source[src*='bfs/archive']",
  ];
  for (const sel of imgSelectors) {
    const el = document.querySelector(sel);
    const u = imgUrlFromEl(el);
    if (u && isBilibiliVideoCoverAssetUrl(u)) return u;
  }

  /** 兜底：页内首张看起来像投稿封面的图 */
  for (const img of document.querySelectorAll("img[src], img[data-src]")) {
    const u = imgUrlFromEl(img);
    if (!u || u.length < 40) continue;
    if (!/hdslb\.com\/bfs\/(archive|static)/i.test(u)) continue;
    if (/face|avatar|emoji|icon/i.test(u)) continue;
    return u;
  }
  return "";
}

function mp4CanonicalKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return url;
  }
}

function collectPerformanceMp4Urls() {
  const out = [];
  const seen = new Set();
  try {
    const entries = performance.getEntriesByType("resource");
    for (const e of entries) {
      const name = e.name || "";
      if (!/\.mp4(\?|#|$)/i.test(name)) continue;
      if (!/^https?:\/\//i.test(name)) continue;
      const key = mp4CanonicalKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function collectVideoElementMp4Urls() {
  const out = [];
  const seen = new Set();
  for (const v of document.querySelectorAll("video")) {
    const src =
      v.currentSrc ||
      v.getAttribute("src") ||
      v.querySelector("source[src]")?.getAttribute("src");
    if (!src || !/^https?:\/\//i.test(src)) continue;
    if (!/\.mp4(\?|#|$)/i.test(src)) continue;
    const key = mp4CanonicalKey(src);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(src);
  }
  return out;
}

function collectLikelyMp4Urls() {
  const byKey = new Map();
  for (const u of collectVideoElementMp4Urls()) {
    const key = mp4CanonicalKey(u);
    if (!byKey.has(key)) byKey.set(key, u);
  }
  for (const u of collectPerformanceMp4Urls()) {
    const key = mp4CanonicalKey(u);
    if (!byKey.has(key)) byKey.set(key, u);
  }
  return Array.from(byKey.values());
}

/** 去掉 og:title / document.title 等平台后缀 */
function sanitizeBilibiliTitle(raw) {
  let s = String(raw || "").trim();
  if (!s) return s;
  s = s
    .replace(/\s*[_\-]\s*哔哩哔哩\s*$/gi, "")
    .replace(/\s*[_\-]\s*bilibili\s*$/gi, "")
    .replace(/\s*-\s*bilibili\s*$/gi, "")
    .trim();
  return s;
}

/**
 * og:description 等会把「播放量、作者、相关视频」拼在真简介后面；去掉从统计行起的尾巴及常见推广套话。
 */
function sanitizeBilibiliDescription(raw) {
  let s = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!s) return "";

  /** 统计行典型形态：播放量 700623、弹幕量 … */
  const mStats =
    /播放量\s*[：:，,]?\s*\d+\s*[、,，]\s*弹幕/.exec(s) ||
    /播放量\s+\d+\s*[、,，]/.exec(s);
  if (mStats) s = s.slice(0, mStats.index).trim();
  else {
    const mRel = /\s相关视频[：:]/.exec(s);
    if (mRel) s = s.slice(0, mRel.index).trim();
    else {
      const mAuth = /\s视频作者\s/.exec(s);
      if (mAuth) s = s.slice(0, mAuth.index).trim();
    }
  }

  s = s.replace(/^简介[：:]\s*/i, "").trim();

  s = s
    .replace(
      /[；;，,]?\s*更多实用攻略[\s\S]*?尽在哔哩哔哩bilibili\s*$/i,
      ""
    )
    .replace(/[；;，,]?\s*更多实用攻略[\s\S]*?尽在哔哩哔哩\s*$/i, "")
    .trim();

  /** 平台/SEO 在简介末尾加的「，视频」「- 视频」等 */
  s = s
    .replace(/\s*[-–—]\s*视频\s*$/i, "")
    .replace(/[，,]\s*视频\s*$/i, "")
    .trim();

  return s;
}

/** DASH：优先 AVC(codecid 7)，否则取最高带宽视频轨 */
function pickBestDashUrls(dash) {
  if (!dash || !Array.isArray(dash.video) || dash.video.length === 0)
    return null;
  const v = dash.video;
  const avc = v.filter((x) => Number(x.codecid) === 7);
  const pool = avc.length ? avc : v;
  let bestV = pool[0];
  for (const cur of pool) {
    if (Number(cur.bandwidth || 0) > Number(bestV.bandwidth || 0)) bestV = cur;
  }
  const videoUrl = normalizeHttpUrl(bestV.baseUrl || bestV.base_url);
  if (!videoUrl) return null;
  let audioUrl = null;
  const a = dash.audio;
  if (Array.isArray(a) && a.length) {
    let bestA = a[0];
    for (const cur of a) {
      if (Number(cur.bandwidth || 0) > Number(bestA.bandwidth || 0))
        bestA = cur;
    }
    audioUrl = normalizeHttpUrl(bestA.baseUrl || bestA.base_url) || null;
  }
  return { videoUrl, audioUrl };
}

async function fetchDashUrlsViaPlayurl(bvid, cidNum) {
  if (!bvid || !cidNum) return null;
  const qs = new URLSearchParams({
    bvid,
    cid: String(cidNum),
    qn: "127",
    fourk: "1",
    fnver: "0",
    fnval: "4048",
    otype: "json",
  });
  const url = `https://api.bilibili.com/x/player/playurl?${qs.toString()}`;
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    const dash = j?.data?.dash;
    if (!dash) return null;
    return pickBestDashUrls(dash);
  } catch {
    return null;
  }
}

async function resolveBiliDashUrls(fromJsonBvid, fromJsonCid, mainWorldPlay) {
  const main = mainWorldPlay || null;
  const pathBv = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  const bvid =
    (main && main.bvid) ||
    fromJsonBvid ||
    (pathBv ? pathBv[1] : "") ||
    "";
  let cid = 0;
  if (main && main.cid != null && Number(main.cid) > 0)
    cid = Number(main.cid);
  else if (fromJsonCid) cid = Number(fromJsonCid);
  if (main && main.dash && main.dash.video && main.dash.video.length) {
    const picked = pickBestDashUrls(main.dash);
    if (picked && picked.videoUrl) return picked;
  }
  if (bvid && cid) return await fetchDashUrlsViaPlayurl(bvid, cid);
  return null;
}

async function scrapeBilibiliVideoPageAsync(mainWorldPlay) {
  const pageUrl = location.href;

  const ogTitle = metaProp("og:title");
  const ogDesc = metaProp("og:description");
  const ogImageRaw = metaProp("og:image");

  const fromJson = scrapeFromInlineVideoJson();
  const pathBv = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  const bvid =
    fromJson.bvid ||
    (mainWorldPlay && mainWorldPlay.bvid) ||
    (pathBv ? pathBv[1] : "") ||
    "";

  let viewApiPicRaw = "";
  let viewApiDescRaw = "";
  let viewApiAid = 0;
  if (bvid) {
    try {
      const r = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        { credentials: "include" }
      );
      if (r.ok) {
        const j = await r.json();
        if (j && j.code === 0 && j.data) {
          if (typeof j.data.pic === "string") viewApiPicRaw = j.data.pic;
          const aidN = Number(j.data.aid);
          if (Number.isFinite(aidN) && aidN > 0) viewApiAid = aidN;
          viewApiDescRaw = bilibiliPickLongestDescription(
            typeof j.data.desc === "string" ? j.data.desc : "",
            bilibiliDecodeDescV2(j.data.desc_v2)
          );
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** 旧版「view」接口文档里的封面字段；部分环境 CORS 失败则静默跳过 */
  let legacyCnViewPicRaw = "";
  if (viewApiAid > 0) {
    try {
      const r2 = await fetch(
        `https://api.bilibili.cn/view?type=json&id=${viewApiAid}&page=1`,
        { credentials: "omit" }
      );
      if (r2.ok) {
        const j2 = await r2.json();
        const legacyErr =
          typeof j2?.code === "number" && j2.code !== 0 && j2.code !== 200;
        if (!legacyErr) {
          const picL =
            (typeof j2?.pic === "string" && j2.pic) ||
            (typeof j2?.data?.pic === "string" && j2.data.pic) ||
            "";
          if (picL) legacyCnViewPicRaw = picL;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const title = sanitizeBilibiliTitle(
    fromJson.title ||
      ogTitle.replace(/\s*-\s*bilibili\s*$/i, "").replace(/\s*_\s*bilibili.*$/i, "").trim() ||
      document.title.replace(/\s*-\s*bilibili.*$/i, "").trim() ||
      "哔哩哔哩视频"
  );

  const descRaw = bilibiliPickLongestDescription(
    viewApiDescRaw,
    fromJson.desc,
    ogDesc,
    metaName("description")
  );

  const descClean = sanitizeBilibiliDescription(descRaw);

  const author =
    fromJson.author || scrapeAuthorDom() || metaName("author") || "";

  /** 官方 view 的 pic 优先于页面态，避免 MAIN 里误链头像；候选下载只对「第一条」archive 基准做 @ 大图比较，防头像 PNG 体积更大误选 */
  const coverBasesOrdered = bilibiliUniquePolishesInPriorityOrder([
    viewApiPicRaw,
    legacyCnViewPicRaw,
    mainWorldPlay && typeof mainWorldPlay.pic === "string"
      ? mainWorldPlay.pic
      : "",
    fromJson.pic,
    ogImageRaw,
    scrapeCoverFromLdJson(),
    scrapeCoverDom(),
  ]);
  const cover = coverBasesOrdered[0] || "";
  const coverFetchCandidates = cover
    ? bilibiliCoverFetchCandidateUrls(cover)
    : [];

  const imageUrls = [];
  if (cover) imageUrls.push(cover);

  const videoUrls = collectLikelyMp4Urls();

  let dashUrls = null;
  try {
    dashUrls = await resolveBiliDashUrls(
      fromJson.bvid,
      fromJson.cid,
      mainWorldPlay
    );
  } catch {
    dashUrls = null;
  }

  const body = descClean.trim() || "（无简介）";

  return {
    title,
    body,
    imageUrls,
    /** 首张封面：background 仅对同一 archive 基准的 @ 变体取体积最大，避免跨 URL 误选头像 */
    coverFetchCandidates,
    videoUrls,
    /** B 站 DASH：画面轨 +（若有）音轨 CDN URL，多为 fMP4/m4s，上传为 video/mp4 + audio/mp4 */
    dashUrls: dashUrls && dashUrls.videoUrl ? dashUrls : undefined,
    pageUrl,
    authorNickname: author,
    /** 写入「简介」自定义属性（与正文一致） */
    intro: descClean.trim() || null,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SCRAPE_BILI") {
    void scrapeBilibiliVideoPageAsync(msg.mainWorldPlay ?? null)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) =>
        sendResponse({ ok: false, error: String(e?.message || e) })
      );
    return true;
  }
  return false;
});
