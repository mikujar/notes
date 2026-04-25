# Properties

Properties are structured fields on a card. cardnote ships **9** field types.

## All types at a glance

| Type | For | Value shape |
|---|---|---|
| `text` | Single / multi-line text | `string` |
| `number` | Number with unit | `number` |
| `choice` | Options (single / multi-select unified) | `string[]` (option ids) |
| `date` | Date, optionally with time | `YYYY-MM-DD` or with time |
| `checkbox` | Boolean | `boolean` |
| `url` | Link | `string` |
| `cardLink` | Reference one card | `{ colId, cardId }` |
| `cardLinks` | Reference many cards | `{ colId, cardId }[]` |
| `collectionLink` | Reference one or more sets | `string[]` (set ids) |

## Choice fields

`choice` collapses the old "single-select" and "multi-select" into one type — the value is always an array of strings; length 1 acts as single-select. Each option has `id` / `name` / `color`, managed centrally on the schema.

## Link fields (cardLink / cardLinks / collectionLink)

- **`cardLink`** — one-to-one. Use for "Reading note → Book", "Journal → today's weather card".
- **`cardLinks`** — one-to-many. Use for "Person → multiple works", "Project → multiple to-dos".
- **`collectionLink`** — links a card **to a set** without changing the card's home set. Common use: tag a loose card with "this is part of the H1 retrospective" without relocating it.

## Field types that don't exist

To avoid confusion, listing what's **not** there:

- ❌ `tag` (a dedicated tag type) — cardnote uses `choice` for multi-select, or `cardLinks` to a Topic card
- ❌ `rating` (star rating) — define a `number` field with range 1–5 yourself
- ❌ `color` (standalone color field) — colors live as an attribute on `choice` options
- ❌ `person` (standalone person field) — use `cardLink` to a Topic/People card
- ❌ `formula` / computed fields

## Where they show up

- **Right panel** of the card detail — edit each field
- **Sidebar / timeline** show only a brief summary of selected fields, not the full set
- Custom field values are indexed in full-text search

## Schema inheritance vs per-card customization

Cards in a set automatically inherit the set's schema. Adding a one-off field (`custom_props`) to a single card does **not** pollute the rest of the set — it lives on that one card. This is good for quick ad-hoc fields without disturbing siblings.
