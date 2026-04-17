#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语雀「小记」导出脚本（非官方 OpenAPI；与网页端相同的数据源）

语雀开发者文档里的 /api/v2 主要面向「知识库文档」，不包含小记。
小记列表接口参考开源工具 yuque-tools 等使用的内部路由：
  GET /api/modules/note/notes/NoteController/index?offset=&limit=...

认证方式：优先使用**已登录**浏览器里的 **Request Headers → Cookie 整段**（含 yuquesession、yuque_ctoken 等）。
若仍 401，可额外设置 **个人令牌**（环境变量 ``YUQUE_TOKEN`` 或 ``--token``），脚本会同时发送 ``X-Auth-Token``。

用法示例
--------
1) 从 Chrome 登录 https://www.yuque.com 后，F12 → Network → 任意请求 → Request Headers → 复制 cookie 整段

   export YUQUE_COOKIE='你的cookie字符串'
   python3 scripts/yuque-export-notes.py --out ./yuque-notes-export

2) 或写入文件（避免 shell 历史里留下 Cookie）：

   echo '你的cookie' > ~/.yuque_cookie.txt
   python3 scripts/yuque-export-notes.py --cookie-file ~/.yuque_cookie.txt -o ./out

3) 可选：尝试为每条小记再请求详情接口（实验性，接口可能随语雀改版失效）：

   python3 scripts/yuque-export-notes.py -o ./out --fetch-detail

输出
----
- notes.jsonl        每行一条 JSON（列表接口返回的原始结构 + 可选 detail）
- notes_summary.md   人类可读的摘要（优先 abstract / body）
- raw/               若加 --dump-raw-pages，保存分页原始 JSON

注意：请勿把 Cookie 提交到 Git 或发给他人。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_HOST = "https://www.yuque.com"
LIST_PATH = "/api/modules/note/notes/NoteController/index"
# 实验性：部分环境可能存在 show 接口；失败则忽略
DETAIL_PATH = "/api/modules/note/notes/NoteController/show"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _safe_filename(s: str, max_len: int = 120) -> str:
    s = re.sub(r'[<>:"/\\|?*\n\r\t]', "_", s).strip()
    return (s[:max_len] or "note") if s else "note"


def _normalize_cookie(raw: str) -> str:
    """去掉首尾空白、BOM、误粘贴的 'Cookie:' 前缀、外层引号；多行时取第一行。"""
    s = raw.lstrip("\ufeff").strip()
    if "\n" in s:
        s = s.split("\n", 1)[0].strip()
    low = s[:12].lower()
    if low.startswith("cookie:"):
        s = s.split(":", 1)[1].strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1].strip()
    return s


def _csrf_from_cookie(cookie: str) -> Dict[str, str]:
    """若 Cookie 里带有语雀常见 CSRF 键，则补上请求头（部分接口会校验）。"""
    out: Dict[str, str] = {}
    for seg in cookie.split(";"):
        seg = seg.strip()
        if "=" not in seg:
            continue
        k, v = seg.split("=", 1)
        kl = k.strip().lower()
        v = v.strip()
        if kl in ("yuque_csrf", "csrf_token", "_csrf", "csrftoken"):
            out["x-csrf-token"] = v
    return out


def _ctoken_query_param(cookie: str) -> Dict[str, str]:
    """部分内部接口需在 query 中带 ctoken（与 Cookie 中 yuque_ctoken 一致）。"""
    for seg in cookie.split(";"):
        seg = seg.strip()
        if "=" not in seg:
            continue
        k, v = seg.split("=", 1)
        if k.strip().lower() == "yuque_ctoken":
            return {"ctoken": v.strip()}
    return {}


def _read_cookie(args: argparse.Namespace) -> str:
    if args.cookie_file:
        with open(os.path.expanduser(args.cookie_file), "r", encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = os.environ.get("YUQUE_COOKIE", "")
    s = _normalize_cookie(raw)
    if s:
        return s
    print(
        "错误：未提供 Cookie。请设置环境变量 YUQUE_COOKIE 或使用 --cookie-file。",
        file=sys.stderr,
    )
    sys.exit(2)


def _build_headers(
    host: str,
    cookie: str,
    referer: str,
    *,
    auth_token: str,
    browser_like: bool,
) -> Dict[str, str]:
    """
    默认「精简头」与 yuque-tools 的 GET 一致；勿带 Origin/Sec-Fetch-*，
    否则部分环境下 WAF 会返回 401（脚本并非真实浏览器导航）。
    """
    h: Dict[str, str] = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Cookie": cookie,
        "Referer": referer,
        "X-Requested-With": "XMLHttpRequest",
    }
    if auth_token:
        h["X-Auth-Token"] = auth_token
    h.update(_csrf_from_cookie(cookie))
    if browser_like:
        origin = host.rstrip("/")
        h["Accept-Language"] = "zh-CN,zh;q=0.9,en;q=0.8"
        h["Origin"] = origin
        h["Sec-Fetch-Dest"] = "empty"
        h["Sec-Fetch-Mode"] = "cors"
        h["Sec-Fetch-Site"] = "same-origin"
    return h


