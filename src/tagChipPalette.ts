import type { CSSProperties } from "react";

/** 标签药丸配色（按标签名稳定哈希），贴近 Notion pastel */
const PALETTES: readonly { bg: string; fg: string }[] = [
  { bg: "#E3F2E1", fg: "#2D5D39" },
  { bg: "#EDE2FE", fg: "#5B3096" },
  { bg: "#E1F0FF", fg: "#2E5A89" },
  { bg: "#FFE2E2", fg: "#9B3B3B" },
  { bg: "#F1F1EF", fg: "#37352F" },
  { bg: "#FDECC8", fg: "#8A5A00" },
  { bg: "#E8DEF8", fg: "#4A2C7A" },
  { bg: "#D3E5EF", fg: "#1D4E6F" },
];

export function tagChipInlineStyle(name: string): CSSProperties {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const p = PALETTES[Math.abs(h) % PALETTES.length]!;
  return { backgroundColor: p.bg, color: p.fg };
}
