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
import { CardTagsRow } from "../CardTagsRow";
import { CardRowInner } from "../CardRowInner";
import {
  formatCardReminderBesideTime,
  formatCardTimeLabel,
} from "../cardTimeLabel";
import type { ConnectionEdge } from "./connectionEdges";
import type { Collection, NoteCard } from "../types";

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
/** 与 .connections-board__node-wrap 宽度 260px 一致；高度随内容变化，由 DOM 实测 */
const DEFAULT_HALF_W = 130;
const DEFAULT_HALF_H = 120;
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
  if (Math.abs(dx) >= Math.abs(dy)) {
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
  const innerBody = inner.replace(/^M\s+[\d.-]+\s+[\d.-]+\s*/, "").trim();

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
  return snapPathCoordsInD(
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

/** 卡片轴对齐包围盒最小中心距：不重叠 + 额外间距 */
function resolveCardBoxOverlaps(
  nodeIds: string[],
  pos: Map<string, LayoutPoint>,
  passes: number
) {
  const minW = 2 * DEFAULT_HALF_W + LAYOUT_EDGE_GAP;
  const minH = 2 * DEFAULT_HALF_H + LAYOUT_EDGE_GAP;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
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
}: {
  colId: string;
  card: NoteCard;
  onOpenDetail: () => void;
}) {
  const c = useAppChrome();
  const { lang } = useAppUiLang();
  const reminderBesideTime = formatCardReminderBesideTime(card, lang);
  const bodyHtml = noteBodyToHtml(card.text);

  return (
    <div className="card connections-board__node-card">
      <CardRowInner
        hasGallery={false}
        timelineColumnCount={2}
        className="card__inner"
      >
        <div className="card__move-rail card__move-rail--readonly" aria-hidden />
        <div className="card__paper card__paper--with-move-rail">
          <div className="card__toolbar">
            <span className="card__time">
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
          <div className="card__text-editor card__text-editor--readonly">
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
      </CardRowInner>
    </div>
  );
}

export function NoteConnectionsView({
  edges,
  onOpenTarget,
}: {
  /** 由父组件在首次进入「笔记连接」后扫描得到，避免未点开时全库遍历 */
  edges: ConnectionEdge[];
  onOpenTarget: (colId: string, cardId: string) => void;
}) {
  const c = useAppChrome();

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

  const positions = useMemo(() => {
    const ids = [...nodes.keys()];
    return layoutGraph(ids, graphEdges);
  }, [nodes, graphEdges, layoutKey]);

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

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        pulseRunRef.current += 1;
        setPulse(null);
        clearPulseSchedule();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearPulseSchedule]);

  /** 各节点包裹层实测半边距，用于连线贴边 */
  const [boxHalfById, setBoxHalfById] = useState<Map<string, BoxHalf>>(
    () => new Map()
  );
  const nodeWrapElRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const nodeWrapRefCbRef = useRef<
    Map<string, (el: HTMLDivElement | null) => void>
  >(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  /** 仅当连接图结构（layoutKey）变化时自动适配镜头；避免弹窗/滚动条/节点重测触发重算 zoom、pan */
  const lastCameraLayoutKeyRef = useRef<string | null>(null);
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
    if (edges.length === 0) {
      lastCameraLayoutKeyRef.current = null;
      return;
    }
    if (lastCameraLayoutKeyRef.current === layoutKey) {
      return;
    }
    lastCameraLayoutKeyRef.current = layoutKey;

    const vp = viewportRef.current;
    if (!vp) return;
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
  }, [edges.length, positions, layoutKey, boxHalfById]);

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

  return (
    <div className="connections-page connections-page--board">
      <p className="connections-board__hint">{c.connectionsBoardHint}</p>
      <div
        ref={viewportRef}
        className="connections-board__viewport"
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
                  strokeLinejoin="round"
                  strokeLinecap="round"
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
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        shapeRendering="crispEdges"
                      />
                    );
                  })
              : null}
          </svg>
          {[...nodes.entries()].map(([id, { col, card }]) => {
            const p = positions.get(id);
            if (!p) return null;
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
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  left: p.x,
                  top: p.y,
                  transform: "translate(-50%, -50%)",
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
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
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
