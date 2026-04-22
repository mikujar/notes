const FALLBACK_DOT_COLOR = "rgba(55, 53, 47, 0.35)";
/** 小尺寸图标太淡看不清时，限制最亮的 L 值（HSL 百分比） */
const MAX_GLYPH_LIGHTNESS = 58;
/** 同时拉一下饱和度下限，避免几近灰色时被"拉深"成纯灰 */
const MIN_GLYPH_SATURATION = 40;

function normalizeRgba(color: string): string | null {
  const m = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => s.trim());
  if (parts.length < 3) return null;
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  if (![r, g, b].every(Number.isFinite)) return null;
  const rawA = parts.length >= 4 ? Number(parts[3]) : 1;
  const a = Number.isFinite(rawA) ? rawA : 1;
  // Sidebar dots should be readable even when catalog tint uses very low alpha.
  const boostedA = Math.max(0.72, Math.min(1, a));
  return `rgba(${r}, ${g}, ${b}, ${boostedA})`;
}

export function toReadableSidebarDotColor(color?: string | null): string {
  const value = color?.trim();
  if (!value) return FALLBACK_DOT_COLOR;
  return normalizeRgba(value) ?? value;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHsl(r: number, g: number, b: number) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr:
        h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
        break;
      case gg:
        h = ((bb - rr) / d + 2) * 60;
        break;
      default:
        h = ((rr - gg) / d + 4) * 60;
    }
  }
  return { h, s: s * 100, l: l * 100 };
}

/**
 * 小尺寸图标用色：保留色相、把亮度锁到 ≤ {@link MAX_GLYPH_LIGHTNESS}、饱和度抬到 ≥
 * {@link MIN_GLYPH_SATURATION}，这样用户选的浅色也不会在 14–20px 的图标上糊掉。
 * 传入 `hsl(...)` / `#hex` / `rgb(...)`；解析不出来时原样返回。
 */
export function toContrastyGlyphColor(color?: string | null): string {
  const value = color?.trim();
  if (!value) return FALLBACK_DOT_COLOR;

  /** HSL：直接解析再夹 */
  const hslMatch = value.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i
  );
  if (hslMatch) {
    const h = Number(hslMatch[1]);
    const s = Number(hslMatch[2]);
    const l = Number(hslMatch[3]);
    const clampedL = Math.min(l, MAX_GLYPH_LIGHTNESS);
    const boostedS = Math.max(s, MIN_GLYPH_SATURATION);
    return `hsl(${h} ${boostedS}% ${clampedL}%)`;
  }

  /** #hex：转 HSL 再夹 */
  const rgb = hexToRgb(value);
  if (rgb) {
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const clampedL = Math.min(l, MAX_GLYPH_LIGHTNESS);
    const boostedS = Math.max(s, MIN_GLYPH_SATURATION);
    return `hsl(${h.toFixed(1)} ${boostedS.toFixed(1)}% ${clampedL.toFixed(1)}%)`;
  }

  /** rgba(...)：同理 */
  const rgbMatch = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const { h, s, l } = rgbToHsl(r, g, b);
    const clampedL = Math.min(l, MAX_GLYPH_LIGHTNESS);
    const boostedS = Math.max(s, MIN_GLYPH_SATURATION);
    return `hsl(${h.toFixed(1)} ${boostedS.toFixed(1)}% ${clampedL.toFixed(1)}%)`;
  }

  return value;
}

