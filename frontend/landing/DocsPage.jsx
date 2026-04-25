// landing/DocsPage.jsx — VitePress-flavored docs page
// 同色系 TopBar + 240 侧栏 + 700 prose 主区，Markdown 走 marked。
import React from "react";
import { marked } from "marked";
import { TopBar, useT, useLang } from "./LandingPink";

// 用 vite ?raw 把 Markdown 当字符串导入；按需添加新文档时同步更新 zhDocs/enDocs。
import zhIntro      from "../docs/zh/intro.md?raw";
import zhQuickstart from "../docs/zh/quickstart.md?raw";
import zhCards      from "../docs/zh/cards.md?raw";
import zhSets       from "../docs/zh/sets.md?raw";
import zhTemplates  from "../docs/zh/templates.md?raw";
import zhProperties from "../docs/zh/properties.md?raw";
import zhLinks      from "../docs/zh/links.md?raw";
import zhImport     from "../docs/zh/import.md?raw";
import enIntro      from "../docs/en/intro.md?raw";
import enQuickstart from "../docs/en/quickstart.md?raw";
import enCards      from "../docs/en/cards.md?raw";
import enSets       from "../docs/en/sets.md?raw";
import enTemplates  from "../docs/en/templates.md?raw";
import enProperties from "../docs/en/properties.md?raw";
import enLinks      from "../docs/en/links.md?raw";
import enImport     from "../docs/en/import.md?raw";

/** 整本文档的目录结构。`slug` 是 URL 路径段，`zh/en` 是源文件。 */
const NAV_GROUPS = [
  {
    titleZh: "入门",
    titleEn: "Getting started",
    items: [
      { slug: "intro",      titleZh: "简介",     titleEn: "Introduction", zh: zhIntro,      en: enIntro },
      { slug: "quickstart", titleZh: "快速开始", titleEn: "Quickstart",   zh: zhQuickstart, en: enQuickstart },
    ],
  },
  {
    titleZh: "核心概念",
    titleEn: "Core concepts",
    items: [
      { slug: "cards",      titleZh: "卡片类型",   titleEn: "Card types", zh: zhCards,      en: enCards },
      { slug: "sets",       titleZh: "合集",       titleEn: "Sets",       zh: zhSets,       en: enSets },
      { slug: "templates",  titleZh: "合集模板",   titleEn: "Templates",  zh: zhTemplates,  en: enTemplates },
      { slug: "properties", titleZh: "属性",       titleEn: "Properties", zh: zhProperties, en: enProperties },
      { slug: "links",      titleZh: "链接与图谱", titleEn: "Links & graph", zh: zhLinks, en: enLinks },
    ],
  },
  {
    titleZh: "数据迁移",
    titleEn: "Data",
    items: [
      { slug: "import", titleZh: "导入与迁移", titleEn: "Import & migration", zh: zhImport, en: enImport },
    ],
  },
];

const FLAT_DOCS = NAV_GROUPS.flatMap((g) => g.items);

marked.setOptions({ gfm: true, breaks: false });

/** /docs 默认重定向到第一篇 */
const DEFAULT_SLUG = "intro";

function getSlugFromPath(pathname) {
  // /docs              → DEFAULT_SLUG
  // /docs/quickstart   → "quickstart"
  if (!pathname.startsWith("/docs")) return DEFAULT_SLUG;
  const parts = pathname.replace(/^\/docs\/?/, "").split("/").filter(Boolean);
  return parts[0] || DEFAULT_SLUG;
}

function pushDocPath(slug) {
  if (typeof window === "undefined") return;
  const next = `/docs/${slug}`;
  if (window.location.pathname === next) return;
  window.history.pushState(null, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function DocsSidebar({ activeSlug }) {
  const t = useT();
  return (
    <aside className="vp-sidebar">
      {NAV_GROUPS.map((group) => (
        <div key={group.titleEn} className="vp-sidebar__group">
          <div className="vp-sidebar__group-title">
            {t(group.titleZh, group.titleEn)}
          </div>
          <ul className="vp-sidebar__list">
            {group.items.map((it) => {
              const active = it.slug === activeSlug;
              return (
                <li key={it.slug}>
                  <a
                    href={`/docs/${it.slug}`}
                    className={"vp-sidebar__item" + (active ? " is-active" : "")}
                    onClick={(e) => {
                      e.preventDefault();
                      pushDocPath(it.slug);
                    }}
                  >
                    {t(it.titleZh, it.titleEn)}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function PrevNext({ slug }) {
  const t = useT();
  const idx = FLAT_DOCS.findIndex((d) => d.slug === slug);
  if (idx < 0) return null;
  const prev = idx > 0 ? FLAT_DOCS[idx - 1] : null;
  const next = idx < FLAT_DOCS.length - 1 ? FLAT_DOCS[idx + 1] : null;
  return (
    <nav className="vp-prev-next" aria-label="Pagination">
      <div>
        {prev ? (
          <a
            className="vp-prev-next__link"
            href={`/docs/${prev.slug}`}
            onClick={(e) => { e.preventDefault(); pushDocPath(prev.slug); }}
          >
            <div className="vp-prev-next__label">{t("上一篇", "Previous")}</div>
            <div className="vp-prev-next__title">{t(prev.titleZh, prev.titleEn)}</div>
          </a>
        ) : null}
      </div>
      <div style={{ textAlign: "right" }}>
        {next ? (
          <a
            className="vp-prev-next__link vp-prev-next__link--right"
            href={`/docs/${next.slug}`}
            onClick={(e) => { e.preventDefault(); pushDocPath(next.slug); }}
          >
            <div className="vp-prev-next__label">{t("下一篇", "Next")}</div>
            <div className="vp-prev-next__title">{t(next.titleZh, next.titleEn)}</div>
          </a>
        ) : null}
      </div>
    </nav>
  );
}

export function DocsPage({ onStart }) {
  const t = useT();
  const { lang } = useLang();
  const [pathname, setPathname] = React.useState(() =>
    typeof window === "undefined" ? "/docs" : window.location.pathname
  );

  React.useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** 进入 /docs（无 slug）时把 URL 替换为默认篇，避免后退到中间态 */
  React.useEffect(() => {
    if (pathname === "/docs" || pathname === "/docs/") {
      window.history.replaceState(null, "", `/docs/${DEFAULT_SLUG}`);
      setPathname(`/docs/${DEFAULT_SLUG}`);
    }
  }, [pathname]);

  const slug = getSlugFromPath(pathname);
  const doc = FLAT_DOCS.find((d) => d.slug === slug) ?? FLAT_DOCS[0];
  const raw = lang === "en" ? doc.en : doc.zh;
  const html = React.useMemo(() => marked.parse(raw), [raw]);

  /** 文档切换时滚到顶部，避免长页面 scroll 残留 */
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [slug]);

  return (
    <div className="landing-page-root vp-root">
      <TopBar onStart={onStart} />
      <div className="vp-layout">
        <DocsSidebar activeSlug={slug} />
        <main className="vp-main">
          <article
            className="vp-doc"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <PrevNext slug={slug} />
          <footer className="vp-footer">
            <span>
              {t("内容编辑于 GitHub · ", "Edit on GitHub · ")}
            </span>
            <a
              href={`https://github.com/snowhejia/cardnote.io/edit/main/frontend/docs/${lang}/${slug}.md`}
              target="_blank"
              rel="noreferrer"
            >
              {t("修改这一页", "Edit this page")}
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
