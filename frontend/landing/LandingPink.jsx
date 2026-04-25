// landing-pink.jsx — pink glass edition
import React from "react";
import { useAppUiLang } from "../appUiLang";

/** 落地页与登录页共用 AppUiLang，避免点 CTA 后语言被重置 */
const useLang = () => {
  const { lang, setLang } = useAppUiLang();
  return { lang, setLang };
};
const useT = () => {
  const { lang } = useLang();
  return React.useCallback((zh, en) => (lang === "en" ? en : zh), [lang]);
};

function TopBar({ onStart }) {
  const { lang, setLang } = useLang();
  const t = useT();
  const toggleLang = () => {
    setLang(lang === "zh" ? "en" : "zh");
  };
  const nav = [
    { en: "OVERVIEW",  cn: "概览" },
    { en: "FEATURES",  cn: "功能" },
    { en: "TEMPLATES", cn: "模板" },
    { en: "PRICING",   cn: "价格" },
    { en: "DOCS",      cn: "文档", path: "/docs" },
    { en: "CHANGELOG", cn: "更新", path: "/changelog" },
  ];
  const goPath = (path) => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === path) return;
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    <div className="landing-topbar" style={{
      position: "sticky",
      top: 0,
      zIndex: 20,
      width: "100%",
      background: "oklch(0.98 0.02 var(--hue) / 0.35)",
      backdropFilter: "blur(14px) saturate(1.4)",
      WebkitBackdropFilter: "blur(14px) saturate(1.4)",
      borderBottom: "1px solid oklch(0.85 0.08 var(--hue) / 0.32)",
    }}>
      <div className="landing-topbar__inner" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "22px 48px",
        maxWidth: 1400, margin: "0 auto", gap: 40,
      }}>
      {/* Brand */}
      <div
        className="landing-topbar__brand"
        style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
        onClick={() => goPath("/")}
      >
        <CardnoteLogo size={40} />
        <div>
          <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: "var(--pink-ink)", lineHeight: 1, letterSpacing: "-0.02em" }}>
            cardnote
          </div>
          <div className="mono" style={{ fontSize: 9, color: "var(--pink-600)", marginTop: 2, letterSpacing: "0.1em" }}>
            v0.0.1 · 2026
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleLang(); }}
          aria-label={lang === "zh" ? "Switch to English" : "切换到中文"}
          title={lang === "zh" ? "EN" : "中文"}
          style={{
            display: "inline-flex", alignItems: "center",
            marginLeft: 4,
            padding: "5px 10px", borderRadius: 999,
            border: "1px solid oklch(0.85 0.06 var(--hue) / 0.5)",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12, fontWeight: 600, letterSpacing: "0.06em",
            color: "var(--pink-ink)",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            gap: 4,
          }}
        >
          <span style={{ opacity: lang === "zh" ? 1 : 0.45 }}>中</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ opacity: lang === "en" ? 1 : 0.45 }}>EN</span>
        </button>
      </div>

      {/* Nav */}
      <div className="landing-topbar__nav" style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, justifyContent: "center" }}>
        {nav.map((n, i) => {
          const onChangelog = typeof window !== "undefined" && window.location.pathname !== "/";
          const anchor = `#${n.en.toLowerCase()}`;
          const href = n.path ?? (onChangelog ? `/${anchor}` : anchor);
          const onClick = (e) => {
            if (n.path) {
              e.preventDefault();
              goPath(n.path);
              return;
            }
            // 锚点项：在子页面（如 /changelog）时先回到落地页再带上 hash 让浏览器滚动
            if (onChangelog) {
              e.preventDefault();
              if (typeof window === "undefined") return;
              window.history.pushState(null, "", `/${anchor}`);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          };
          return (
          <a key={n.en} href={href} onClick={onClick} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "6px 14px", borderRadius: 8,
            textDecoration: "none",
            transition: "background 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "oklch(0.94 0.04 var(--hue))"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span className="cn" style={{ fontSize: 13, fontWeight: 500, color: "var(--pink-ink)" }}>
              {lang === "en" ? n.en.charAt(0) + n.en.slice(1).toLowerCase() : n.cn}
            </span>
            <span className="mono" style={{ fontSize: 8, color: "var(--pink-600)", letterSpacing: "0.1em", marginTop: 1 }}>
              0{i + 1} · {n.en}
            </span>
          </a>
          );
        })}
      </div>

      {/* Actions */}
      <div className="landing-topbar__actions" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <a
          href="#login"
          className="cn"
          onClick={(e) => {
            if (onStart) {
              e.preventDefault();
              onStart("register");
            }
          }}
          style={{
            fontSize: 13, color: "var(--pink-ink)",
            textDecoration: "none", fontWeight: 500,
            cursor: "pointer",
          }}
        >{t("注册", "Sign up")}</a>
        <button
          type="button"
          className="cn"
          onClick={() => { if (onStart) onStart(); }}
          style={{
            padding: "8px 18px", borderRadius: 999,
            background: "var(--pink-ink)", color: "var(--pink-50)",
            border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 600,
            fontFamily: "var(--font-cn)",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          {t("开始使用", "Get started")}
          <span style={{ fontSize: 11, opacity: 0.7 }}>→</span>
        </button>
      </div>
      </div>
    </div>
  );
}

function PlayingCard({ style, children, bg, rotate, expanded }) {
  return (
    <div style={{
      position: "absolute",
      width: 260, height: 340,
      borderRadius: 28,
      background: bg,
      boxShadow: "0 40px 80px -30px oklch(0.3 0.1 var(--hue) / 0.35), 0 10px 30px -10px oklch(0.5 0.15 var(--hue) / 0.18), inset 0 1px 0 oklch(1 0 0 / 0.4)",
      transform: `rotate(${rotate}deg)`,
      overflow: "hidden",
      filter: "saturate(0.85)",
      transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1), left 0.7s cubic-bezier(0.22,1,0.36,1), top 0.7s cubic-bezier(0.22,1,0.36,1)",
      ...style,
    }}>
      {children}
    </div>
  );
}

