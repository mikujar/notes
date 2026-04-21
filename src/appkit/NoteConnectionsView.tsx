/**
 * 笔记探索白板：边来自全库的 relatedRefs（云端由 card_links 注入）。
 * 子图查询可用 {@link fetchCardGraphFromApi}（GET /api/cards/:id/graph?depth=&linkTypes=）。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppUiLang } from "../appUiLang";
import { useAppChrome } from "../i18n/useAppChrome";
import { noteBodyToHtml } from "../noteEditor/plainHtml";
import { CardGallery } from "../CardGallery";
import { CardTagsRow } from "../CardTagsRow";
import { CardRowInner } from "../CardRowInner";
import {
  formatCardReminderBesideTime,
  formatCardTimeLabel,
} from "../cardTimeLabel";
import { plainTextFromNoteHtml } from "../notePlainText";
import type { ConnectionEdge } from "./connectionEdges";
import type { Collection, NoteCard } from "../types";
import { getPresetKindMeta } from "../notePresetTypesCatalog";
import {
  CardAskAiPanel,
  type CardAskAiContext,
  type CardAskAiGate,
  type CardAskAiRelatedEntry,
} from "./CardAskAiPanel";

/** 笔记探索「问 AI」：暂时关闭；改回 true 恢复入口与侧栏 */
const NOTE_CONNECTIONS_ASK_AI_ENABLED = false;

const WORLD = 8000;
/** 减轻 transform 亚像素合成分辨率导致的文字、描边发糊 */
function snapZoom(z: number): number {
  return Math.round(z * 10000) / 10000;
}
function snapPan(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
  };
}
/** 连线在屏幕上的像素线宽；灰线 / 黄线共用，避免叠两层粗细不一 */
const BOARD_LINK_WIDTH_PX = 2;
/** 白板底上的实色灰（等价于 rgba(55,53,47,.2) 叠白），无 alpha，叠线不会加深 */
const BOARD_LINK_GRAY = "#d8d7d5";
const BOARD_LINK_PULSE = "rgba(250, 204, 21, 0.52)";
/** 从左侧灰条拖出关联线预览 */
const BOARD_LINK_DRAFT = "rgba(59, 130, 246, 0.92)";
/** 与 .connections-board__node-wrap 典型宽度一致；高度随内容变化，由 DOM 实测 */
const DEFAULT_HALF_W = 210;
const DEFAULT_HALF_H = 92;
/** 卡片之间额外留白（在「刚好不重叠」的中心距上再加一圈） */
const LAYOUT_EDGE_GAP = 110;
/** 锚点坐标差小于此值时视为共线，避免 V–H–V / H–V–H 产生 1～2px 的锯齿段 */
const ORTHO_ALIGN_EPS = 4;
/**
 * 上下边对接时 |Δx|、左右边对接时 |Δy| 小于此值则强制轴对齐直线（不再走 V–H–V / H–V–H / 主干弯折）。
 * 略大于布局网格，避免「明明可对齐却绕远」。
 */
const ORTHO_STRAIGHT_EPS = 32;
/** 从边中点沿法线外伸，使折角落在卡片外侧间隙，避免折角压在卡片底下/内部 */
const ORTHO_STUB_MIN = 14;
const ORTHO_STUB_MAX = 38;
/**
 * edgeMidpointAnchors：仅当水平位移明显大于垂直位移时才用左右边中点，否则用上下边。
 * 否则「略纵向」的两卡也会走左右口，V–V 正交路径的第一段水平干线会从卡片腰部横穿进白区，与圆角/灰条叠成多余线段。
 */
const LR_PORT_DOMINANCE = 1.22;