def _request_json(
    host: str,
    path: str,
    query: Dict[str, str],
    cookie: str,
    timeout: int,
    referer: str,
    auth_token: str,
    browser_like: bool,
) -> Any:
    merged = {**query, **_ctoken_query_param(cookie)}
    q = urllib.parse.urlencode(merged)
    url = f"{host.rstrip('/')}{path}?{q}"
    req = urllib.request.Request(
        url,
        headers=_build_headers(
            host, cookie, referer, auth_token=auth_token, browser_like=browser_like
        ),
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def _extract_notes_payload(data: Any) -> Tuple[List[Dict[str, Any]], bool]:
    """
    语雀返回结构可能为 { notes, pin_notes, has_more } 或直接包在 data 里。
    """
    if isinstance(data, dict):
        if "notes" in data or "pin_notes" in data:
            return data.get("notes") or [], bool(data.get("has_more"))
        inner = data.get("data")
        if isinstance(inner, dict) and ("notes" in inner or "pin_notes" in inner):
            return inner.get("notes") or [], bool(inner.get("has_more"))
    return [], False


def _note_text_for_md(note: Dict[str, Any], detail: Optional[Dict[str, Any]]) -> str:
    """优先正文，其次 abstract。"""
    merged = {**note}
    if detail and isinstance(detail, dict):
        merged.update(detail)
    # 常见字段猜测（随语雀版本变化）
    for key in ("body", "body_html", "content_html", "lake", "markdown", "text"):
        v = merged.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    content = merged.get("content")
    if isinstance(content, dict):
        for k in ("body", "lake", "markdown", "abstract", "text"):
            v = content.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    if isinstance(content, str) and content.strip():
        return content.strip()
    ab = merged.get("abstract")
    if isinstance(ab, str) and ab.strip():
        return ab.strip()
    return ""


def _try_fetch_detail(
    host: str,
    cookie: str,
    note: Dict[str, Any],
    timeout: int,
    referer: str,
    auth_token: str,
    browser_like: bool,
) -> Optional[Dict[str, Any]]:
    slug = note.get("slug")
    nid = note.get("id")
    queries: List[Dict[str, str]] = []
    if slug:
        queries.append({"slug": str(slug)})
    if nid is not None:
        queries.append({"id": str(nid)})
    for q in queries:
        try:
            data = _request_json(
                host,
                DETAIL_PATH,
                q,
                cookie,
                timeout,
                referer,
                auth_token,
                browser_like,
            )
            if isinstance(data, dict) and data:
                return data
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError):
            continue
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="导出语雀小记（需浏览器 Cookie）")
    ap.add_argument(
        "-o",
        "--out",
        default="./yuque-notes-export",
        help="输出目录（默认 ./yuque-notes-export）",
    )
    ap.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help="语雀站点根 URL，默认 https://www.yuque.com（若平时用团队子域 xxx.yuque.com 请改成对应地址）",
    )
    ap.add_argument(
        "--referer",
        default="",
        help="Referer；未指定时默认「--host + /dashboard/notes」（与当前语雀小记页常见路径一致）",
    )
    ap.add_argument(
        "--token",
        default="",
        help="语雀个人令牌 https://www.yuque.com/settings/tokens ；部分环境下需与 Cookie 同时传入 X-Auth-Token。也可用环境变量 YUQUE_TOKEN。",
    )
    ap.add_argument(
        "--browser-like-headers",
        action="store_true",
        help="附带 Origin、Sec-Fetch-*（默认关闭；若精简头仍 401 可试开）",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=40,
        help="每页条数；语雀接口要求 limit < 50（默认 40，最大 49）",
    )
    ap.add_argument(
        "--sleep",
        type=float,
        default=0.35,
        help="分页间隔秒数，略降频（默认 0.35）",
    )
    ap.add_argument(
        "--cookie-file",
        help="从文件读取 Cookie（避免出现在 shell 历史）",
    )
    ap.add_argument(
        "--fetch-detail",
        action="store_true",
        help="实验性：对每条小记再请求 show 接口（可能失败）",
    )
    ap.add_argument(
        "--dump-raw-pages",
        action="store_true",
        help="将每页原始 JSON 写入 raw/ 便于排查结构",
    )
    ap.add_argument("--timeout", type=int, default=60, help="HTTP 超时秒数")
    args = ap.parse_args()

    cookie = _read_cookie(args)
    host = args.host.rstrip("/")
    referer = (args.referer or "").strip() or f"{host}/dashboard/notes"
    auth_token = (args.token or os.environ.get("YUQUE_TOKEN", "")).strip()
    browser_like = bool(args.browser_like_headers)

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    raw_dir = os.path.join(out_dir, "raw")
    if args.dump_raw_pages:
        os.makedirs(raw_dir, exist_ok=True)

    offset = 0
    # 语雀返回 422：limit invalid — "should smaller than 50"
    limit = max(1, min(args.limit, 49))
    all_flat: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()
    jsonl_path = os.path.join(out_dir, "notes.jsonl")
    summary_path = os.path.join(out_dir, "notes_summary.md")

    page_idx = 0
    while True:
        query = {
            "offset": str(offset),
            "q": "",
            "filter_type": "all",
            "status": "0",
            "merge_dynamic_data": "0",
            "order": "content_updated_at",
            "with_pinned_notes": "true",
            "limit": str(limit),
        }
        try:
            data = _request_json(
                args.host,
                LIST_PATH,
                query,
                cookie,
                args.timeout,
                referer,
                auth_token,
                browser_like,
            )
        except urllib.error.HTTPError as e:
            try:
                body = e.read()[:800]
            except Exception:
                body = b""
            err_extra = ""
            if e.code == 401:
                err_extra = """
401 Unauthorized 常见处理：
  1) Cookie 用「文件」传入，避免 shell 把 $、` 等截断：  --cookie-file ~/.yuque_cookie.txt
  2) 在已登录状态下打开小记页，从 **同一标签页** 的 Network 里复制 **完整** cookie 行（含 yuquesession、yuque_ctoken 等）。
  3) 到 https://www.yuque.com/settings/tokens 新建令牌，再试：  export YUQUE_TOKEN='你的token'
     python3 ...   （脚本会把 X-Auth-Token 与 Cookie 一并发送）
  4) Referer 与地址栏一致，例如：  --referer 'https://www.yuque.com/dashboard/notes'
  5) 团队子域：  --host https://xxx.yuque.com
  6) 仍失败可试：  --browser-like-headers
"""
            print(
                f"HTTP {e.code}：拉取小记失败。{err_extra}\n"
                f"响应片段: {body!r}",
                file=sys.stderr,
            )
            sys.exit(1)
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            print(f"请求失败: {e}", file=sys.stderr)
            sys.exit(1)

        if args.dump_raw_pages:
            with open(
                os.path.join(raw_dir, f"page_{page_idx:04d}.json"),
                "w",
                encoding="utf-8",
            ) as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

        notes, has_more = _extract_notes_payload(data)
        pin_notes: List[Dict[str, Any]] = []
        if isinstance(data, dict):
            pin_notes = data.get("pin_notes") or []
            inner = data.get("data")
            if isinstance(inner, dict):
                pin_notes = inner.get("pin_notes") or pin_notes

        batch: List[Tuple[str, Dict[str, Any]]] = []
        for n in pin_notes:
            if isinstance(n, dict):
                batch.append(("pin", n))
        for n in notes:
            if isinstance(n, dict):
                batch.append(("list", n))

        with open(jsonl_path, "a", encoding="utf-8") as jf:
            for kind, note in batch:
                dedupe_k = f"{note.get('id', '')}:{note.get('slug', '')}"
                if dedupe_k in seen_keys:
                    continue
                seen_keys.add(dedupe_k)
                detail = None
                if args.fetch_detail:
                    detail = _try_fetch_detail(
                        args.host,
                        cookie,
                        note,
                        args.timeout,
                        referer,
                        auth_token,
                        browser_like,
                    )
                    time.sleep(args.sleep)
                row = {
                    "source": kind,
                    "note": note,
                    "detail": detail,
                }
                jf.write(json.dumps(row, ensure_ascii=False) + "\n")
                all_flat.append(row)

        if not has_more:
            break
        offset += limit
        page_idx += 1
        time.sleep(args.sleep)

    # 写汇总 markdown
    lines: List[str] = ["# 语雀小记导出", "", f"共 {len(all_flat)} 条（含置顶重复时请自行去重）", ""]
    for i, row in enumerate(all_flat, 1):
        note = row.get("note") or {}
        detail = row.get("detail")
        slug = note.get("slug", f"note-{i}")
        title = str(slug)
        text = _note_text_for_md(note, detail if isinstance(detail, dict) else None)
        lines.append(f"## {i}. {title}")
        lines.append("")
        lines.append(text if text else "（无正文摘要，请查看 notes.jsonl 原始字段）")
        lines.append("")
        lines.append("---")
        lines.append("")

    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"完成：{len(all_flat)} 条 → {out_dir}")
    print(f"  - {jsonl_path}")
    print(f"  - {summary_path}")


if __name__ == "__main__":
    main()