// Decorative glyphs — flower, sparkle, petal
function Flower({ size = 44, color = "white", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" style={style}>
      <g fill={color}>
        <circle cx="22" cy="10" r="7" />
        <circle cx="34" cy="18" r="7" />
        <circle cx="30" cy="32" r="7" />
        <circle cx="14" cy="32" r="7" />
        <circle cx="10" cy="18" r="7" />
      </g>
      <circle cx="22" cy="22" r="4" fill={color} opacity="0.5" />
    </svg>
  );
}
function Sparkle({ size = 36, color = "white", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" style={style}>
      <path fill={color} d="M18 0 L21 15 L36 18 L21 21 L18 36 L15 21 L0 18 L15 15 Z" />
    </svg>
  );
}
function Petal({ size = 36, color = "white", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" style={style}>
      <path fill={color} d="M18 2 C22 10, 26 14, 34 18 C26 22, 22 26, 18 34 C14 26, 10 22, 2 18 C10 14, 14 10, 18 2 Z" />
    </svg>
  );
}
// Pixel letter renderer — each char is a 5-wide x 7-tall bitmap
const PIXEL_GLYPHS = {
  c: ["01110","11001","10000","10000","10000","11001","01110"],
  a: ["01110","10001","10001","11111","10001","10001","10001"],
  r: ["11110","10001","10001","11110","10100","10010","10001"],
  d: ["11110","10001","10001","10001","10001","10001","11110"],
  n: ["10001","11001","10101","10101","10011","10001","10001"],
  o: ["01110","10001","10001","10001","10001","10001","01110"],
  t: ["11111","00100","00100","00100","00100","00100","00100"],
  e: ["11111","10000","10000","11110","10000","10000","11111"],
};
function PixelLetter({ char = "c", scale = 20, color = "var(--candy-sky-deep)", style }) {
  const g = PIXEL_GLYPHS[char.toLowerCase()];
  if (!g) return null;
  return (
    <div className="pixelate" style={{ display: "inline-block", lineHeight: 0, verticalAlign: "baseline", ...style }}>
      {g.map((row, y) => (
        <div key={y} style={{ display: "flex", height: scale }}>
          {row.split("").map((c, x) => (
            <div key={x} style={{ width: scale, height: scale, background: c === "1" ? color : "transparent" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Cloud({ size = 40, color = "white", style }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 40 32" style={style}>
      <path fill={color} d="M10 20 A6 6 0 0 1 10 8 A5 5 0 0 1 20 4 A6 6 0 0 1 30 8 A6 6 0 0 1 30 20 Z" />
    </svg>
  );
}

// Pixel art sprites — chunky 1px grid
function PixelHeart({ scale = 4, color = "var(--candy-pink-deep)", style }) {
  // 9x8 grid
  const px = [
    "011001100",
    "111111110",
    "111111111",
    "111111111",
    "011111110",
    "001111100",
    "000111000",
    "000010000",
  ];
  return (
    <div className="pixelate" style={{ display: "inline-block", lineHeight: 0, ...style }}>
      {px.map((row, y) => (
        <div key={y} style={{ display: "flex", height: scale }}>
          {row.split("").map((c, x) => (
            <div key={x} style={{ width: scale, height: scale, background: c === "1" ? color : "transparent" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PixelStar({ scale = 4, color = "var(--candy-fawn-deep)", style }) {
  const px = [
    "000010000",
    "000111000",
    "011111110",
    "111111111",
    "011111110",
    "001111100",
    "011101110",
    "110000011",
  ];
  return (
    <div className="pixelate" style={{ display: "inline-block", lineHeight: 0, ...style }}>
      {px.map((row, y) => (
        <div key={y} style={{ display: "flex", height: scale }}>
          {row.split("").map((c, x) => (
            <div key={x} style={{ width: scale, height: scale, background: c === "1" ? color : "transparent" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PixelFlower({ scale = 4, color = "var(--candy-olive-deep)", center = "white", style }) {
  const px = [
    "011011000",
    "111111100",
    "111121110",
    "011111110",
    "011111110",
    "001111100",
    "000010000",
    "000010000",
  ];
  return (
    <div className="pixelate" style={{ display: "inline-block", lineHeight: 0, ...style }}>
      {px.map((row, y) => (
        <div key={y} style={{ display: "flex", height: scale }}>
          {row.split("").map((c, x) => (
            <div key={x} style={{
              width: scale, height: scale,
              background: c === "1" ? color : c === "2" ? center : "transparent",
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PixelSparkle({ scale = 3, color = "var(--candy-sky-deep)", style }) {
  const px = [
    "000010000",
    "000111000",
    "010111010",
    "111111111",
    "010111010",
    "000111000",
    "000010000",
  ];
  return (
    <div className="pixelate" style={{ display: "inline-block", lineHeight: 0, ...style }}>
      {px.map((row, y) => (
        <div key={y} style={{ display: "flex", height: scale }}>
          {row.split("").map((c, x) => (
            <div key={x} style={{ width: scale, height: scale, background: c === "1" ? color : "transparent" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Twinkling 4-point star — CSS animated
// Cardnote logo mark — two stacked rounded cards with a pixel heart notch
function CardnoteLogo({ size = 36, style }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 36 36" style={{ display: "block", ...style }}>
      {/* back card — tilted, fawn tint */}
      <g transform="rotate(-10 18 20)">
        <rect x="6" y="7" width="24" height="22" rx="5"
          fill="var(--candy-fawn)" stroke="var(--candy-fawn-deep)" strokeWidth="1" />
      </g>
      {/* front card — pink, slight rotate opposite */}
      <g transform="rotate(6 18 18)">
        <rect x="5" y="6" width="26" height="24" rx="5.5"
          fill="var(--candy-pink)" stroke="var(--candy-pink-deep)" strokeWidth="1" />
        {/* pixel heart centered on front card */}
        <g transform="translate(12 11)" shapeRendering="crispEdges">
          {[
            "011011",
            "111111",
            "111111",
            "011110",
            "001100",
          ].map((row, y) => row.split("").map((c, x) =>
            c === "1" ? (
              <rect key={`${y}-${x}`} x={x * 2} y={y * 2} width="2" height="2" fill="white" />
            ) : null
          ))}
        </g>
      </g>
    </svg>
  );
}

function TwinkleStar({ size = 14, color = "var(--candy-pink-deep)", delay = "0s", style }) {
  return (
    <span className="twinkle" style={{ ...style, animationDelay: delay, width: size, height: size }}>
      <svg viewBox="0 0 20 20" width={size} height={size}>
        <path
          d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z"
          fill={color}
        />
      </svg>
    </span>
  );
}

// Pixel-border frame — chunky stepped border using box-shadow
function PixelBorder({ children, color = "var(--candy-sky-deep)", bg = "white", style }) {
  return (
    <div style={{
      background: bg,
      color: "var(--ink)",
      boxShadow: `
        0 -4px 0 0 ${color},
        0 4px 0 0 ${color},
        -4px 0 0 0 ${color},
        4px 0 0 0 ${color},
        -4px -4px 0 0 ${bg},
        4px -4px 0 0 ${bg},
        -4px 4px 0 0 ${bg},
        4px 4px 0 0 ${bg},
        0 -8px 0 0 ${color},
        0 8px 0 0 ${color},
        -8px 0 0 0 ${color},
        8px 0 0 0 ${color}
      `,
      padding: "12px 20px",
      display: "inline-block",
      ...style,
    }}>
      {children}
    </div>
  );
}

// The center frosted-glass folder
function GlassFolder({ children }) {
  return (
    <div style={{ position: "relative", width: 480, height: 360 }}>
      {/* Tab */}
      <div style={{
        position: "absolute", left: 40, top: 0,
        width: 180, height: 36,
        background: "linear-gradient(180deg, oklch(0.9 0.1 var(--hue) / 0.65), oklch(0.85 0.14 var(--hue) / 0.5))",
        backdropFilter: "blur(18px) saturate(1.2)",
        WebkitBackdropFilter: "blur(18px) saturate(1.2)",
        borderRadius: "16px 16px 0 0",
        border: "1px solid oklch(1 0 0 / 0.4)",
        borderBottom: "none",
        boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.6)",
      }} />
      {/* Body */}
      <div className="glass" style={{
        position: "absolute", left: 0, top: 28,
        width: "100%", height: 332,
        borderRadius: "24px 24px 28px 28px",
        padding: "28px 32px",
        display: "flex", flexDirection: "column",
        color: "white",
      }}>
        <div className="serif" style={{
          fontSize: 34, fontWeight: 500, color: "oklch(1 0 0 / 0.85)",
          textShadow: "0 1px 2px oklch(0.4 0.15 var(--hue) / 0.3)",
          lineHeight: 1,
        }}>WORKSPACE</div>
        <div className="mono" style={{ fontSize: 12, color: "oklch(1 0 0 / 0.75)", marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <PixelHeart scale={2} color="white" />
          @cardnote
        </div>
        {children}
      </div>
    </div>
  );
}

function PinkLanding({ ghost, showAnnotations, onStart, heroOnly }) {
  const [mouse, setMouse] = React.useState({ px: 0, py: 0 });
  const [expanded, setExpanded] = React.useState(false);
  const { lang } = useLang();
  const heroRef = React.useRef(null);

  const onMove = (e) => {
    const r = heroRef.current?.getBoundingClientRect();
    if (!r) return;
    setMouse({
      px: ((e.clientX - r.left) / r.width - 0.5) * 2,
      py: ((e.clientY - r.top) / r.height - 0.5) * 2,
    });
  };

  return (
    <div
      style={{
        background: "var(--pink-100)",
        minHeight: heroOnly ? "100%" : "100vh",
      }}
    >
      {heroOnly ? null : <TopBar onStart={onStart} />}

      {/* HERO */}
      <div
        ref={heroRef}
        onMouseMove={onMove}
        onMouseLeave={() => setMouse({ px: 0, py: 0 })}
        className="dot-grid landing-hero"
        style={{
          position: "relative",
          width: "100%",
          height: 900, overflow: "hidden",
          background: "radial-gradient(ellipse at 50% 40%, oklch(0.96 0.04 var(--hue)) 0%, var(--pink-200) 60%, var(--pink-300) 100%)",
        }}
      >
        {/* Soft pink orb glow */}
        <div style={{
          position: "absolute",
          left: "50%", top: 380,
          transform: "translateX(-50%)",
          width: 900, height: 900, borderRadius: "50%",
          background: "radial-gradient(circle, oklch(0.9 0.15 var(--hue) / 0.5) 0%, transparent 60%)",
          filter: "blur(40px)",
          pointerEvents: "none",
        }} />

        {/* Fanned playing cards BEHIND folder（展开时提到 z-index 6，盖住飘浮胶囊） */}
        <div className="landing-hero__cards" style={{
          position: "absolute",
          left: "50%", top: 100,
          transform: `translateX(-50%) translate(${mouse.px * 6}px, ${mouse.py * 4}px)`,
          transition: "transform 0.3s cubic-bezier(0.2,0.8,0.2,1)",
          width: 0, height: 0,
          zIndex: expanded ? 6 : 1,
        }}>
          {/* Left card — cherry blossom pink */}
          <PlayingCard
            rotate={expanded ? -34 : -14}
            bg="linear-gradient(155deg, var(--candy-pink), var(--candy-pink-deep))"
            style={{ left: expanded ? -480 : -260, top: expanded ? 60 : 0 }}
          >
            <Cloud size={90} color="white" style={{ position: "absolute", left: 30, top: 40, opacity: 0.6 }} />
            <Sparkle size={30} color="white" style={{ position: "absolute", left: 50, top: 130 }} />
            <Cloud size={60} color="white" style={{ position: "absolute", right: 20, bottom: 40, opacity: 0.8 }} />
          </PlayingCard>
          {/* Center card — sky blue */}
          <PlayingCard
            rotate={expanded ? -4 : 0}
            bg="linear-gradient(155deg, var(--candy-sky), var(--candy-sky-deep))"
            style={{ left: -130, top: expanded ? -140 : -40 }}
          >
            <Flower size={110} color="var(--candy-maize)" style={{ position: "absolute", left: "50%", top: 90, transform: "translateX(-50%)" }} />
            <Sparkle size={26} color="white" style={{ position: "absolute", left: 40, top: 50 }} />
            <Sparkle size={20} color="white" style={{ position: "absolute", right: 30, top: 240 }} />
            <div className="mono" style={{ position: "absolute", left: 20, bottom: 16, fontSize: 10, color: "white", opacity: 0.85 }}>
              .CARD / 001
            </div>
          </PlayingCard>
          {/* Right card — olivine */}
          <PlayingCard
            rotate={expanded ? 34 : 16}
            bg="linear-gradient(155deg, var(--candy-olive), var(--candy-olive-deep))"
            style={{ left: expanded ? 230 : 10, top: expanded ? 60 : -10 }}
          >
            <Petal size={70} color="var(--candy-fawn)" style={{ position: "absolute", left: 40, top: 40 }} />
            <Flower size={60} color="var(--candy-maize)" style={{ position: "absolute", right: 30, top: 110 }} />
            <Sparkle size={40} color="white" style={{ position: "absolute", left: 60, bottom: 40, opacity: 0.7 }} />
            <Petal size={40} color="var(--candy-pink)" style={{ position: "absolute", right: 40, bottom: 60 }} />
          </PlayingCard>
        </div>

        {/* Center: frosted glass folder */}
        <div
          className="landing-hero__folder"
          onClick={() => setExpanded(v => !v)}
          style={{
            position: "absolute",
            left: "50%", top: 200,
            transform: `translateX(-50%) translate(${mouse.px * -10}px, ${mouse.py * -6}px) scale(${expanded ? 0.92 : 1})`,
            transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)",
            zIndex: 3,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <GlassFolder expanded={expanded} />
        </div>

        {/* Top-right pill */}
        <div className="landing-hero__decor" style={{ position: "absolute", top: 60, right: 40, zIndex: 4, display: "flex", alignItems: "center", gap: 12 }}>
          <PixelHeart scale={3} />
          <span className="pill cn" style={{ fontSize: 14 }}>{lang === "en" ? "Card Library" : "卡片库"}</span>
        </div>

        {/* Right-side pill — posts */}
        <div className="landing-hero__decor" style={{ position: "absolute", top: 720, right: 60, zIndex: 5 }}>
          <span className="pill cn" style={{ fontSize: 15 }}>{lang === "en" ? "Posts" : "帖子"}</span>
        </div>

        {/* Extra pills */}
        <div className="landing-hero__decor" style={{ position: "absolute", top: 100, left: 240, zIndex: 5 }}>
          <span className="pill cn" style={{ fontSize: 14 }}>{lang === "en" ? "Notes" : "笔记"}</span>
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", top: 360, left: 260, zIndex: 5 }}>
          <span className="pill cn" style={{ fontSize: 13 }}>{lang === "en" ? "Saved" : "收藏"}</span>
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", top: 420, left: 60, zIndex: 5 }}>
          <span className="pill cn" style={{ fontSize: 14 }}>{lang === "en" ? "Spark" : "灵感"}</span>
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", top: 620, left: 320, zIndex: 5 }}>
          <span className="pill cn" style={{ fontSize: 13 }}>{lang === "en" ? "To-do" : "待办"}</span>
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", top: 260, right: 360, zIndex: 5 }}>
          <span className="pill cn" style={{ fontSize: 13 }}>{lang === "en" ? "Journal" : "日记"}</span>
        </div>

        {/* Bottom pill */}
        <div className="landing-hero__decor" style={{ position: "absolute", bottom: 260, left: "50%", marginLeft: 80, zIndex: 5 }}>
          <span className="bubble pixel" style={{ fontSize: 9, padding: "8px 14px" }}>CANVAS</span>
        </div>

        {/* Floating pixel sprites */}
        <div className="landing-hero__decor" style={{ position: "absolute", left: 80, top: 240, zIndex: 4 }}>
          <PixelFlower scale={5} />
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", left: 140, top: 520, zIndex: 4 }}>
          <PixelStar scale={4} />
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", right: 80, top: 340, zIndex: 4 }}>
          <PixelHeart scale={4} color="var(--candy-pink-deep)" />
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", right: 200, bottom: 400, zIndex: 4 }}>
          <PixelSparkle scale={4} color="var(--candy-olive-deep)" />
        </div>
        <div className="landing-hero__decor" style={{ position: "absolute", left: 380, top: 120, zIndex: 4 }}>
          <PixelSparkle scale={3} color="var(--candy-fawn-deep)" />
        </div>

        {/* GIANT SERIF DISPLAY WORDMARK */}
        <div className="landing-hero__wordmark" style={{
          position: "absolute",
          left: 0, right: 0, bottom: 80,
          textAlign: "center",
          pointerEvents: "none",
          zIndex: 6,
        }}>
          <div style={{
            lineHeight: 0.9,
            letterSpacing: "-0.04em",
            display: "inline-flex",
            alignItems: "baseline",
            whiteSpace: "nowrap",
          }}>
            <span className="grotesk" style={{
              fontSize: 240,
              fontWeight: 600,
              color: "oklch(0.45 0.08 var(--hue))",
              letterSpacing: "-0.05em",
            }}>card</span>
            <span className="serif" style={{
              fontSize: 240,
              fontStyle: "italic",
              fontWeight: 400,
              color: "var(--candy-sky-deep)",
              marginLeft: 32,
              letterSpacing: "-0.02em",
            }}>note</span>
          </div>
        </div>

        {/* Selection rect UI annotation */}
        {showAnnotations && (
          <div className="sel-rect landing-hero__decor" style={{
            position: "absolute",
            right: 120, bottom: 150,
            width: 140, height: 180,
            zIndex: 7,
          }}>
            <span className="c1"></span>
            <span className="c2"></span>
            <TwinkleStar style={{ top: "22%", left: "28%" }} size={18} color="var(--candy-pink-deep)" delay="0s" />
            <TwinkleStar style={{ top: "50%", left: "62%" }} size={14} color="var(--candy-sky-deep)" delay="0.6s" />
            <TwinkleStar style={{ top: "72%", left: "24%" }} size={12} color="var(--candy-fawn-deep)" delay="1.2s" />
            <TwinkleStar style={{ top: "35%", left: "70%" }} size={10} color="var(--candy-olive-deep)" delay="1.8s" />
          </div>
        )}

        {/* Ghost cursor label */}
        {showAnnotations && (
          <div className="landing-hero__decor" style={{
            position: "absolute",
            left: 140, bottom: 40,
            padding: "4px 10px",
            background: "var(--pink-600)",
            color: "white",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            borderRadius: 4,
            zIndex: 7,
          }}>card · note</div>
        )}

        {/* Card Library pill */}
        <div className="landing-hero__decor" style={{
          position: "absolute", left: 72, bottom: 110, zIndex: 7,
        }}>
          <div className="sel-rect" style={{
            padding: "12px 26px",
            background: "white",
            borderRadius: 8,
            fontSize: 20,
            fontWeight: 700,
            color: "var(--candy-sky-deep)",
            letterSpacing: "-0.01em",
          }}>
            <span className="c1"></span>
            <span className="c2"></span>
            Card Library
          </div>
        </div>

        {/* Tiny mono meta — top-right under the pill */}
        <div className="pixel landing-hero__decor" style={{
          position: "absolute", right: 40, top: 110,
          fontSize: 8, color: "var(--pink-600)",
          zIndex: 4,
        }}>
          V0.0.1 · YOUR EDITION
        </div>

        {/* Ghost wash of the word behind (layered) */}
        {ghost && (
          <div className="landing-hero__ghost" style={{
            position: "absolute",
            left: "50%", top: 620,
            transform: "translateX(-50%)",
            lineHeight: 0.9,
            color: "oklch(0.88 0.08 var(--hue) / 0.45)",
            letterSpacing: "-0.06em",
            pointerEvents: "none",
            zIndex: 2,
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "baseline",
          }}>
            <span className="grotesk" style={{ fontSize: 260 }}>card</span>
            <span className="serif" style={{ fontSize: 260, fontStyle: "italic", marginLeft: 36 }}>note</span>
          </div>
        )}
      </div>

      {heroOnly ? null : (
        <>
          {/* SECTIONS */}
          <FeatureSections />

          {/* CTA */}
          <CTASection />

          {/* PROPERTIES */}
          <PropsSection />

          <Footer />
        </>
      )}
    </div>
  );
}

function FeatureSections() {
  const t = useT();
  const features = [
    {
      kicker: "01 · CARDS",
      title: "Cards.",
      sub: "everything is a card",
      body: t(
        "笔记、文件、链接、任务，全部以统一的卡片承载。属性 · 合集 · 模板 · 关系 — 四件套组合成你自己的思考方式。",
        "Notes, files, links, tasks — all carried by one unified card. Properties · Sets · Templates · Relations: four pieces that compose your way of thinking."
      ),
      glyph: <PixelHeart scale={6} />,
    },
    {
      kicker: "02 · SETS",
      title: "Sets.",
      sub: "group, don't file",
      body: t(
        "一张卡片可以同时属于多个合集。不用强行树形结构 — 按项目、按主题、按情绪，任意交叉都可以。",
        "A card can live in multiple sets at once. No forced tree — group by project, topic, or mood; cross them however you like."
      ),
      glyph: <PixelFlower scale={6} />,
    },
    {
      kicker: "03 · LINKS",
      title: "Links.",
      sub: "relations over folders",
      body: t(
        "链接你的卡片，或者设定自动建卡规则，双向链接自动建立。图谱视图一眼看清你的知识网络。",
        "Link your cards manually, or set rules to auto-create them — bi-directional links happen on their own. The graph view shows your whole knowledge network at a glance."
      ),
      glyph: <PixelStar scale={6} />,
    },
  ];
  return (
    <div className="landing-features" style={{ background: "var(--pink-50)", padding: "140px 48px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--pink-600)", marginBottom: 24 }}>
          .FEATURES / .THREE
        </div>
        <div className="grotesk landing-section__title" style={{ fontSize: 96, lineHeight: 0.95, letterSpacing: "-0.04em", color: "var(--candy-pink-deep)", maxWidth: 900, marginBottom: 80 }}>
          <span style={{ color: "var(--candy-pink-deep)" }}>Cards,</span>{" "}
          <span style={{ color: "var(--candy-olive-deep)" }}>sets</span>
          <span style={{ color: "var(--ink)" }}> &amp; </span>
          <span className="serif" style={{ fontStyle: "italic", fontWeight: 500, color: "var(--candy-fawn-deep)" }}>links.</span>
          <span className="caret" style={{ color: "var(--candy-pink-deep)" }}></span>
        </div>

        <div className="landing-features__grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}>
          {features.map((f, i) => {
            const accent = ["var(--candy-pink-deep)", "var(--candy-olive-deep)", "var(--candy-fawn-deep)"][i];
            return (
            <div key={i} style={{
              background: "white",
              borderRadius: 24,
              padding: "32px 28px",
              border: "1px solid oklch(0.9 0.05 var(--hue))",
              position: "relative",
              overflow: "hidden",
              minHeight: 360,
            }}>
              <div style={{ position: "absolute", right: 24, top: 24, opacity: 0.9 }}>{f.glyph}</div>
              <div className="pixel" style={{ fontSize: 9, color: "var(--pink-600)", marginBottom: 16 }}>
                {f.kicker.toUpperCase()}
              </div>
              <div className="grotesk" style={{ fontSize: 56, lineHeight: 1, color: accent }}>
                {f.title.slice(0, -1)}<span className="serif" style={{ fontStyle: "italic", fontWeight: 500, color: accent }}>{f.title.slice(-1)}</span>
              </div>
              <div style={{ fontSize: 14, color: "var(--pink-600)", marginTop: 8, fontStyle: "italic", fontFamily: "var(--font-serif)" }}>
                {f.sub}
              </div>
              <div className="cn" style={{ fontSize: 14, color: "var(--pink-ink)", lineHeight: 1.7, marginTop: 60 }}>
                {f.body}
              </div>
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}

function CTASection() {
  const tr = useT();
  // Chinese name → English label, used for type tabs and sub-template tiles
  const NAME_EN = {
    "笔记": "Notes", "文件": "Files", "主题": "Topics", "剪藏": "Clips",
    "任务": "Tasks", "项目": "Projects", "开支": "Expenses", "账户": "Accounts",
    "学习": "Study", "读书笔记": "Reading", "视频笔记": "Video", "灵感": "Spark", "日记": "Journal", "摘抄": "Quote",
    "图片": "Image", "视频": "Video", "音频": "Audio", "文档": "Doc", "其他": "Other",
    "人物": "People", "组织": "Org", "地点": "Place", "事件": "Event", "概念": "Concept",
    "书籍": "Book", "影视": "Film/TV", "动漫": "Anime", "音乐": "Music", "游戏": "Game", "课程": "Course", "应用": "App",
    "网页": "Web", "邮件": "Email", "小红书": "Rednote", "B 站": "Bilibili", "微信公众号": "WeChat",
    "抖音": "TikTok", "微博": "Weibo", "知乎": "Zhihu", "豆瓣": "Douban",
    "推特 / X": "Twitter / X",
    "待办": "To-do", "日程": "Schedule", "习惯": "Habit",
    "在做": "Doing", "已归档": "Archived",
    "日常": "Daily", "订阅": "Subscriptions", "报销": "Reimburse",
    "登录": "Logins", "银行卡": "Bank Card", "证件": "ID",
  };
  const dn = (cn) => (NAME_EN[cn] != null ? tr(cn, NAME_EN[cn]) : cn);

  // All 8 core types, each with its sub-template list + visual accent
  const TYPES = [
    {
      key: "note", name: "笔记", icon: "note",
      tint: "var(--candy-pink)", ink: "var(--candy-pink-deep)",
      subs: [
        { name: "学习",     tint: "#C8B8E8",            ink: "#5A4B8A",                 icon: "study",   added: true  },
        { name: "读书笔记", tint: "#E0C4D8",            ink: "#7A4E68",                 icon: "reading", added: false },
        { name: "视频笔记", tint: "#D8C8F0",            ink: "#6A4E9A",                 icon: "video",   added: false },
        { name: "灵感",     tint: "var(--candy-maize)", ink: "#8A6B1A",                 icon: "spark",   added: false },
        { name: "日记",     tint: "var(--candy-fawn)",  ink: "var(--candy-fawn-deep)",  icon: "diary",   added: false },
        { name: "摘抄",     tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "quote",   added: false },
      ],
    },
    {
      key: "file", name: "文件", icon: "file",
      tint: "#D8D4CC", ink: "#5A5448",
      subs: [
        { name: "图片", tint: "#F4D8D0",            ink: "#9E6B5C",                 icon: "image",  added: true  },
        { name: "视频", tint: "#D8C8F0",            ink: "#6A4E9A",                 icon: "video",  added: true  },
        { name: "音频", tint: "#E8D4F0",            ink: "#7A5AA6",                 icon: "audio",  added: true  },
        { name: "文档", tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "doc",    added: true  },
        { name: "其他", tint: "#DDD8CE",            ink: "#6A6458",                 icon: "more",   added: false },
      ],
    },
    {
      key: "topic", name: "主题", icon: "topic",
      tint: "#E8D9F0", ink: "#7A5AA6",
      subs: [
        { name: "人物", tint: "var(--candy-fawn)",  ink: "var(--candy-fawn-deep)",  icon: "person", added: true  },
        { name: "组织", tint: "var(--candy-maize)", ink: "#8A6B1A",                 icon: "org",    added: true  },
        { name: "地点", tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "place",  added: true  },
        { name: "事件", tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)", icon: "event",  added: true  },
        { name: "概念", tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "idea",   added: true  },
        { name: "书籍", tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "book",   added: true  },
        { name: "影视", tint: "var(--candy-fawn)",  ink: "var(--candy-fawn-deep)",  icon: "video",  added: false },
        { name: "动漫", tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "anime",  added: false },
        { name: "音乐", tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "audio",  added: false },
        { name: "游戏", tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)", icon: "game",   added: false },
        { name: "课程", tint: "var(--candy-maize)", ink: "#8A6B1A",                 icon: "study",  added: false },
        { name: "应用", tint: "#D8D4CC",            ink: "#5A5448",                 icon: "app",    added: false },
      ],
    },
    {
      key: "clip", name: "剪藏", icon: "clip",
      tint: "var(--candy-sky)", ink: "var(--candy-sky-deep)",
      subs: [
        { name: "网页",      tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)", icon: "web",       added: true  },
        { name: "邮件",      tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "mail",      added: true  },
        { name: "小红书",    tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "rednote",   added: true  },
        { name: "B 站",      tint: "var(--candy-maize)", ink: "#8A6B1A",                 icon: "bili",      added: true  },
        { name: "微信公众号", tint: "var(--candy-fawn)",  ink: "var(--candy-fawn-deep)",  icon: "wechat",    added: true  },
        { name: "抖音",      tint: "#D8D4CC",            ink: "#3A3838",                 icon: "tiktok",    added: true  },
        { name: "微博",      tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "weibo",     added: true  },
        { name: "知乎",      tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "zhihu",     added: true  },
        { name: "豆瓣",      tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)", icon: "douban",    added: false },
        { name: "Github",   tint: "#E8D9F0",            ink: "#7A5AA6",                 icon: "github",    added: false },
        { name: "推特 / X",  tint: "var(--candy-maize)", ink: "#8A6B1A",                 icon: "x",         added: false },
        { name: "Instagram", tint: "var(--candy-fawn)", ink: "var(--candy-fawn-deep)",  icon: "instagram", added: false },
        { name: "Reddit",   tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "reddit",    added: false },
        { name: "App Store", tint: "var(--candy-sky)",  ink: "var(--candy-sky-deep)",   icon: "appstore",  added: false },
      ],
    },
    {
      key: "task", name: "任务", icon: "task",
      tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)",
      subs: [
        { name: "待办", tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "todo",     added: true },
        { name: "日程", tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "schedule", added: true },
        { name: "习惯", tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)", icon: "habit",    added: true },
      ],
    },
    {
      key: "proj", name: "项目", icon: "proj",
      tint: "#C8D4E8", ink: "#4A5E80",
      subs: [
        { name: "在做",   tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "doing",  added: true  },
        { name: "已归档", tint: "#D8D4CC",            ink: "#5A5448",                 icon: "archive",added: false },
      ],
    },
    {
      key: "cost", name: "开支", icon: "cost",
      tint: "#D6E4D0", ink: "#5A7A4E",
      subs: [
        { name: "日常",  tint: "var(--candy-olive)", ink: "var(--candy-olive-deep)", icon: "daily",  added: true  },
        { name: "订阅",  tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "sub",    added: true  },
        { name: "报销",  tint: "var(--candy-maize)", ink: "#8A6B1A",                 icon: "expense",added: false },
      ],
    },
    {
      key: "acc", name: "账户", icon: "acc",
      tint: "var(--candy-pink)", ink: "var(--candy-pink-deep)",
      subs: [
        { name: "登录",   tint: "var(--candy-fawn)",  ink: "var(--candy-fawn-deep)",  icon: "login", added: true  },
        { name: "银行卡", tint: "var(--candy-sky)",   ink: "var(--candy-sky-deep)",   icon: "card",  added: false },
        { name: "证件",   tint: "var(--candy-pink)",  ink: "var(--candy-pink-deep)",  icon: "id",    added: false },
      ],
    },
  ];

  const [active, setActive] = React.useState("note");
  const [autoCycle, setAutoCycle] = React.useState(true);
  const current = TYPES.find(t => t.key === active);

  // Refs + measured rect for the sliding pill
  const tabBarRef = React.useRef(null);
  const tabRefs = React.useRef([]);
  const [pillRect, setPillRect] = React.useState({ left: 0, top: 0, width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const idx = TYPES.findIndex(t => t.key === active);
    const el = tabRefs.current[idx];
    const bar = tabBarRef.current;
    if (!el || !bar) return;
    const elRect = el.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    setPillRect({
      left: elRect.left - barRect.left + bar.scrollLeft,
      top: elRect.top - barRect.top + bar.scrollTop,
      width: elRect.width,
      height: elRect.height,
    });
  }, [active]);

  // Auto-advance through types every 2.6s until user clicks a tab manually
  React.useEffect(() => {
    if (!autoCycle) return;
    const id = setInterval(() => {
      setActive(prev => {
        const idx = TYPES.findIndex(t => t.key === prev);
        return TYPES[(idx + 1) % TYPES.length].key;
      });
    }, 2600);
    return () => clearInterval(id);
  }, [autoCycle]);

  const TemplateIcon = ({ kind, color, size = 28 }) => {
    const s = { width: size, height: size, display: "block" };
    const paths = {
      note:    <path d="M6 4 h14 a2 2 0 0 1 2 2 v16 l-6 -4 h-10 a2 2 0 0 1 -2 -2 v-10 a2 2 0 0 1 2 -2 z" fill={color}/>,
      file:    <g><path d="M5 5 h9 l5 5 v13 a2 2 0 0 1 -2 2 h-12 a2 2 0 0 1 -2 -2 v-16 a2 2 0 0 1 2 -2 z" fill={color}/><path d="M14 5 v5 h5" fill="none" stroke="white" strokeWidth="1.2"/></g>,
      topic:   <g fill={color}><circle cx="14" cy="6" r="3.5"/><circle cx="22" cy="14" r="3.5"/><circle cx="14" cy="22" r="3.5"/><circle cx="6" cy="14" r="3.5"/></g>,
      clip:    <path d="M18 4 a6 6 0 0 1 6 6 v10 l-6 4 -6 -4 v-10 a6 6 0 0 1 6 -6 z" fill={color}/>,
      task:    <g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 14 l4 4 l10 -10"/><path d="M12 22 l3 3 l9 -9" opacity="0.5"/></g>,
      proj:    <g fill={color}><rect x="4" y="6" width="9" height="9"/><rect x="15" y="6" width="9" height="9" opacity="0.6"/><rect x="4" y="17" width="9" height="5" opacity="0.6"/><rect x="15" y="17" width="9" height="5"/></g>,
      cost:    <g fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><path d="M14 4 v20 M9 8 h7 a3 3 0 0 1 0 6 h-6 a3 3 0 0 0 0 6 h8"/></g>,
      acc:     <path d="M14 4 c3 0 5 2 5 5 v3 h-10 v-3 c0 -3 2 -5 5 -5 z M6 14 h16 v9 a2 2 0 0 1 -2 2 h-12 a2 2 0 0 1 -2 -2 v-9 z" fill={color}/>,
      // Note subs
      study:   <path d="M14 4 l11 5 l-11 5 l-11 -5 z M6 12 v6 c0 2 4 4 8 4 s8 -2 8 -4 v-6" fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round"/>,
      reading: <path d="M4 6 h8 a3 3 0 0 1 3 3 v15 a3 3 0 0 0 -3 -3 h-8 z M24 6 h-8 a3 3 0 0 0 -3 3 v15 a3 3 0 0 1 3 -3 h8 z" fill={color}/>,
      video:   <g><circle cx="14" cy="14" r="11" fill={color}/><path d="M11 9 l8 5 l-8 5 z" fill="white"/></g>,
      spark:   <path d="M14 3 c0 5 2 9 7 11 c-5 2 -7 6 -7 11 c0 -5 -2 -9 -7 -11 c5 -2 7 -6 7 -11 z" fill={color}/>,
      diary:   <g><path d="M6 4 h14 a2 2 0 0 1 2 2 v18 a2 2 0 0 1 -2 2 h-14 z M6 4 v22" fill={color}/><rect x="4" y="10" width="4" height="2" fill="white"/><rect x="4" y="16" width="4" height="2" fill="white"/></g>,
      quote:   <g fill={color}><path d="M4 8 h7 v7 a5 5 0 0 1 -5 5 v-3 a2 2 0 0 0 2 -2 h-4 z"/><path d="M17 8 h7 v7 a5 5 0 0 1 -5 5 v-3 a2 2 0 0 0 2 -2 h-4 z"/></g>,
      // File subs
      image:   <g><rect x="4" y="5" width="20" height="18" rx="2" fill={color}/><circle cx="10" cy="11" r="2" fill="white"/><path d="M4 20 l6 -6 l5 4 l4 -3 l5 5 v3 h-20 z" fill="white"/></g>,
      audio:   <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M6 10 v8 M10 6 v16 M14 9 v10 M18 7 v14 M22 11 v6"/></g>,
      chart:   <g fill={color}><rect x="5" y="16" width="4" height="7"/><rect x="12" y="10" width="4" height="13"/><rect x="19" y="6" width="4" height="17"/></g>,
      doc:     <g><rect x="5" y="4" width="18" height="20" rx="2" fill={color}/><path d="M9 10 h10 M9 14 h10 M9 18 h7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></g>,
      more:    <g fill={color}><circle cx="7" cy="14" r="2.5"/><circle cx="14" cy="14" r="2.5"/><circle cx="21" cy="14" r="2.5"/></g>,
      // Topic subs
      person:  <g fill={color}><circle cx="14" cy="9" r="4.5"/><path d="M5 24 c0 -5 4 -8 9 -8 s9 3 9 8 z"/></g>,
      place:   <path d="M14 4 c5 0 8 3 8 8 c0 6 -8 13 -8 13 s-8 -7 -8 -13 c0 -5 3 -8 8 -8 z M14 9 a3 3 0 1 0 0 6 a3 3 0 0 0 0 -6 z" fill={color}/>,
      event:   <g fill={color}><rect x="4" y="7" width="20" height="16" rx="2"/><rect x="4" y="7" width="20" height="5"/><rect x="8" y="4" width="2" height="6" fill="white"/><rect x="18" y="4" width="2" height="6" fill="white"/></g>,
      pin:     <path d="M14 3 l4 9 l9 1 l-7 6 l2 9 l-8 -5 l-8 5 l2 -9 l-7 -6 l9 -1 z" fill={color}/>,
      idea:    <g fill={color}><circle cx="14" cy="12" r="6"/><rect x="11" y="18" width="6" height="2"/><rect x="11" y="21" width="6" height="2"/><rect x="12" y="24" width="4" height="2"/></g>,
      book:    <path d="M4 5 h8 a3 3 0 0 1 3 3 v16 a3 3 0 0 0 -3 -3 h-8 z M24 5 h-8 a3 3 0 0 0 -3 3 v16 a3 3 0 0 1 3 -3 h8 z" fill={color}/>,
      system:  <g fill="none" stroke={color} strokeWidth="2"><rect x="4" y="4" width="8" height="8"/><rect x="16" y="4" width="8" height="8"/><rect x="4" y="16" width="8" height="8"/><rect x="16" y="16" width="8" height="8"/><path d="M12 8 h4 M8 12 v4 M20 12 v4"/></g>,
      log:     <g fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><path d="M6 6 h16 M6 11 h16 M6 16 h10 M6 21 h13"/></g>,
      list:    <g fill={color}><circle cx="7" cy="8" r="2"/><circle cx="7" cy="14" r="2"/><circle cx="7" cy="20" r="2"/><rect x="12" y="7" width="11" height="2"/><rect x="12" y="13" width="11" height="2"/><rect x="12" y="19" width="11" height="2"/></g>,
      tag:     <g fill={color}><path d="M4 4 h11 l9 9 l-11 11 l-9 -9 z"/><circle cx="10" cy="10" r="2" fill="white"/></g>,
      anth:    <g fill={color}><rect x="4" y="5" width="8" height="18"/><rect x="13" y="5" width="4" height="18" opacity="0.7"/><rect x="18" y="7" width="6" height="16" opacity="0.5"/></g>,
      bond:    <g fill="none" stroke={color} strokeWidth="2"><rect x="4" y="7" width="20" height="14" rx="1.5"/><circle cx="14" cy="14" r="3.5"/><path d="M14 11 v6 M11 14 h6" strokeWidth="1.5"/></g>,
      org:     <g fill={color}><rect x="11" y="3" width="6" height="6"/><rect x="3" y="19" width="6" height="6"/><rect x="11" y="19" width="6" height="6"/><rect x="19" y="19" width="6" height="6"/><path d="M14 9 v4 M6 19 v-3 h16 v3 M14 16 v3" stroke={color} strokeWidth="1.5" fill="none"/></g>,
      anime:   <g fill={color}><circle cx="14" cy="14" r="10"/><circle cx="10" cy="13" r="2.2" fill="white"/><circle cx="18" cy="13" r="2.2" fill="white"/><circle cx="10" cy="13" r="1" fill={color}/><circle cx="18" cy="13" r="1" fill={color}/><path d="M10 19 q4 2 8 0" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></g>,
      game:    <g fill={color}><path d="M6 9 h16 a4 4 0 0 1 4 4 v4 a4 4 0 0 1 -4 4 h-1 l-3 -3 h-8 l-3 3 h-1 a4 4 0 0 1 -4 -4 v-4 a4 4 0 0 1 4 -4 z"/><circle cx="9" cy="15" r="1.5" fill="white"/><circle cx="19" cy="13" r="1.2" fill="white"/><circle cx="22" cy="16" r="1.2" fill="white"/><circle cx="19" cy="17" r="1.2" fill="white"/></g>,
      app:     <g fill={color}><rect x="3" y="3" width="9" height="9" rx="1.5"/><rect x="16" y="3" width="9" height="9" rx="1.5"/><rect x="3" y="16" width="9" height="9" rx="1.5"/><rect x="16" y="16" width="9" height="9" rx="4.5"/></g>,
      // Clip subs
      web:     <g fill="none" stroke={color} strokeWidth="2"><circle cx="14" cy="14" r="10"/><path d="M4 14 h20 M14 4 c3 3 5 7 5 10 s-2 7 -5 10 M14 4 c-3 3 -5 7 -5 10 s2 7 5 10"/></g>,
      rednote: <g fill={color}><rect x="4" y="4" width="20" height="20" rx="5"/><path d="M10 11 v8 l4 -3 l4 3 v-8 z" fill="white"/></g>,
      bili:    <g fill={color}><rect x="3" y="7" width="22" height="15" rx="3"/><rect x="9" y="3" width="2" height="6" transform="rotate(-20 10 6)"/><rect x="17" y="3" width="2" height="6" transform="rotate(20 18 6)"/><circle cx="10" cy="15" r="1.5" fill="white"/><circle cx="18" cy="15" r="1.5" fill="white"/></g>,
      wechat:  <g fill={color}><ellipse cx="11" cy="12" rx="7" ry="6"/><circle cx="9" cy="11" r="1" fill="white"/><circle cx="13" cy="11" r="1" fill="white"/><ellipse cx="19" cy="17" rx="5.5" ry="4.5"/><circle cx="18" cy="16" r="0.8" fill="white"/><circle cx="21" cy="16" r="0.8" fill="white"/></g>,
      tiktok:  <g fill={color}><path d="M17 4 v13 a4 4 0 1 1 -4 -4 v-3 a7 7 0 1 0 7 7 v-8 a7 7 0 0 0 4 1.5 v-3 a4 4 0 0 1 -4 -3.5 z"/></g>,
      weibo:   <g fill={color}><ellipse cx="14" cy="15" rx="10" ry="7"/><circle cx="11" cy="15" r="2.5" fill="white"/><circle cx="12" cy="14.5" r="1" fill={color}/></g>,
      x:        <path d="M5 5 l7 9 l-7 9 h3 l5 -7 l5 7 h4 l-8 -11 l7 -7 h-3 l-5 6 l-4 -6 z" fill={color}/>,
      clipmore: <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M10 6 l10 10 a4 4 0 0 1 -5.6 5.6 l-10 -10 a6 6 0 0 1 8.5 -8.5 l8 8"/></g>,
      mail:     <g><rect x="3" y="6" width="22" height="16" rx="2" fill={color}/><path d="M3 8 l11 8 l11 -8" fill="none" stroke="white" strokeWidth="1.6" strokeLinejoin="round"/></g>,
      zhihu:    <text x="14" y="23" textAnchor="middle" fontSize="22" fontFamily="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" fontWeight="700" fill={color}>知</text>,
      douban:   <g fill={color}><rect x="4" y="4" width="20" height="20" rx="3"/><rect x="7" y="9" width="14" height="2" fill="white"/><rect x="9" y="14" width="10" height="2" fill="white"/><rect x="7" y="19" width="14" height="2" fill="white"/></g>,
      github:   <g fill={color}><path d="M14 3 a11 11 0 0 0 -3.5 21.4 c0.55 0.1 0.75 -0.24 0.75 -0.53 v-1.85 c-3.05 0.66 -3.7 -1.47 -3.7 -1.47 c-0.5 -1.27 -1.22 -1.6 -1.22 -1.6 c-1 -0.68 0.08 -0.67 0.08 -0.67 c1.1 0.08 1.68 1.13 1.68 1.13 c0.98 1.68 2.58 1.2 3.21 0.92 c0.1 -0.71 0.39 -1.2 0.7 -1.48 c-2.43 -0.28 -4.99 -1.22 -4.99 -5.42 c0 -1.2 0.43 -2.18 1.13 -2.94 c-0.11 -0.28 -0.49 -1.4 0.11 -2.92 c0 0 0.92 -0.3 3 1.13 a10.4 10.4 0 0 1 5.46 0 c2.08 -1.43 3 -1.13 3 -1.13 c0.6 1.52 0.22 2.64 0.11 2.92 c0.7 0.76 1.13 1.74 1.13 2.94 c0 4.21 -2.57 5.13 -5.01 5.41 c0.4 0.34 0.75 1.02 0.75 2.05 v3.04 c0 0.3 0.2 0.64 0.76 0.53 a11 11 0 0 0 -3.5 -21.4 z"/></g>,
      instagram:<g fill="none" stroke={color} strokeWidth="2"><rect x="4" y="4" width="20" height="20" rx="5"/><circle cx="14" cy="14" r="5"/><circle cx="20" cy="8" r="1.2" fill={color}/></g>,
      reddit:   <g fill={color}><circle cx="14" cy="16" r="9"/><circle cx="22" cy="6" r="2"/><path d="M14 7 l1 -3 l5 1" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"/><circle cx="11" cy="15" r="1.4" fill="white"/><circle cx="17" cy="15" r="1.4" fill="white"/><path d="M10 19 q4 2.5 8 0" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></g>,
      appstore: <g fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round"><path d="M7 22 l6 -12"/><path d="M21 22 l-6 -12"/><path d="M11 18 h6"/><path d="M8 22 h2"/></g>,
      // Task
      todo:    <g fill="none" stroke={color} strokeWidth="2.2"><rect x="5" y="5" width="18" height="18" rx="3"/></g>,
      done:    <g><rect x="5" y="5" width="18" height="18" rx="3" fill={color}/><path d="M9 14 l4 4 l7 -8" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></g>,
      schedule:<g><rect x="4" y="6" width="20" height="18" rx="2" fill={color}/><rect x="4" y="6" width="20" height="5" fill={color}/><rect x="8" y="3" width="2" height="6" fill="white"/><rect x="18" y="3" width="2" height="6" fill="white"/><rect x="8" y="14" width="3" height="3" fill="white"/><rect x="13" y="14" width="3" height="3" fill="white"/><rect x="18" y="14" width="3" height="3" fill="white"/><rect x="8" y="19" width="3" height="3" fill="white"/><rect x="13" y="19" width="3" height="3" fill="white"/></g>,
      habit:   <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4 c-2 4 -7 6 -7 12 a7 7 0 0 0 14 0 c0 -3 -2 -5 -3 -7"/><path d="M14 14 c-1 1.5 -3 3 -3 5 a3 3 0 0 0 6 0 c0 -2 -2 -3 -3 -5 z" fill={color}/></g>,
      // Project / cost / acc
      doing:   <g fill="none" stroke={color} strokeWidth="2.2"><circle cx="14" cy="14" r="10"/><path d="M14 8 v6 l4 3"/></g>,
      archive: <g fill={color}><rect x="4" y="6" width="20" height="5" rx="1"/><rect x="5" y="12" width="18" height="12" rx="1" opacity="0.7"/><rect x="11" y="16" width="6" height="2" fill="white"/></g>,
      daily:   <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><circle cx="14" cy="14" r="8"/><path d="M14 9 v5 l3 2"/></g>,
      sub:     <g fill={color}><path d="M14 4 v3 M14 21 v3 M4 14 h3 M21 14 h3 M7 7 l2 2 M19 19 l2 2 M7 21 l2 -2 M19 9 l2 -2"/><circle cx="14" cy="14" r="5"/></g>,
      expense: <g fill={color}><rect x="4" y="9" width="20" height="12" rx="2"/><rect x="4" y="12" width="20" height="3" fill="white"/><rect x="18" y="17" width="3" height="2" fill="white"/></g>,
      login:   <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M14 5 v14 M8 11 l-4 3 l4 3 M20 5 h4 v18 h-4"/></g>,
      card:    <g><rect x="3" y="7" width="22" height="14" rx="2.5" fill={color}/><rect x="3" y="10" width="22" height="3" fill="white"/><rect x="17" y="16" width="5" height="2" fill="white"/></g>,
      id:      <g><rect x="4" y="5" width="20" height="18" rx="2" fill={color}/><circle cx="11" cy="12" r="3" fill="white"/><rect x="16" y="11" width="5" height="1.5" fill="white"/><rect x="16" y="14" width="4" height="1.5" fill="white"/><rect x="8" y="18" width="12" height="1.5" fill="white"/></g>,
    };
    return <svg style={s} viewBox="0 0 28 28">{paths[kind] || paths.note}</svg>;
  };

  const TemplateTile = ({ t }) => (
    <div style={{
      aspectRatio: "1 / 1",
      background: "white",
      borderRadius: 14,
      border: "1px solid oklch(0.88 0.03 var(--hue))",
      boxShadow: "0 1px 2px oklch(0.3 0.05 var(--hue) / 0.04)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
    }}>
      <div style={{
        width: 48, height: 48,
        background: t.tint,
        borderRadius: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
        filter: "saturate(0.9)",
      }}>
        <TemplateIcon kind={t.icon} color={t.ink} />
      </div>
      <div className="cn" style={{ fontSize: 13, fontWeight: 500, color: "var(--pink-ink)" }}>{dn(t.name)}</div>
    </div>
  );

  return (
    <div className="landing-templates" style={{
      position: "relative",
      padding: "60px 48px 100px",
      background: "var(--pink-50)",
      overflow: "hidden",
    }}>
      <div style={{ position: "relative", maxWidth: 1300, margin: "0 auto" }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--pink-600)", marginBottom: 24 }}>
          .TEMPLATES / .CATALOG
        </div>
        <div className="landing-section__title" style={{
          fontSize: 96, lineHeight: 0.95,
          maxWidth: 900, marginBottom: 20,
          display: "flex", alignItems: "baseline", gap: 24,
        }}>
          <span className="grotesk" style={{
            color: "var(--candy-pink-deep)",
            letterSpacing: "-0.04em",
            fontWeight: 500,
          }}>{tr("合集", "Set")}</span>
          <span className="serif" style={{
            fontSize: 88,
            color: "var(--candy-olive-deep)",
            fontStyle: "normal",
            fontWeight: 500,
            letterSpacing: "0em",
          }}>
            {tr("模板.", "templates.")}
          </span>
        </div>

        {/* Type selector — segmented tabs with sliding pill indicator */}
        <div ref={tabBarRef} className="landing-templates__tabs" style={{
          position: "relative",
          display: "flex",
          gap: 8,
          background: "white",
          padding: 8,
          borderRadius: 16,
          border: "1px solid oklch(0.9 0.03 var(--hue))",
          marginBottom: 20,
          overflowX: "auto",
        }}>
          {/* Sliding pill — sits behind active tab */}
          <div style={{
            position: "absolute",
            top: pillRect.top,
            left: pillRect.left,
            width: pillRect.width,
            height: pillRect.height,
            background: current.tint,
            borderRadius: 10,
            filter: "saturate(0.9)",
            transition: "left 0.55s cubic-bezier(0.34, 1.3, 0.5, 1), top 0.55s cubic-bezier(0.34, 1.3, 0.5, 1), width 0.55s cubic-bezier(0.34, 1.3, 0.5, 1), background 0.4s ease",
            pointerEvents: "none",
            zIndex: 0,
          }} />
          {TYPES.map((t, i) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                ref={el => (tabRefs.current[i] = el)}
                onClick={() => { setAutoCycle(false); setActive(t.key); }}
                style={{
                  position: "relative",
                  zIndex: 1,
                  flex: "1 1 0",
                  minWidth: 110,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  background: isActive ? "oklch(1 0 0 / 0.5)" : t.tint,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  filter: isActive ? "none" : "saturate(0.9)",
                  flexShrink: 0,
                  transition: "background 0.4s ease",
                }}>
                  <TemplateIcon kind={t.icon} color={t.ink} size={16} />
                </div>
                <span className="cn" style={{
                  fontSize: 14,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? "oklch(0.22 0.05 var(--hue))" : "var(--pink-ink)",
                  transition: "color 0.3s ease, font-weight 0.3s ease",
                }}>{dn(t.name)}</span>
                <span className="mono" style={{
                  fontSize: 10,
                  color: isActive ? "oklch(0.3 0.08 var(--hue))" : "var(--pink-600)",
                  opacity: isActive ? 0.75 : 0.6,
                }}>{String(t.subs.length).padStart(2, "0")}</span>
              </button>
            );
          })}
        </div>

        {/* Active type's sub-template grid */}
        <div style={{
          background: "white",
          borderRadius: 18,
          padding: "32px 32px 32px",
          border: "1px solid oklch(0.9 0.03 var(--hue))",
          boxShadow: "0 2px 4px oklch(0.3 0.05 var(--hue) / 0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="cn" style={{ fontSize: 18, fontWeight: 600, color: "var(--pink-ink)" }}>
                {dn(current.name)}
              </div>
              <span className="mono" style={{ fontSize: 10, color: "var(--pink-600)", letterSpacing: "0.1em" }}>
                .{current.key.toUpperCase()} / .{String(current.subs.length).padStart(2, "0")}
              </span>
            </div>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              border: "1px solid oklch(0.85 0.04 var(--hue))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, color: "var(--pink-600)", cursor: "pointer",
            }}>+</div>
          </div>
          <div className="landing-templates__grid" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 18 }}>
            {current.subs.map((t, i) => <TemplateTile key={i} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PropsSection() {
  const t = useT();
  // Property types available
  const PROP_TYPES = [
    { key: "text",    cn: "文本", en: "Text",     icn: "T",  color: "var(--candy-sky-deep)" },
    { key: "tag",     cn: "标签", en: "Tag",      icn: "#",  color: "var(--candy-pink-deep)" },
    { key: "select",  cn: "选项", en: "Select",   icn: "▾",  color: "var(--candy-olive-deep)" },
    { key: "rating",  cn: "评分", en: "Rating",   icn: "★",  color: "var(--candy-fawn-deep)" },
    { key: "date",    cn: "日期", en: "Date",     icn: "◷",  color: "var(--candy-maize)" },
    { key: "number",  cn: "数字", en: "Number",   icn: "0",  color: "var(--candy-pink-deep)" },
    { key: "check",   cn: "复选", en: "Check",    icn: "✓",  color: "var(--candy-olive-deep)" },
    { key: "color",   cn: "颜色", en: "Color",    icn: "●",  color: "var(--candy-sky-deep)" },
    { key: "url",     cn: "链接", en: "URL",      icn: "↗",  color: "var(--candy-fawn-deep)" },
    { key: "relation",cn: "关系", en: "Relation", icn: "↔",  color: "var(--candy-pink-deep)" },
    { key: "file",    cn: "文件", en: "File",     icn: "◨",  color: "var(--candy-sky-deep)" },
    { key: "person",  cn: "作者", en: "Author",   icn: "◉",  color: "var(--candy-olive-deep)" },
  ];

  // Mocked card props, each row shows a different property type
  const cardProps = [
    { type: "tag",     name: t("标签", "Tags"),       value: t(["灵感", "设计"], ["Spark", "Design"]) },
    { type: "select",  name: t("状态", "Status"),     value: { label: t("进行中", "In progress"), color: "var(--candy-sky-deep)" } },
    { type: "rating",  name: t("评分", "Rating"),     value: 4 },
    { type: "date",    name: t("创建于", "Created"),  value: "2026·03·21" },
    { type: "color",   name: t("颜色", "Color"),      value: "var(--candy-pink-deep)" },
    { type: "relation",name: t("相关", "Related"),    value: t("@ 产品设计 · 第 0.5 版", "@ Product design · v0.5") },
    { type: "number",  name: t("阅读", "Read"),       value: "12 min" },
    { type: "person",  name: t("作者", "Author"),     value: "@you" },
  ];

  return (
    <div className="landing-props" style={{
      position: "relative",
      padding: "100px 48px 120px",
      background: "var(--pink-100)",
      overflow: "hidden",
      borderTop: "1px solid oklch(0.88 0.04 var(--hue) / 0.6)",
    }}>
      <div style={{ position: "relative", maxWidth: 1300, margin: "0 auto" }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--pink-600)", marginBottom: 24 }}>
          .PROPERTIES / .CUSTOM
        </div>
        <div className="landing-section__title" style={{
          fontSize: 96, lineHeight: 0.95,
          marginBottom: 80,
          display: "flex", alignItems: "baseline", gap: 24,
        }}>
          <span className="grotesk" style={{
            color: "var(--candy-sky-deep)",
            letterSpacing: "-0.04em",
            fontWeight: 500,
          }}>{t("自定义", "Custom")}</span>
          <span className="serif" style={{
            fontSize: 88,
            color: "var(--candy-pink-deep)",
            fontWeight: 500,
          }}>
            {t("属性.", "properties.")}
          </span>
        </div>

        <div className="landing-props__grid" style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1.3fr",
          gap: 64,
          alignItems: "start",
        }}>
          {/* LEFT — copy + type chips */}
          <div>
            <div className="cn" style={{
              fontSize: 22, lineHeight: 1.6,
              color: "var(--pink-ink)",
              marginBottom: 32,
              maxWidth: 520,
            }}>
              {t(
                <>给卡片加上它需要的<span style={{ color: "var(--candy-pink-deep)", fontWeight: 600 }}>任何字段</span>——标签、评分、日期、颜色、关系……你定义一次，整个合集都自动继承。</>,
                <>Give a card <span style={{ color: "var(--candy-pink-deep)", fontWeight: 600 }}>any field</span> it needs — tags, ratings, dates, colors, relations… Define it once and the whole set inherits it.</>
              )}
            </div>

            <div className="cn" style={{ fontSize: 14, color: "var(--pink-600)", marginBottom: 16 }}>
              {t("十二种属性类型", "Twelve property types")}
            </div>
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 10,
              maxWidth: 520,
            }}>
              {PROP_TYPES.map(p => (
                <div key={p.key} style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "8px 14px",
                  background: "white",
                  border: "1px solid oklch(0.9 0.03 var(--hue))",
                  borderRadius: 999,
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 6,
                    background: p.color,
                    color: "white",
                    fontSize: 11, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
                  }}>{p.icn}</span>
                  <span className="cn" style={{ fontSize: 13, color: "var(--pink-ink)", fontWeight: 500 }}>
                    {t(p.cn, p.en)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 40,
              padding: "20px 24px",
              background: "white",
              borderRadius: 16,
              border: "1px dashed oklch(0.82 0.06 var(--hue))",
              maxWidth: 520,
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "var(--candy-pink)",
                filter: "saturate(0.9)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "white", fontWeight: 700, fontSize: 18,
              }}>＋</div>
              <div>
                <div className="cn" style={{ fontSize: 15, color: "var(--pink-ink)", fontWeight: 600 }}>
                  {t("或者，写一个公式字段", "Or write a formula field")}
                </div>
                <div className="cn" style={{ fontSize: 13, color: "var(--pink-600)", marginTop: 2 }}>
                  {t("引用其他属性，自动计算。", "Reference other properties; computed automatically.")}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — mocked card with properties panel */}
          <div style={{ position: "relative" }}>
            {/* card */}
            <div style={{
              background: "white",
              borderRadius: 20,
              border: "1px solid oklch(0.88 0.04 var(--hue))",
              boxShadow: "0 20px 60px -20px oklch(0.5 0.15 var(--hue) / 0.25)",
              overflow: "hidden",
            }}>
              {/* card header */}
              <div style={{
                padding: "20px 28px 16px",
                borderBottom: "1px solid oklch(0.92 0.02 var(--hue))",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  display: "inline-block",
                  width: 10, height: 10, borderRadius: "50%",
                  background: "var(--candy-pink-deep)",
                }}></span>
                <span className="mono" style={{ fontSize: 10, color: "var(--pink-600)", letterSpacing: "0.1em" }}>
                  CARD · #042
                </span>
                <span style={{ flex: 1 }}></span>
                <span className="cn" style={{ fontSize: 11, color: "var(--pink-600)" }}>
                  {t("最后编辑 · 2 分钟前", "Edited · 2 min ago")}
                </span>
              </div>

              {/* card title */}
              <div style={{ padding: "24px 28px 8px" }}>
                <div className="cn" style={{ fontSize: 24, fontWeight: 600, color: "var(--pink-ink)", marginBottom: 8 }}>
                  {t("给粉色版本做落地页", "Build a landing page for the pink edition")}
                </div>
                <div className="cn" style={{ fontSize: 14, color: "var(--pink-600)", lineHeight: 1.6 }}>
                  {t(
                    "卡片不只是一段文字——它是一个可以带属性的对象。下面这些都是这张卡片身上的字段。",
                    "A card is more than text — it's an object that can carry properties. Everything below is a field on this card."
                  )}
                </div>
              </div>

              {/* properties panel */}
              <div style={{ padding: "20px 28px 24px" }}>
                <div className="mono" style={{
                  fontSize: 10, color: "var(--pink-600)",
                  marginBottom: 12, letterSpacing: "0.12em",
                }}>
                  .PROPERTIES
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {cardProps.map((p, i) => {
                    const meta = PROP_TYPES.find(t => t.key === p.type);
                    return (
                      <div key={i} style={{
                        display: "grid",
                        gridTemplateColumns: "140px 1fr",
                        alignItems: "center",
                        gap: 16,
                        padding: "10px 0",
                        borderBottom: i < cardProps.length - 1 ? "1px dashed oklch(0.92 0.02 var(--hue))" : "none",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            width: 18, height: 18, borderRadius: 5,
                            background: meta.color,
                            color: "white",
                            fontSize: 10, fontWeight: 700,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            lineHeight: 1,
                          }}>{meta.icn}</span>
                          <span className="cn" style={{ fontSize: 13, color: "var(--pink-600)" }}>
                            {p.name}
                          </span>
                        </div>
                        <div>
                          <PropValue prop={p} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* add property row */}
                <div style={{
                  marginTop: 12,
                  padding: "8px 0",
                  display: "flex", alignItems: "center", gap: 8,
                  color: "var(--pink-600)",
                  cursor: "pointer",
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5,
                    background: "oklch(0.93 0.03 var(--hue))",
                    color: "var(--pink-600)",
                    fontSize: 11, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
                  }}>＋</span>
                  <span className="cn" style={{ fontSize: 13 }}>{t("添加属性", "Add property")}</span>
                </div>
              </div>
            </div>

            {/* floating annotation */}
            <div style={{
              position: "absolute",
              top: -20, right: -16, zIndex: 3,
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 14px",
              background: "var(--candy-pink-deep)",
              color: "white",
              borderRadius: 999,
              fontSize: 12, fontWeight: 600,
              boxShadow: "0 10px 30px -10px oklch(0.5 0.2 355 / 0.5)",
              transform: "rotate(4deg)",
            }}>
              <span className="cn">{t("八个字段，一张卡片", "Eight fields, one card")}</span>
            </div>

            <div style={{
              position: "absolute",
              bottom: -24, left: -20, zIndex: 3,
            }}>
              <TwinkleStar size={20} color="var(--candy-sky-deep)" delay="0s" style={{ position: "static", opacity: 1 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PropValue({ prop }) {
  if (prop.type === "tag") {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        {prop.value.map((t, i) => (
          <span key={i} className="cn" style={{
            padding: "3px 10px",
            background: i === 0 ? "oklch(0.95 0.08 355)" : "oklch(0.94 0.06 140)",
            color: i === 0 ? "var(--candy-pink-deep)" : "var(--candy-olive-deep)",
            borderRadius: 999,
            fontSize: 12, fontWeight: 500,
          }}>{t}</span>
        ))}
      </div>
    );
  }
  if (prop.type === "select") {
    return (
      <span className="cn" style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 10px",
        background: "oklch(0.95 0.05 220)",
        color: prop.value.color,
        borderRadius: 6,
        fontSize: 12, fontWeight: 500,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: prop.value.color }}></span>
        {prop.value.label}
      </span>
    );
  }
  if (prop.type === "rating") {
    return (
      <div style={{ display: "flex", gap: 2, color: "var(--candy-fawn-deep)", fontSize: 14 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} style={{ opacity: i < prop.value ? 1 : 0.25 }}>★</span>
        ))}
      </div>
    );
  }
  if (prop.type === "color") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 16, height: 16, borderRadius: 4,
          background: prop.value,
          border: "1px solid oklch(0.9 0.03 var(--hue))",
        }}></span>
        <span className="mono" style={{ fontSize: 11, color: "var(--pink-600)" }}>
          candy-pink
        </span>
      </span>
    );
  }
  if (prop.type === "relation") {
    return (
      <span className="cn" style={{
        fontSize: 13, color: "var(--candy-sky-deep)",
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textUnderlineOffset: 3,
      }}>{prop.value}</span>
    );
  }
  if (prop.type === "person") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 18, height: 18, borderRadius: "50%",
          background: "var(--candy-pink-deep)",
          color: "white", fontSize: 10, fontWeight: 700,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>Y</span>
        <span className="cn" style={{ fontSize: 13, color: "var(--pink-ink)" }}>{prop.value}</span>
      </span>
    );
  }
  // default — text / date / number
  return (
    <span className="cn" style={{ fontSize: 13, color: "var(--pink-ink)" }}>{prop.value}</span>
  );
}

function Footer() {
  const t = useT();
  const { lang } = useLang();
  const cols = [
    {
      title: "产品",
      titleEn: "PRODUCT",
      links: [
        { cn: "概览",       en: "Overview" },
        { cn: "卡片类型",   en: "Card types" },
        { cn: "合集模板",   en: "Templates" },
        { cn: "更新日志",   en: "Changelog" },
        { cn: "价格",       en: "Pricing" },
      ],
    },
    {
      title: "资源",
      titleEn: "RESOURCES",
      links: [
        { cn: "使用指南",   en: "Guide" },
        { cn: "键盘快捷键", en: "Shortcuts" },
        { cn: "社区范例",   en: "Community" },
        { cn: "导入工具",   en: "Import" },
        { cn: "开发者 API", en: "API" },
      ],
    },
    {
      title: "关于",
      titleEn: "ABOUT",
      links: [
        { cn: "项目故事",   en: "Story" },
        { cn: "博客",       en: "Blog" },
        { cn: "隐私政策",   en: "Privacy" },
        { cn: "服务条款",   en: "Terms" },
        { cn: "联系我",     en: "Contact" },
      ],
    },
    {
      title: "社交",
      titleEn: "ELSEWHERE",
      links: [
        { cn: "小红书",     en: "@cardnote",      nameEn: "Rednote" },
        { cn: "微博",       en: "@cardnote",      nameEn: "Weibo" },
        { cn: "X / Twitter",en: "@cardnote_app",  nameEn: "Twitter / X" },
        { cn: "GitHub",     en: "/cardnote",      nameEn: "GitHub" },
        { cn: "邮件订阅",   en: "newsletter",     nameEn: "Newsletter" },
      ],
    },
  ];

  return (
    <div className="landing-footer" style={{
      padding: "80px 48px 40px",
      background: "var(--pink-100)",
      borderTop: "1px solid oklch(0.85 0.08 var(--hue) / 0.5)",
    }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Top row — brand + newsletter */}
        <div className="landing-footer__top" style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
          gap: 40,
          paddingBottom: 60,
          borderBottom: "1px solid oklch(0.85 0.08 var(--hue) / 0.5)",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <CardnoteLogo size={48} />
              <div>
                <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, color: "var(--pink-ink)", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  cardnote
                </div>
                <div className="serif" style={{ fontSize: 13, fontStyle: "italic", color: "var(--pink-600)", marginTop: 4 }}>
                  one card, one moment, one set.
                </div>
              </div>
            </div>
            <div className="cn" style={{ fontSize: 13, color: "var(--pink-ink)", lineHeight: 1.7, maxWidth: 320, marginBottom: 24 }}>
              {t(
                "一张卡片，一刻时间，一个合集。为喜欢整理、喜欢回看、喜欢把日常放进盒子的人做的。",
                "One card, one moment, one set — for people who like to organize, revisit, and tuck the everyday into boxes."
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                placeholder={t("你的邮箱", "Your email")}
                className="cn"
                style={{
                  flex: 1, maxWidth: 220,
                  padding: "10px 14px", borderRadius: 999,
                  border: "1px solid oklch(0.82 0.04 var(--hue))",
                  background: "white",
                  fontSize: 13, color: "var(--pink-ink)",
                  fontFamily: "var(--font-cn)",
                  outline: "none",
                }}
              />
              <button className="cn" style={{
                padding: "10px 18px", borderRadius: 999,
                background: "var(--pink-ink)", color: "var(--pink-50)",
                border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600,
                fontFamily: "var(--font-cn)",
              }}>
                {t("订阅 →", "Subscribe →")}
              </button>
            </div>
          </div>

          {cols.map(col => (
            <div key={col.title}>
              <div style={{ marginBottom: 20 }}>
                <div className="cn" style={{ fontSize: 13, fontWeight: 700, color: "var(--pink-ink)", marginBottom: 2 }}>
                  {t(col.title, col.titleEn.charAt(0) + col.titleEn.slice(1).toLowerCase())}
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--pink-600)", letterSpacing: "0.12em" }}>
                  .{col.titleEn}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map(l => (
                  <a key={l.cn} href="#" style={{
                    display: "flex", alignItems: "baseline", gap: 8,
                    textDecoration: "none",
                  }}>
                    <span className="cn" style={{ fontSize: 13, color: "var(--pink-ink)" }}>{t(l.cn, l.nameEn ?? l.en)}</span>
                    {lang === "en" ? null : (
                      <span className="mono" style={{ fontSize: 9, color: "var(--pink-600)", opacity: 0.7 }}>
                        {l.en}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom row */}
        <div className="landing-footer__bottom" style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          paddingTop: 32, gap: 24, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--pink-ink)", fontWeight: 700, letterSpacing: "0.1em" }}>
              © 2026 CARDNOTE
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--pink-600)", letterSpacing: "0.1em" }}>
              {t("MADE IN SYDNEY · 悉尼", "MADE IN SYDNEY")}
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--pink-600)", letterSpacing: "0.1em" }}>
              YOUR EDITION · v0.0.1
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span className="serif" style={{ fontSize: 12, fontStyle: "italic", color: "var(--pink-600)" }}>
              {t("一张卡片 · 一刻时间 · 一个合集", "one card · one moment · one set")}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                "var(--candy-pink-deep)",
                "var(--candy-sky-deep)",
                "var(--candy-fawn-deep)",
                "var(--candy-olive-deep)",
                "var(--candy-maize)",
              ].map((c, i) => (
                <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: c, filter: "saturate(0.9)" }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 原子组件导出：供 LoginScene、ChangelogPage 等兄弟场景复用同谱系的装饰元素
export {
  PinkLanding,
  TopBar,
  Footer,
  useT,
  useLang,
  Flower,
  Sparkle,
  Petal,
  Cloud,
  CardnoteLogo,
  TwinkleStar,
  PixelHeart,
  PixelStar,
  PixelSparkle,
  PixelFlower,
};