/** 从连接边收集与当前卡相连的其它卡（全文纯文本 + 合集名），供问 AI */
function relatedCardsPayloadForAskAi(
  edges: ConnectionEdge[],
  colId: string,
  cardId: string
): CardAskAiRelatedEntry[] {
  const seen = new Set<string>();
  const out: CardAskAiRelatedEntry[] = [];
  for (const e of edges) {
    const fromMatch = e.fromCol.id === colId && e.fromCard.id === cardId;
    const toMatch = e.toCol.id === colId && e.toCard.id === cardId;
    if (!fromMatch && !toMatch) continue;
    const oCol = fromMatch ? e.toCol : e.fromCol;
    const oCard = fromMatch ? e.toCard : e.fromCard;
    const key = `${oCol.id}\0${oCard.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      collectionName: oCol.name || "",
      text: plainTextFromNoteHtml(oCard.text || ""),
      media: oCard.media,
    });
  }
  return out;
}
/** 力导向结束后将中心吸附到网格，线条更易与「主干」对齐，观感更接近地铁图 */
const LAYOUT_GRID = 24;

/** 输出到 path 的坐标取整，避免亚像素导致相邻竖段/横段与卡片边不对齐 */
function snapSvgCoord(v: number): number {
  return Math.round(v);
}

function snapPathCoordsInD(d: string): string {
  return d.replace(
    /-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/gi,
    (m) => String(Math.round(parseFloat(m)))
  );
}

/** 解析仅含 M/L 的正交路径，去掉重复折点与零长段，避免亚像素/舍入后出现悬空短线头 */
function compactMlPathD(d: string): string | null {
  const s = d.trim();
  if (!s) return null;
  const pts: [number, number][] = [];
  const re =
    /[MmLl]\s*([-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][-+]?\d+)?)\s*([-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = pts[pts.length - 1];
    if (
      !prev ||
      Math.abs(prev[0] - x) > 0.75 ||
      Math.abs(prev[1] - y) > 0.75
    ) {
      pts.push([x, y]);
    }
  }
  if (pts.length < 2) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1]
    );
  }
  if (total < 2) return null;
  let out = `M ${snapSvgCoord(pts[0][0])} ${snapSvgCoord(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    out += ` L ${snapSvgCoord(pts[i][0])} ${snapSvgCoord(pts[i][1])}`;
  }
  return out;
}

type BoxHalf = { hw: number; hh: number };

/**
 * 无向边：从两卡各自朝向对侧的那条边的中点进出；端点顺序按 id 字典序稳定。
 * exit/entry：落在左/右边中点则为竖直边（法线水平）；落在上/下边中点则为水平边（法线竖直）。
 */
function edgeMidpointAnchors(
  ax: number,
  ay: number,
  a: BoxHalf,
  bx: number,
  by: number,
  b: BoxHalf
): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  exitEdgeVertical: boolean;
  entryEdgeVertical: boolean;
} {
  const dx = bx - ax;
  const dy = by - ay;
  const useLeftRightPorts =
    Math.abs(dx) >= Math.abs(dy) * LR_PORT_DOMINANCE;
  if (useLeftRightPorts) {
    const x1 = dx >= 0 ? ax + a.hw : ax - a.hw;
    const x2 = dx >= 0 ? bx - b.hw : bx + b.hw;
    return {
      x1,
      y1: ay,
      x2,
      y2: by,
      exitEdgeVertical: true,
      entryEdgeVertical: true,
    };
  }
  const y1 = dy >= 0 ? ay + a.hh : ay - a.hh;
  const y2 = dy >= 0 ? by - b.hh : by + b.hh;
  return {
    x1: ax,
    y1,
    x2: bx,
    y2,
    exitEdgeVertical: false,
    entryEdgeVertical: false,
  };
}

/**
 * 边中点处指向卡片外侧的单位方向（竖边 → 水平外移；横边 → 竖直外移）。
 */
function outwardFromEdgePort(
  cx: number,
  cy: number,
  px: number,
  py: number,
  portOnVerticalEdge: boolean
): { ox: number; oy: number } {
  if (portOnVerticalEdge) {
    const s = Math.sign(px - cx) || 1;
    return { ox: s, oy: 0 };
  }
  const s = Math.sign(py - cy) || 1;
  return { ox: 0, oy: s };
}

/** 全局主干：落在 (a,b) 开区间内则用同一坐标，多条边共享竖线/横线形成 T 形交汇 */
function pickSpineCoord(
  a: number,
  b: number,
  spine: number | undefined
): number {
  if (spine === undefined) return (a + b) / 2;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (spine > lo && spine < hi) return spine;
  return (a + b) / 2;
}

function layoutMedianSpine(
  positions: Map<string, { x: number; y: number }>
): { spineX: number; spineY: number } {
  const pts = [...positions.values()];
  if (pts.length === 0) {
    return { spineX: WORLD / 2, spineY: WORLD / 2 };
  }
  const xs = pts.map((p) => p.x).sort((a, b) => a - b);
  const ys = pts.map((p) => p.y).sort((a, b) => a - b);
  const mid = (arr: number[]) => {
    const n = arr.length;
    return n % 2 ? arr[(n - 1) / 2]! : (arr[n / 2 - 1]! + arr[n / 2]!) / 2;
  };
  return {
    spineX: snapSvgCoord(mid(xs)),
    spineY: snapSvgCoord(mid(ys)),
  };
}

/**
 * 正交折线（仅连接两个「已在外侧的」折点，不含边沿 stub）。
 * 竖直边 → 先水平离开；水平边 → 先竖直离开。
 * spineX/spineY：可选全局主干，使 H–V–H / V–H–V 易形成共用干线（地铁图式 T 接）。
 */
function orthogonalPathPerpendicularToEdges(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  exitEdgeVertical: boolean,
  entryEdgeVertical: boolean,
  spineX?: number,
  spineY?: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (
    !exitEdgeVertical &&
    !entryEdgeVertical &&
    Math.abs(dx) < ORTHO_STRAIGHT_EPS
  ) {
    const x = (x1 + x2) / 2;
    return `M ${x} ${y1} L ${x} ${y2}`;
  }
  if (
    exitEdgeVertical &&
    entryEdgeVertical &&
    Math.abs(dy) < ORTHO_STRAIGHT_EPS
  ) {
    const y = (y1 + y2) / 2;
    return `M ${x1} ${y} L ${x2} ${y}`;
  }
  if (Math.abs(dx) < ORTHO_ALIGN_EPS) {
    const x = (x1 + x2) / 2;
    return `M ${x} ${y1} L ${x} ${y2}`;
  }
  if (Math.abs(dy) < ORTHO_ALIGN_EPS) {
    const y = (y1 + y2) / 2;
    return `M ${x1} ${y} L ${x2} ${y}`;
  }

  if (exitEdgeVertical && entryEdgeVertical) {
    const mx = pickSpineCoord(x1, x2, spineX);
    return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
  }
  if (!exitEdgeVertical && !entryEdgeVertical) {
    const my = pickSpineCoord(y1, y2, spineY);
    return `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`;
  }
  if (exitEdgeVertical && !entryEdgeVertical) {
    return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
}

/**
 * 从边中点出发/到达前先沿法线外伸 stub，使 H–V–H / V–H–H 的折角落在两卡间隙内。
 */
function orthogonalPathPerpendicularWithClearance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  anchors: ReturnType<typeof edgeMidpointAnchors>,
  spineX: number | undefined,
  spineY: number | undefined
): string {
  const { x1, y1, x2, y2, exitEdgeVertical, entryEdgeVertical } = anchors;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (
    !exitEdgeVertical &&
    !entryEdgeVertical &&
    Math.abs(dx) < ORTHO_STRAIGHT_EPS
  ) {
    const x = (x1 + x2) / 2;
    return `M ${x} ${y1} L ${x} ${y2}`;
  }
  if (
    exitEdgeVertical &&
    entryEdgeVertical &&
    Math.abs(dy) < ORTHO_STRAIGHT_EPS
  ) {
    const y = (y1 + y2) / 2;
    return `M ${x1} ${y} L ${x2} ${y}`;
  }
  if (Math.abs(dx) < ORTHO_ALIGN_EPS) {
    const x = (x1 + x2) / 2;
    return `M ${x} ${y1} L ${x} ${y2}`;
  }
  if (Math.abs(dy) < ORTHO_ALIGN_EPS) {
    const y = (y1 + y2) / 2;
    return `M ${x1} ${y} L ${x2} ${y}`;
  }

  const oa = outwardFromEdgePort(ax, ay, x1, y1, exitEdgeVertical);
  const ob = outwardFromEdgePort(bx, by, x2, y2, entryEdgeVertical);

  let stubA: number;
  let stubB: number;
  if (exitEdgeVertical && entryEdgeVertical) {
    const half = Math.abs(dx) / 2;
    const raw = Math.min(
      ORTHO_STUB_MAX,
      Math.max(ORTHO_STUB_MIN, half * 0.38)
    );
    stubA = Math.max(0, Math.min(raw, half - 1));
    stubB = stubA;
  } else if (!exitEdgeVertical && !entryEdgeVertical) {
    const half = Math.abs(dy) / 2;
    const raw = Math.min(
      ORTHO_STUB_MAX,
      Math.max(ORTHO_STUB_MIN, half * 0.38)
    );
    stubA = Math.max(0, Math.min(raw, half - 1));
    stubB = stubA;
  } else {
    const raw = Math.min(
      ORTHO_STUB_MAX,
      Math.max(ORTHO_STUB_MIN, (Math.abs(dx) + Math.abs(dy)) * 0.08)
    );
    stubA = raw;
    stubB = raw;
  }

  const ex1 = x1 + oa.ox * stubA;
  const ey1 = y1 + oa.oy * stubA;
  const ex2 = x2 + ob.ox * stubB;
  const ey2 = y2 + ob.oy * stubB;

  const inner = orthogonalPathPerpendicularToEdges(
    ex1,
    ey1,
    ex2,
    ey2,
    exitEdgeVertical,
    entryEdgeVertical,
    spineX,
    spineY
  );
  const innerBody = inner
    .replace(
      /^M\s*([-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][-+]?\d+)?)\s*([-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][-+]?\d+)?)\s*/i,
      ""
    )
    .trim();

  const prefix =
    stubA > 0 ? `M ${x1} ${y1} L ${ex1} ${ey1}` : `M ${ex1} ${ey1}`;
  const suffix = stubB > 0 ? ` L ${x2} ${y2}` : "";
  return innerBody.length > 0
    ? `${prefix} ${innerBody}${suffix}`
    : `${prefix}${suffix}`;
}

