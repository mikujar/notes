// landing/ChangelogPage.jsx — pink-edition 更新日志，与 LandingPink 同色系
import React from "react";
import {
  TopBar,
  Footer,
  useT,
  PixelHeart,
  PixelStar,
  PixelSparkle,
  PixelFlower,
} from "./LandingPink";

/** 单条变更分类 → 配色 */
const TAG_TINT = {
  added:    { bg: "oklch(0.94 0.06 145)", ink: "var(--candy-olive-deep)" },
  improved: { bg: "oklch(0.94 0.06 220)", ink: "var(--candy-sky-deep)" },
  fixed:    { bg: "oklch(0.94 0.07 30)",  ink: "var(--candy-fawn-deep)" },
  removed:  { bg: "oklch(0.94 0.05 355)", ink: "var(--candy-pink-deep)" },
};

function tagLabel(tag, t) {
  switch (tag) {
    case "added":    return t("新增", "Added");
    case "improved": return t("优化", "Improved");
    case "fixed":    return t("修复", "Fixed");
    case "removed":  return t("移除", "Removed");
    default:         return tag;
  }
}

function ChangelogTag({ tag }) {
  const t = useT();
  const tint = TAG_TINT[tag] ?? TAG_TINT.improved;
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 999,
        background: tint.bg,
        color: tint.ink,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {tagLabel(tag, t)}
    </span>
  );
}

