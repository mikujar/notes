import type {
  Collection,
  CollectionCardSchema,
  NoteCard,
} from "./types";

type LegacyBlock = {
  id?: string;
  minutesOfDay?: number;
  addedOn?: string;
  cards?: NoteCard[];
};

type LegacyCollection = Omit<Collection, "cards" | "children"> & {
  blocks?: LegacyBlock[];
  cards?: NoteCard[];
  children?: unknown[];
};

const DEFAULT_MINUTES = 12 * 60;

function ensureCardFields(
  card: NoteCard,
  minutesOfDay: number,
  addedOn?: string
): NoteCard {
  return {
    ...card,
    minutesOfDay:
      typeof card.minutesOfDay === "number"
        ? card.minutesOfDay
        : minutesOfDay,
    addedOn: card.addedOn ?? addedOn,
    ...(typeof card.objectKind === "string" && card.objectKind.trim()
      ? { objectKind: card.objectKind.trim() }
      : {}),
  };
}

/** 将旧版 blocks 结构展平为 cards，并补全 minutesOfDay / addedOn */
export function migrateCollectionTree(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => migrateOneCollection(item as LegacyCollection));
}

function migrateOneCollection(c: LegacyCollection): Collection {
  const children = (c.children ?? []).map((ch) =>
    migrateOneCollection(ch as LegacyCollection)
  );

  let cards: NoteCard[] = [];

  if (Array.isArray(c.cards) && c.cards.length > 0) {
    cards = c.cards.map((card) =>
      ensureCardFields(card, card.minutesOfDay ?? DEFAULT_MINUTES, card.addedOn)
    );
  } else if (Array.isArray(c.blocks)) {
    for (const b of c.blocks) {
      const m =
        typeof b.minutesOfDay === "number" ? b.minutesOfDay : DEFAULT_MINUTES;
      const added = typeof b.addedOn === "string" ? b.addedOn : undefined;
      for (const card of b.cards ?? []) {
        cards.push(ensureCardFields(card, m, added));
      }
    }
  }

  const raw = c as LegacyCollection & {
    isCategory?: boolean;
    cardSchema?: CollectionCardSchema;
    presetTypeId?: string;
    iconShape?: string;
    cardCount?: number;
    totalCardCount?: number;
  };
  return {
    id: c.id,
    name: c.name,
    dotColor: c.dotColor,
    hint: c.hint,
    ...(raw.isCategory === true ? { isCategory: true } : {}),
    ...(raw.cardSchema &&
    typeof raw.cardSchema === "object" &&
    !Array.isArray(raw.cardSchema)
      ? { cardSchema: raw.cardSchema as CollectionCardSchema }
      : {}),
    ...(typeof raw.presetTypeId === "string" && raw.presetTypeId.trim()
      ? { presetTypeId: raw.presetTypeId.trim() }
      : {}),
    ...(typeof raw.iconShape === "string" && raw.iconShape.trim()
      ? { iconShape: raw.iconShape.trim() as Collection["iconShape"] }
      : {}),
    cards,
    children: children.length > 0 ? children : undefined,
    /* 懒加载模式下服务端 meta 提供的卡片计数；非 meta 路径上 undefined。 */
    ...(typeof raw.cardCount === "number" ? { cardCount: raw.cardCount } : {}),
    ...(typeof raw.totalCardCount === "number"
      ? { totalCardCount: raw.totalCardCount }
      : {}),
  };
}