function orthogonalPathForGraphEdge(
  e: GraphEdge,
  positions: Map<string, { x: number; y: number }>,
  boxHalfById: Map<string, BoxHalf>,
  spine: { spineX: number; spineY: number }
): string | null {
  let idA = e.from;
  let idB = e.to;
  if (idB < idA) [idA, idB] = [idB, idA];
  const pA = positions.get(idA);
  const pB = positions.get(idB);
  if (!pA || !pB) return null;
  const ha =
    boxHalfById.get(idA) ?? { hw: DEFAULT_HALF_W, hh: DEFAULT_HALF_H };
  const hb =
    boxHalfById.get(idB) ?? { hw: DEFAULT_HALF_W, hh: DEFAULT_HALF_H };
  const anchors = edgeMidpointAnchors(
    pA.x,
    pA.y,
    ha,
    pB.x,
    pB.y,
    hb
  );
  const raw = snapPathCoordsInD(
    orthogonalPathPerpendicularWithClearance(
      pA.x,
      pA.y,
      pB.x,
      pB.y,
      anchors,
      spine.spineX,
      spine.spineY
    )
  );
  return compactMlPathD(raw);
}

type GraphEdge = { from: string; to: string };

function nodeKey(colId: string, cardId: string) {
  return `${colId}\0${cardId}`;
}

/** 无向边键，避免 A→B 与 B→A 各画一条线 */
function undirectedPairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** 从 root BFS 分层，用于脉冲向外扩散 */
function bfsLayersFromRoot(
  rootId: string,
  graphEdges: GraphEdge[]
): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of graphEdges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  if (!adj.has(rootId)) return [[rootId]];
  const layers: string[][] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  layers.push([rootId]);
  while (frontier.length) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          next.push(v);
        }
      }
    }
    if (next.length === 0) break;
    layers.push(next);
    frontier = next;
  }
  return layers;
}

const PULSE_ROOT_HOLD_MS = 380;
const PULSE_LINE_DRAW_MS = 580;
const PULSE_WAVE_PAUSE_MS = 240;

type LayoutPoint = { x: number; y: number; vx: number; vy: number };

function boxHalfForLayout(
  id: string,
  halfById?: Map<string, BoxHalf>
): BoxHalf {
  return halfById?.get(id) ?? { hw: DEFAULT_HALF_W, hh: DEFAULT_HALF_H };
}

/** 卡片轴对齐包围盒最小中心距：不重叠 + 额外间距（可传入 DOM 实测半边距） */
function resolveCardBoxOverlaps(
  nodeIds: string[],
  pos: Map<string, LayoutPoint>,
  passes: number,
  halfById?: Map<string, BoxHalf>
) {
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        const ha = boxHalfForLayout(a, halfById);
        const hb = boxHalfForLayout(b, halfById);
        const minW = ha.hw + hb.hw + LAYOUT_EDGE_GAP;
        const minH = ha.hh + hb.hh + LAYOUT_EDGE_GAP;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const overlapX = minW - adx;
        const overlapY = minH - ady;
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const push = overlapX * 0.51;
          const sx = dx >= 0 ? 1 : -1;
          pa.x -= sx * push;
          pb.x += sx * push;
        } else {
          const push = overlapY * 0.51;
          const sy = dy >= 0 ? 1 : -1;
          pa.y -= sy * push;
          pb.y += sy * push;
        }
      }
    }
  }
}