function ChangelogEntry({ release, t, lang }) {
  return (
    <section
      style={{
        position: "relative",
        background: "white",
        borderRadius: 24,
        border: "1px solid oklch(0.9 0.05 var(--hue))",
        padding: "36px 40px",
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: 36,
        alignItems: "start",
      }}
    >
      <div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--pink-600)",
            letterSpacing: "0.12em",
            marginBottom: 6,
          }}
        >
          {release.date}
        </div>
        <div
          className="grotesk"
          style={{
            fontSize: 36,
            fontWeight: 600,
            color: "var(--candy-pink-deep)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {release.version}
        </div>
        {release.codename ? (
          <div
            className="serif"
            style={{
              fontSize: 14,
              fontStyle: "italic",
              color: "var(--pink-600)",
              marginTop: 6,
            }}
          >
            {t(release.codename.cn, release.codename.en)}
          </div>
        ) : null}
        <div style={{ position: "absolute", right: 32, top: 32, opacity: 0.85 }}>
          {release.glyph}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {release.summary ? (
          <p
            className="cn"
            style={{
              fontSize: 16,
              lineHeight: 1.7,
              color: "var(--pink-ink)",
              margin: 0,
            }}
          >
            {t(release.summary.cn, release.summary.en)}
          </p>
        ) : null}
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {release.items.map((it, i) => (
            <li
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 12,
                alignItems: "baseline",
                padding: "8px 0",
                borderBottom:
                  i < release.items.length - 1
                    ? "1px dashed oklch(0.92 0.02 var(--hue))"
                    : "none",
              }}
            >
              <ChangelogTag tag={it.tag} />
              <span
                className="cn"
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "var(--pink-ink)",
                }}
              >
                {t(it.cn, it.en)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const RELEASES = [
  {
    version: "beta 0.0.5",
    date: "2026·04·25",
    codename: { cn: "Pink edition · 落地页 i18n", en: "Pink edition · landing i18n" },
    glyph: <PixelHeart scale={4} />,
    summary: {
      cn:
        "落地页与登录页全面铺中英切换，登录改为真路由。",
      en:
        "Full bilingual landing + login pages, and login becomes a real route.",
    },
    items: [
      {
        tag: "added",
        cn: "落地页中英切换（#43）：导航、Hero、特性段、模板段（8 类 + 50+ 子模板）、属性段、Footer 全量翻译。",
        en:
          "Landing-page language toggle (#43): nav, hero, features, templates (8 types + 50+ sub-templates), properties, footer all translated.",
      },
      {
        tag: "added",
        cn: "更新日志页面（本页），与落地页同色系。",
        en: "This very Changelog page — matching the landing palette.",
      },
      {
        tag: "improved",
        cn: "登录改走 /login 路由（#44），登录页与落地页共用语言状态；登录成功后回到 /。",
        en:
          "Login now lives at /login (#44); login UI shares the landing's language state; success redirects to /.",
      },
      {
        tag: "improved",
        cn: "侧栏 rail 日历入口展示今日新增笔记数；空状态文案精简（#42）。",
        en:
          "Sidebar calendar entry shows today's new-note count; empty-state copy tightened (#42).",
      },
      {
        tag: "improved",
        cn: "模板段重排：文件加视频，主题改 12 类，剪藏改 14 类，任务改待办/日程/习惯。",
        en:
          "Template list reorganized: Files gains Video; Topics now 12 categories; Clips now 14; Tasks split into To-do / Schedule / Habit.",
      },
    ],
  },
  {
    version: "beta 0.0.4",
    date: "2026·04·24",
    codename: { cn: "懒加载与响应式", en: "Lazy-load & responsive" },
    glyph: <PixelStar scale={4} color="var(--candy-sky-deep)" />,
    summary: {
      cn:
        "整套懒加载流水线落地，首屏更快；落地页适配移动端与平板。",
      en:
        "End-to-end lazy-load pipeline lands; landing page now adapts to phone and tablet.",
    },
    items: [
      {
        tag: "added",
        cn: "懒加载基础设施：meta tree、按合集分页、聚合接口（#28–#31）。",
        en:
          "Lazy-load scaffolding: meta tree, per-collection pagination, aggregation endpoints (#28–#31).",
      },
      {
        tag: "added",
        cn: "多视图迁移到聚合接口：标签库、全局搜索、提醒、全部笔记时间线、日历高亮、概览（#33）。",
        en:
          "Views migrated onto aggregation endpoints: tag library, global search, reminders, all-notes timeline, calendar dots, overview (#33).",
      },
      {
        tag: "improved",
        cn: "落地页移动端 / 平板响应式（#38）。",
        en: "Landing-page responsive layout for phone and tablet (#38).",
      },
      {
        tag: "fixed",
        cn: "概览跳卡片偶发闪屏；rail 角标对账；Loading 文案统一（#37、#39）。",
        en:
          "Flicker when jumping to a card from overview; rail badge counts; unified boot loader (#37, #39).",
      },
      {
        tag: "fixed",
        cn: "Lazy 模式下首次点开卡片可能为空（#34）；概览提醒标题 HTML 实体未解码（#36）。",
        en:
          "First card click could be empty in lazy mode (#34); overview reminder titles weren't decoding HTML entities (#36).",
      },
    ],
  },
  {
    version: "beta 0.0.3",
    date: "2026·04·22",
    codename: { cn: "概览与合集设置", en: "Overview & collection settings" },
    glyph: <PixelFlower scale={4} />,
    summary: {
      cn:
        "概览页重做，合集设置加 schema 编辑器与图标库。",
      en:
        "Overview redesigned; collection settings get a schema editor and icon library.",
    },
    items: [
      {
        tag: "added",
        cn: "合集设置：图标库、Schema 编辑器、子类型完善（#23）。",
        en:
          "Collection settings: icon library, schema editor, sub-type polish (#23).",
      },
      {
        tag: "added",
        cn: "内联 cardLink 创建 + 云端预设刷新工具（#27）；视频缩略图回填按钮（#25）。",
        en:
          "Inline cardLink creation + cloud preset refresh (#27); video thumbnail backfill button (#25).",
      },
      {
        tag: "improved",
        cn: "概览页重做；「作品」并入「主题」（#24）。",
        en:
          "Overview rebuild; the “Works” category folds into Topics (#24).",
      },
      {
        tag: "improved",
        cn: "移动端文件视图、时间线折叠等多处打磨（#22）。",
        en:
          "Mobile files view, timeline fold, miscellaneous polish (#22).",
      },
      {
        tag: "fixed",
        cn: "媒体元数据回填的 SQL casting（#26）。",
        en:
          "Media-metadata backfill SQL casting (#26).",
      },
    ],
  },
  {
    version: "beta 0.0.2",
    date: "2026·04·21",
    codename: { cn: "侧栏与 UI 打磨", en: "Sidebar & UI polish" },
    glyph: <PixelSparkle scale={3} color="var(--candy-fawn-deep)" />,
    summary: {
      cn:
        "侧栏角标改为子树合计；多处微交互细抠。",
      en:
        "Sidebar badge counts switch to subtree totals; many micro-interactions tightened.",
    },
    items: [
      {
        tag: "added",
        cn: "子树卡片聚合到合集视图，侧栏角标也改为子树合计（#19、#20）。",
        en:
          "Subtree card aggregation across collection views; sidebar badges show subtree totals (#19, #20).",
      },
      {
        tag: "added",
        cn: "动态 cardSchema.autoLinkRules 执行（#17）；文件页右键删除带级联（#14）。",
        en:
          "Dynamic cardSchema.autoLinkRules execution (#17); right-click delete with cascade on the files view (#14).",
      },
      {
        tag: "improved",
        cn: "侧栏小圆点、复选框、日历、日期 popover、已归档入口等多处微调（#21）。",
        en:
          "Sidebar dots, checkbox, calendar, date popover, archived shortcut polish (#21).",
      },
      {
        tag: "improved",
        cn: "「对象类型」→「合集模板」；「启用」→「添加」（#16）。",
        en:
          "Renamed “object types” → “collection templates”; “enable” → “add” (#16).",
      },
      {
        tag: "fixed",
        cn: "父级 / 预设根合集视图删除卡片（#18）。",
        en:
          "Deleting a card from a parent or preset-root collection view (#18).",
      },
    ],
  },
  {
    version: "beta 0.0.1",
    date: "2026·04·16",
    codename: { cn: "首次提交", en: "First commit" },
    glyph: <PixelHeart scale={3} color="var(--candy-pink-deep)" />,
    summary: {
      cn:
        "cardnote web 重写起步：把卡片、合集、模板、关系四件套从原生应用搬上来，先跑通账号、上传与基础视图。",
      en:
        "cardnote rebooted on the web — cards, sets, templates, and relations ported from the native app, with auth, uploads, and the core views in place.",
    },
    items: [
      {
        tag: "added",
        cn: "Web-only 重写（#a4a1a5c），远程账号系统、默认合集种子、空白卡片初始数据。",
        en:
          "Web-only rewrite (a4a1a5c): remote auth, default collection seed, an initial blank card.",
      },
      {
        tag: "added",
        cn: "Cursor / CDN token 媒体读授权（#13）。",
        en: "Cursor / CDN token-based media read auth (#13).",
      },
    ],
  },
];

export function ChangelogPage({ onStart }) {
  const t = useT();
  const rootRef = React.useRef(null);

  /** 与 LandingApp 同款的 --hue 自动循环：让 Changelog 顶栏与落地页色相一致。
     hue/saturation 取自 LandingApp 的 yellow 预设缺省值。 */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const startHue = 240;
    const speed = 10; // 秒/360°
    const sat = 0.1;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const h = (((now - start) / 1000 / speed) * 360 + startHue) % 360;
      root.style.setProperty("--hue", h);
      root.style.setProperty("--pink-50", `oklch(0.985 ${0.015 * sat} ${h})`);
      root.style.setProperty("--pink-100", `oklch(0.95 ${0.15 * sat} ${h})`);
      root.style.setProperty("--pink-200", `oklch(0.93 ${0.17 * sat} ${h})`);
      root.style.setProperty("--pink-300", `oklch(0.9 ${0.18 * sat} ${h})`);
      root.style.setProperty("--pink-400", `oklch(0.78 ${0.17 * sat} ${h})`);
      root.style.setProperty("--pink-500", `oklch(0.7 ${0.19 * sat} ${h})`);
      root.style.setProperty("--pink-600", `oklch(0.62 ${0.22 * sat} ${h})`);
      root.style.setProperty("--pink-700", `oklch(0.5 ${0.22 * sat} ${h})`);
      root.style.setProperty("--pink-ink", `oklch(0.3 ${0.18 * sat} ${h})`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={rootRef}
      className="landing-page-root"
      style={{
        background: "var(--pink-100)",
        minHeight: "100vh",
      }}
    >
      <TopBar onStart={onStart} />

      {/* Header */}
      <div
        className="dot-grid"
        style={{
          position: "relative",
          padding: "120px 48px 60px",
          background:
            "radial-gradient(ellipse at 50% 30%, oklch(0.96 0.04 var(--hue)) 0%, var(--pink-200) 70%)",
          overflow: "hidden",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative" }}>
          {/* 文字列：限制 maxWidth 720，右侧 ~380px 留给装饰 */}
          <div style={{ maxWidth: 720, position: "relative", zIndex: 1 }}>
            <div
              className="mono"
              style={{
                fontSize: 12,
                color: "var(--pink-600)",
                marginBottom: 24,
                letterSpacing: "0.12em",
              }}
            >
              .CHANGELOG / .RELEASES
            </div>
            <h1
              className="landing-section__title"
              style={{
                fontSize: 96,
                lineHeight: 0.95,
                letterSpacing: "-0.04em",
                margin: 0,
                display: "flex",
                alignItems: "baseline",
                gap: 22,
                flexWrap: "wrap",
              }}
            >
              <span
                className="grotesk"
                style={{ color: "var(--candy-pink-deep)", fontWeight: 600 }}
              >
                {t("更新", "Change")}
              </span>
              <span
                className="serif"
                style={{
                  fontSize: 88,
                  color: "var(--candy-olive-deep)",
                  fontStyle: "italic",
                  fontWeight: 500,
                }}
              >
                {t("日志.", "log.")}
              </span>
            </h1>
            <p
              className="cn"
              style={{
                fontSize: 18,
                lineHeight: 1.7,
                color: "var(--pink-ink)",
                marginTop: 28,
                marginBottom: 0,
              }}
            >
              {t(
                "每一次能让 cardnote 变得更好用、更顺眼的小改动都会写在这里。我们偏爱小步快跑——多发版本，少塞功能。",
                "Every small change that makes cardnote more useful or more lovely is written down here. We prefer small steps — more releases, fewer mega-features."
              )}
            </p>
          </div>

          {/* 装饰像素：散落在文字右侧 380px 走廊与底部，绝不与文字重叠 */}
          <div
            aria-hidden
            className="changelog-decor"
            style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}
          >
            <span style={{ position: "absolute", top: 8,   right: 36 }}>
              <PixelFlower scale={5} />
            </span>
            <span style={{ position: "absolute", top: 132, right: 188 }}>
              <PixelSparkle scale={3} color="var(--candy-fawn-deep)" />
            </span>
            <span style={{ position: "absolute", top: 218, right: 84 }}>
              <PixelHeart scale={3} color="var(--candy-pink-deep)" />
            </span>
            <span style={{ position: "absolute", bottom: -12, right: 250 }}>
              <PixelStar scale={3} color="var(--candy-olive-deep)" />
            </span>
            <span style={{ position: "absolute", bottom: 24, right: 12 }}>
              <PixelSparkle scale={2} color="var(--candy-sky-deep)" />
            </span>
          </div>
        </div>
      </div>

      {/* Releases */}
      <div
        style={{
          background: "var(--pink-50)",
          padding: "60px 48px 120px",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          {RELEASES.map((r) => (
            <ChangelogEntry key={r.version} release={r} t={t} />
          ))}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "40px 0 8px",
              color: "var(--pink-600)",
            }}
          >
            <span style={{ width: 40, height: 1, background: "currentColor", opacity: 0.4 }} />
            <span className="serif" style={{ fontSize: 14, fontStyle: "italic" }}>
              {t("更早的版本还在路上 ✨", "older releases coming soon ✨")}
            </span>
            <span style={{ width: 40, height: 1, background: "currentColor", opacity: 0.4 }} />
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