function layoutGraph(
  nodeIds: string[],
  edges: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const n = nodeIds.length;
  const center = WORLD / 2;
  const out = new Map<string, { x: number; y: number }>();
  if (n === 0) return out;

  const radius = Math.min(680 + n * 24, 2400);
  const pos = new Map<string, LayoutPoint>();
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    pos.set(id, {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
    });
  });

  const ideal = 460;
  for (let iter = 0; iter < 110; iter++) {
    const fx = new Map<string, number>();
    const fy = new Map<string, number>();
    for (const id of nodeIds) {
      fx.set(id, 0);
      fy.set(id, 0);
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy + 4;
        const d = Math.sqrt(d2);
        const rep = 88000 / d2;
        const rx = (rep * dx) / d;
        const ry = (rep * dy) / d;
        fx.set(a, fx.get(a)! + rx);
        fy.set(a, fy.get(a)! + ry);
        fx.set(b, fx.get(b)! - rx);
        fy.set(b, fy.get(b)! - ry);
      }
    }

    for (const e of edges) {
      const pa = pos.get(e.from);
      const pb = pos.get(e.to);
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = 0.085 * (d - ideal);
      const ax = (f * dx) / d;
      const ay = (f * dy) / d;
      fx.set(e.from, fx.get(e.from)! + ax);
      fy.set(e.from, fy.get(e.from)! + ay);
      fx.set(e.to, fx.get(e.to)! - ax);
      fy.set(e.to, fy.get(e.to)! - ay);
    }

    for (const id of nodeIds) {
      const p = pos.get(id)!;
      const fxx = fx.get(id)! + (center - p.x) * 0.0045;
      const fyy = fy.get(id)! + (center - p.y) * 0.0045;
      p.vx = (p.vx + fxx) * 0.58;
      p.vy = (p.vy + fyy) * 0.58;
      p.x += p.vx * 0.9;
      p.y += p.vy * 0.9;
    }
    resolveCardBoxOverlaps(nodeIds, pos, 4);
  }

  resolveCardBoxOverlaps(nodeIds, pos, 12);

  for (const id of nodeIds) {
    const p = pos.get(id)!;
    p.x = Math.round(p.x / LAYOUT_GRID) * LAYOUT_GRID;
    p.y = Math.round(p.y / LAYOUT_GRID) * LAYOUT_GRID;
  }
  resolveCardBoxOverlaps(nodeIds, pos, 24);

  for (const id of nodeIds) {
    const p = pos.get(id)!;
    out.set(id, { x: p.x, y: p.y });
  }
  return out;
}

function ConnectionsBoardCard({
  colId,
  card,
  onOpenDetail,
  onLinkRailPointerDown,
  onOpenAskAi,
}: {
  colId: string;
  card: NoteCard;
  onOpenDetail: () => void;
  /** 仅在左侧灰条上按下拖动可拉出线；未传则保持只读灰条 */
  onLinkRailPointerDown?: (e: React.PointerEvent) => void;
  onOpenAskAi?: () => void;
}) {
  const c = useAppChrome();
  const { lang } = useAppUiLang();
  const reminderBesideTime = formatCardReminderBesideTime(card, lang);
  const bodyHtml = noteBodyToHtml(card.text);
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const hasGallery = media.length > 0;

  return (
    <div className="card card--timeline-fold-body connections-board__node-card">
      <CardRowInner
        hasGallery={hasGallery}
        timelineColumnCount={2}
        className={
          "card__inner" + (hasGallery ? " card__inner--split" : "")
        }
      >
        <div
          className={
            "card__move-rail card__move-rail--readonly" +
            (onLinkRailPointerDown
              ? " card__move-rail--connections-link"
              : "")
          }
          aria-hidden={onLinkRailPointerDown ? false : true}
          aria-label={
            onLinkRailPointerDown ? c.connectionsLinkRailAria : undefined
          }
          style={
            card.objectKind && card.objectKind !== "note"
              ? { background: getPresetKindMeta(card.objectKind)?.tint }
              : undefined
          }
          onPointerDown={
            onLinkRailPointerDown
              ? (e) => {
                  e.stopPropagation();
                  onLinkRailPointerDown(e);
                }
              : undefined
          }
        />
        <div
          className={
            "card__paper card__paper--with-move-rail" +
            (hasGallery ? " card__paper--with-gallery" : "")
          }
        >
          <div className="card__toolbar card__toolbar--person-time-row">
            <span className="card__time">
              {card.objectKind && card.objectKind !== "note"
                ? (() => {
                    const meta = getPresetKindMeta(card.objectKind);
                    return meta ? (
                      <span
                        className="connections-board__node-kind-badge"
                        title={lang === "zh" ? meta.nameZh : meta.nameEn}
                        aria-label={lang === "zh" ? meta.nameZh : meta.nameEn}
                      >
                        {meta.emoji}
                      </span>
                    ) : null;
                  })()
                : null}
              {formatCardTimeLabel(card, lang)}
              {reminderBesideTime ? (
                <span className="card__time-reminder">{reminderBesideTime}</span>
              ) : null}
              {card.reminderNote ? (
                <span className="card__time-reminder">
                  {" · "}
                  {card.reminderNote}
                </span>
              ) : null}
            </span>
            <div className="card__toolbar-actions">
              {onOpenAskAi ? (
                <button
                  type="button"
                  className="card__icon-btn card__ask-ai-btn"
                  title={c.cardAskAiToolbar}
                  aria-label={c.cardAskAiToolbar}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenAskAi();
                  }}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="8" r="6.25" />
                    <path d="M6.35 6.1a1.75 1.75 0 012.95 1.2c0 1.1-1.1 1.35-1.45 2.05V10" />
                    <circle cx="8" cy="12.35" r="0.55" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="card__icon-btn card__detail-btn"
                title={c.uiViewDetail}
                aria-label={c.uiViewDetail}
                onClick={onOpenDetail}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M1 1h5v1.5H2.5V5H1V1zm9 0h5v4h-1.5V2.5H10V1zM1 10h1.5v2.5H5V14H1v-4zM15 10h-1.5v2.5H11V14H15v-4z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="card__text-editor card__text-editor--readonly card__text-editor--hide-embedded-media card__text-editor--fold-body-3">
            <div
              id={`conn-card-text-${card.id}`}
              className="card__text card__text--readonly ProseMirror"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
          <CardTagsRow
            colId={colId}
            card={card}
            canEdit={false}
            onCommit={() => {}}
          />
        </div>
        {hasGallery ? (
          <CardGallery items={media} uploadPending={false} uploadProgress={null} />
        ) : null}
      </CardRowInner>
    </div>
  );
}

type LinkRubberState = {
  fromKey: string;
  fromColId: string;
  fromCardId: string;
  pointerId: number;
  curX: number;
  curY: number;
  /** 指针下可作为落点的另一张卡片（不含起点） */
  hoverTargetKey: string | null;
};

export function NoteConnectionsView({
  edges,
  onOpenTarget,
  canEdit = false,
  onLinkCards,
  askAiGate = "ok",
  onSaveAiAnswer,
}: {
  /** 由父组件在首次进入「笔记探索」后扫描得到，避免未点开时全库遍历 */
  edges: ConnectionEdge[];
  onOpenTarget: (colId: string, cardId: string) => void;
  /** 为 true 且提供 onLinkCards 时，从卡片左侧灰条拖动连线到另一张卡片建立双向相关 */
  canEdit?: boolean;
  onLinkCards?: (
    fromColId: string,
    fromCardId: string,
    toColId: string,
    toCardId: string
  ) => void;
  /** 问 AI：需登录且云端数据模式，否则侧栏提示原因 */
  askAiGate?: CardAskAiGate;
  /** 将问 AI 回答保存为新笔记并和当前卡互相关联 */
  onSaveAiAnswer?: (
    plainText: string,
    sourceColId: string,
    sourceCardId: string
  ) => Promise<boolean>;
}) {
  const c = useAppChrome();
  const { lang } = useAppUiLang();
  const linkGestureEnabled = Boolean(canEdit && onLinkCards);
  const [askAi, setAskAi] = useState<CardAskAiContext | null>(null);
  const [activeKindFilter, setActiveKindFilter] = useState<string | null>(null);

  const { nodes, graphEdges, layoutKey } = useMemo(() => {
    const nodeMap = new Map<
      string,
      { col: Collection; card: NoteCard }
    >();
    const gEdges: GraphEdge[] = [];
    const seenUndirected = new Set<string>();
    for (const e of edges) {
      const a = nodeKey(e.fromCol.id, e.fromCard.id);
      const b = nodeKey(e.toCol.id, e.toCard.id);
      nodeMap.set(a, { col: e.fromCol, card: e.fromCard });
      nodeMap.set(b, { col: e.toCol, card: e.toCard });
      const pk = undirectedPairKey(a, b);
      if (seenUndirected.has(pk)) continue;
      seenUndirected.add(pk);
      gEdges.push({ from: a, to: b });
    }
    const ids = [...nodeMap.keys()];
    return {
      nodes: nodeMap,
      graphEdges: gEdges,
      layoutKey: ids.join("|"),
    };
  }, [edges]);

  const basePositions = useMemo(() => {
    const ids = [...nodes.keys()];
    return layoutGraph(ids, graphEdges);
  }, [nodes, graphEdges, layoutKey]);

  /** DOM 实测半边距到位后，按真实卡片高宽再推一次，避免「默认高度」过小导致重叠 */
  const [layoutPositions, setLayoutPositions] = useState<Map<
    string,
    { x: number; y: number }
  > | null>(null);

  const positions = useMemo(() => {
    if (!layoutPositions || layoutPositions.size === 0) {
      return basePositions;
    }
    if (layoutPositions.size !== basePositions.size) {
      return basePositions;
    }
    for (const k of basePositions.keys()) {
      if (!layoutPositions.has(k)) {
        return basePositions;
      }
    }
    return layoutPositions;
  }, [basePositions, layoutPositions]);

  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const layoutSpine = useMemo(
    () => layoutMedianSpine(positions),
    [positions, layoutKey]
  );

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.45);
  /** 脉冲高亮：先根卡片，再沿线展开，再逐层相关卡片 */
  const [pulse, setPulse] = useState<{
    rootId: string;
    cardUpto: number;
  } | null>(null);
  const pulseRunRef = useRef(0);
  const pulseTimersRef = useRef<number[]>([]);

  const pulseLayers = useMemo(() => {
    if (!pulse?.rootId) return [] as string[][];
    return bfsLayersFromRoot(pulse.rootId, graphEdges);
  }, [pulse?.rootId, graphEdges, layoutKey]);

  const pulseNodeLayer = useMemo(() => {
    const m = new Map<string, number>();
    pulseLayers.forEach((ids, i) => ids.forEach((id) => m.set(id, i)));
    return m;
  }, [pulseLayers]);

  const clearPulseSchedule = useCallback(() => {
    pulseTimersRef.current.forEach(clearTimeout);
    pulseTimersRef.current = [];
  }, []);

  const startPulse = useCallback(
    (rootId: string) => {
      pulseRunRef.current += 1;
      const runId = pulseRunRef.current;
      clearPulseSchedule();
      const layers = bfsLayersFromRoot(rootId, graphEdges);
      setPulse({
        rootId,
        cardUpto: 0,
      });
      if (layers.length <= 1) return;
      let delay = PULSE_ROOT_HOLD_MS;
      for (let d = 0; d < layers.length - 1; d++) {
        const nextUpto = d + 1;
        const t = window.setTimeout(() => {
          if (pulseRunRef.current !== runId) return;
          setPulse((p) =>
            p?.rootId === rootId ? { rootId, cardUpto: nextUpto } : p
          );
        }, delay);
        pulseTimersRef.current.push(t);
        delay += PULSE_LINE_DRAW_MS + PULSE_WAVE_PAUSE_MS;
      }
    },
    [graphEdges, clearPulseSchedule]
  );

  useEffect(() => {
    return () => clearPulseSchedule();
  }, [clearPulseSchedule]);

  useEffect(() => {
    setPulse(null);
    clearPulseSchedule();
  }, [layoutKey, clearPulseSchedule]);

  /** 各节点包裹层实测半边距，用于连线贴边 */
  const [boxHalfById, setBoxHalfById] = useState<Map<string, BoxHalf>>(
    () => new Map()
  );
  const boxHalfByIdRef = useRef(boxHalfById);
  boxHalfByIdRef.current = boxHalfById;
  const nodeWrapElRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const nodeWrapRefCbRef = useRef<
    Map<string, (el: HTMLDivElement | null) => void>
  >(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  /** 结构变化或完成「实测尺寸」纠偏后各套一次镜头，避免仅 key 变化时重复跳变 */
  const lastCameraFitTokenRef = useRef<string | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const [linkRubber, setLinkRubber] = useState<LinkRubberState | null>(null);
  /** 拖线成功建立关联后的 click 用于取消脉冲高亮，避免误触 */
  const suppressNextCardClickRef = useRef(false);
  const onLinkCardsRef = useRef(onLinkCards);
  onLinkCardsRef.current = onLinkCards;

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const vp = viewportRef.current;
    if (!vp) {
      return { x: 0, y: 0 };
    }
    const r = vp.getBoundingClientRect();
    const lx = clientX - r.left;
    const ly = clientY - r.top;
    const z = zoomRef.current;
    const p = panRef.current;
    return { x: (lx - p.x) / z, y: (ly - p.y) / z };
  }, []);

  const startLinkDragFromRail = useCallback(
    (
      e: React.PointerEvent,
      nodeKey: string,
      colId: string,
      cardId: string
    ) => {
      if (!linkGestureEnabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const w = clientToWorld(e.clientX, e.clientY);
      setLinkRubber({
        fromKey: nodeKey,
        fromColId: colId,
        fromCardId: cardId,
        pointerId: e.pointerId,
        curX: w.x,
        curY: w.y,
        hoverTargetKey: null,
      });
    },
    [linkGestureEnabled, clientToWorld]
  );

  useEffect(() => {
    if (linkRubber === null) return;
    const pid = linkRubber.pointerId;
    const fromKey = linkRubber.fromKey;
    const fromColId = linkRubber.fromColId;
    const fromCardId = linkRubber.fromCardId;

    const findTargetKey = (wx: number, wy: number): string | null => {
      for (const [nid, pos] of positionsRef.current.entries()) {
        if (nid === fromKey) continue;
        const bh = boxHalfByIdRef.current.get(nid) ?? {
          hw: DEFAULT_HALF_W,
          hh: DEFAULT_HALF_H,
        };
        if (
          Math.abs(wx - pos.x) <= bh.hw &&
          Math.abs(wy - pos.y) <= bh.hh
        ) {
          return nid;
        }
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const w = clientToWorld(ev.clientX, ev.clientY);
      const hoverKey = findTargetKey(w.x, w.y);
      setLinkRubber((prev) =>
        prev && prev.pointerId === pid
          ? {
              ...prev,
              curX: w.x,
              curY: w.y,
              hoverTargetKey: hoverKey,
            }
          : prev
      );
    };

    /* 起始帧即根据指针位置更新落点高亮，避免需移动后才出现 */
    setLinkRubber((prev) =>
      prev && prev.pointerId === pid
        ? {
            ...prev,
            hoverTargetKey: findTargetKey(prev.curX, prev.curY),
          }
        : prev
    );

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const w = clientToWorld(ev.clientX, ev.clientY);
      const tgtKey = findTargetKey(w.x, w.y);
      const tgtNode = tgtKey ? nodesRef.current.get(tgtKey) : undefined;
      const fn = onLinkCardsRef.current;
      if (tgtKey && tgtNode && fn) {
        fn(fromColId, fromCardId, tgtNode.col.id, tgtNode.card.id);
        suppressNextCardClickRef.current = true;
      }
      setLinkRubber(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
    };
  }, [linkRubber?.pointerId, clientToWorld]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        pulseRunRef.current += 1;
        setPulse(null);
        clearPulseSchedule();
        setLinkRubber(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearPulseSchedule]);

  useEffect(() => {
    setLinkRubber(null);
  }, [layoutKey]);

  useEffect(() => {
    setAskAi(null);
  }, [layoutKey]);

  const getNodeWrapRef = useCallback((id: string) => {
    let cb = nodeWrapRefCbRef.current.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) nodeWrapElRef.current.set(id, el);
        else nodeWrapElRef.current.delete(id);
      };
      nodeWrapRefCbRef.current.set(id, cb);
    }
    return cb;
  }, []);

  const remeasureNodeBoxes = useCallback(() => {
    const next = new Map<string, BoxHalf>();
    for (const [id, el] of nodeWrapElRef.current.entries()) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < 4 || h < 4) continue;
      next.set(id, { hw: w / 2, hh: h / 2 });
    }
    setBoxHalfById((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const [id, v] of next) {
          const o = prev.get(id);
          if (
            !o ||
            Math.abs(o.hw - v.hw) > 0.5 ||
            Math.abs(o.hh - v.hh) > 0.5
          ) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    remeasureNodeBoxes();
    const obs = new ResizeObserver(() => {
      requestAnimationFrame(remeasureNodeBoxes);
    });
    for (const el of nodeWrapElRef.current.values()) {
      obs.observe(el);
    }
    return () => obs.disconnect();
  }, [layoutKey, remeasureNodeBoxes, positions]);

  useLayoutEffect(() => {
    const ids = [...basePositions.keys()];
    if (ids.length === 0) {
      setLayoutPositions(new Map());
      return;
    }
    const pos = new Map<string, LayoutPoint>();
    for (const id of ids) {
      const bp = basePositions.get(id);
      if (!bp) continue;
      pos.set(id, { x: bp.x, y: bp.y, vx: 0, vy: 0 });
    }
    const halfMap = boxHalfById.size > 0 ? boxHalfById : undefined;
    resolveCardBoxOverlaps(ids, pos, 96, halfMap);
    for (const id of ids) {
      const p = pos.get(id);
      if (!p) continue;
      p.x = Math.round(p.x / LAYOUT_GRID) * LAYOUT_GRID;
      p.y = Math.round(p.y / LAYOUT_GRID) * LAYOUT_GRID;
    }
    resolveCardBoxOverlaps(ids, pos, 48, halfMap);
    const out = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const p = pos.get(id);
      if (!p) continue;
      out.set(id, { x: p.x, y: p.y });
    }
    setLayoutPositions((prev) => {
      if (prev && prev.size === out.size) {
        let same = true;
        for (const [k, v] of out) {
          const o = prev.get(k);
          if (
            !o ||
            Math.abs(o.x - v.x) > 0.5 ||
            Math.abs(o.y - v.y) > 0.5
          ) {
            same = false;
            break;
          }
        }
        if (same) {
          return prev;
        }
      }
      return out;
    });
  }, [layoutKey, basePositions, boxHalfById]);

  useLayoutEffect(() => {
    if (edges.length === 0) {
      lastCameraFitTokenRef.current = null;
      return;
    }
    const vp = viewportRef.current;
    if (!vp) return;
    const refinedOk =
      layoutPositions != null &&
      layoutPositions.size > 0 &&
      layoutPositions.size === basePositions.size &&
      [...basePositions.keys()].every((k) => layoutPositions!.has(k));
    let posSum = 0;
    for (const p of positions.values()) {
      posSum +=
        Math.round(p.x / LAYOUT_GRID) + Math.round(p.y / LAYOUT_GRID);
    }
    const token = `${layoutKey}|${refinedOk ? "r" : "b"}|${posSum}`;
    if (lastCameraFitTokenRef.current === token) {
      return;
    }
    lastCameraFitTokenRef.current = token;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, p] of positions.entries()) {
      const bh = boxHalfById.get(id);
      const hw = bh?.hw ?? DEFAULT_HALF_W;
      const hh = bh?.hh ?? DEFAULT_HALF_H;
      minX = Math.min(minX, p.x - hw);
      minY = Math.min(minY, p.y - hh);
      maxX = Math.max(maxX, p.x + hw);
      maxY = Math.max(maxY, p.y + hh);
    }
    if (!Number.isFinite(minX)) return;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const z = Math.min(
      0.55,
      Math.min(vw / (maxX - minX + 180), vh / (maxY - minY + 180))
    );
    setZoom(snapZoom(z));
    setPan(
      snapPan({
        x: vw / 2 - z * cx,
        y: vh / 2 - z * cy,
      })
    );
  }, [
    edges.length,
    positions,
    layoutKey,
    boxHalfById,
    layoutPositions,
    basePositions,
  ]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".connections-board__node-card")) return;
      if (t.closest("button")) return;
      e.preventDefault();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [pan.x, pan.y]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      setPan(
        snapPan({
          x: d.panX + (e.clientX - d.startX),
          y: d.panY + (e.clientY - d.startY),
        })
      );
    },
    []
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (
      moved < 10 &&
      !(e.target as HTMLElement).closest(".connections-board__node-card")
    ) {
      pulseRunRef.current += 1;
      setPulse(null);
      clearPulseSchedule();
    }
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [clearPulseSchedule]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scale = e.deltaY > 0 ? 0.92 : 1.09;
    const z0 = zoomRef.current;
    const p0 = panRef.current;
    const z1 = snapZoom(
      Math.min(2.2, Math.max(0.18, z0 * scale))
    );
    const ratio = z1 / z0;
    setZoom(z1);
    setPan(
      snapPan({
        x: mx - ratio * (mx - p0.x),
        y: my - ratio * (my - p0.y),
      })
    );
  }, []);

  if (edges.length === 0) {
    return (
      <div className="connections-page connections-page--empty">
        <div className="timeline__empty connections-page__empty">
          {c.connectionsEmpty}
        </div>
      </div>
    );
  }

  // 当前图中所有 objectKind 集合（用于类型过滤 chips）
  const allKinds = useMemo(() => {
    const kinds = new Set<string>();
    for (const { card } of nodes.values()) {
      if (card.objectKind && card.objectKind !== "note") kinds.add(card.objectKind);
    }
    return [...kinds];
  }, [nodes]);

  return (
    <div className="connections-page connections-page--board">
      <div className="connections-board__toolbar">
        <p className="connections-board__hint">{c.connectionsBoardHint}</p>
      </div>

      {/* 类型过滤 chips（有多种 objectKind 时才显示） */}
      {allKinds.length > 1 && (
        <div className="connections-board__kind-filters">
          {allKinds.map((kind) => {
            const meta = getPresetKindMeta(kind);
            if (!meta) return null;
            const isActive = activeKindFilter === kind;
            return (
              <button
                key={kind}
                type="button"
                className={"connections-board__kind-chip" + (isActive ? " connections-board__kind-chip--active" : "")}
                style={{ background: meta.tint }}
                onClick={() => setActiveKindFilter((prev) => prev === kind ? null : kind)}
              >
                {meta.emoji} {lang === "zh" ? meta.nameZh : meta.nameEn}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={viewportRef}
        className={
          "connections-board__viewport" +
          (linkRubber ? " connections-board__viewport--link-draft" : "")
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div
          className="connections-board__world"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale3d(${zoom}, ${zoom}, 1)`,
            transformOrigin: "0 0",
            width: WORLD,
            height: WORLD,
          }}
        >
          <svg
            className="connections-board__svg"
            width={WORLD}
            height={WORLD}
            aria-hidden
          >
            {graphEdges.map((e, i) => {
              if (
                pulse &&
                (e.from === pulse.rootId || e.to === pulse.rootId)
              ) {
                return null;
              }
              const d = orthogonalPathForGraphEdge(
                e,
                positions,
                boxHalfById,
                layoutSpine
              );
              if (!d) return null;
              return (
                <path
                  key={`${e.from}-${e.to}-${i}`}
                  d={d}
                  fill="none"
                  stroke={BOARD_LINK_GRAY}
                  strokeWidth={BOARD_LINK_WIDTH_PX / zoom}
                  strokeLinejoin="miter"
                  strokeLinecap="butt"
                  shapeRendering="crispEdges"
                />
              );
            })}
            {pulse
              ? graphEdges
                  .filter(
                    (e) =>
                      e.from === pulse.rootId || e.to === pulse.rootId
                  )
                  .map((e, i) => {
                    const d = orthogonalPathForGraphEdge(
                      e,
                      positions,
                      boxHalfById,
                      layoutSpine
                    );
                    if (!d) return null;
                    return (
                      <path
                        key={`yl-${pulse.rootId}-${e.from}-${e.to}-${i}`}
                        d={d}
                        fill="none"
                        stroke={BOARD_LINK_PULSE}
                        strokeWidth={BOARD_LINK_WIDTH_PX / zoom}
                        strokeLinejoin="miter"
                        strokeLinecap="butt"
                        shapeRendering="crispEdges"
                      />
                    );
                  })
              : null}
            {linkRubber && positions.get(linkRubber.fromKey) ? (
              <path
                d={`M ${positions.get(linkRubber.fromKey)!.x} ${
                  positions.get(linkRubber.fromKey)!.y
                } L ${linkRubber.curX} ${linkRubber.curY}`}
                fill="none"
                stroke={BOARD_LINK_DRAFT}
                strokeWidth={(BOARD_LINK_WIDTH_PX * 1.35) / zoom}
                strokeLinecap="round"
                strokeDasharray="6 5"
                pointerEvents="none"
              />
            ) : null}
          </svg>
          {[...nodes.entries()].map(([id, { col, card }]) => {
            const p = positions.get(id);
            if (!p) return null;
            const kindDimmed =
              activeKindFilter !== null &&
              (card.objectKind ?? "note") !== activeKindFilter;
            return (
              <div
                key={id}
                ref={getNodeWrapRef(id)}
                className={[
                  "connections-board__node-wrap",
                  (() => {
                    if (!pulse) return "";
                    const L = pulseNodeLayer.get(id);
                    if (L === undefined || L > pulse.cardUpto) return "";
                    /* 单击卡片与直接相关：与根同档强黄；间接相关保持弱黄 */
                    if (L <= 1) return "connections-board__node-wrap--highlight";
                    return "connections-board__node-wrap--highlight-neighbor";
                  })(),
                  linkRubber?.hoverTargetKey === id
                    ? "connections-board__node-wrap--link-drop-target"
                    : "",
                  NOTE_CONNECTIONS_ASK_AI_ENABLED &&
                  askAi?.nodeKey === id
                    ? "connections-board__node-wrap--ask-ai"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  left: p.x,
                  top: p.y,
                  transform: "translate(-50%, -50%)",
                  ...(kindDimmed ? { opacity: 0.25, pointerEvents: "none" } : {}),
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  if (suppressNextCardClickRef.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    suppressNextCardClickRef.current = false;
                    return;
                  }
                  if ((e.target as HTMLElement).closest("button")) return;
                  e.stopPropagation();
                  if (pulse?.rootId === id) {
                    pulseRunRef.current += 1;
                    setPulse(null);
                    clearPulseSchedule();
                  } else {
                    startPulse(id);
                  }
                }}
              >
                <ConnectionsBoardCard
                  colId={col.id}
                  card={card}
                  onOpenDetail={() => onOpenTarget(col.id, card.id)}
                  onOpenAskAi={
                    NOTE_CONNECTIONS_ASK_AI_ENABLED
                      ? () =>
                          setAskAi({
                            nodeKey: id,
                            colId: col.id,
                            card,
                            relatedCards: relatedCardsPayloadForAskAi(
                              edges,
                              col.id,
                              card.id
                            ),
                          })
                      : undefined
                  }
                  onLinkRailPointerDown={
                    linkGestureEnabled
                      ? (ev) =>
                          startLinkDragFromRail(ev, id, col.id, card.id)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      {NOTE_CONNECTIONS_ASK_AI_ENABLED ? (
        <CardAskAiPanel
          open={askAi !== null}
          context={askAi}
          gate={askAiGate}
          canEdit={canEdit}
          onSaveAnswerAsCard={onSaveAiAnswer}
          onClose={() => setAskAi(null)}
        />
      ) : null}
    </div>
  );
}
