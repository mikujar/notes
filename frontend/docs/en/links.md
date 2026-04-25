# Links & graph

cardnote expresses card-to-card relationships through **fields**, not in-text `@` mentions — keeping relationships structured, queryable, and rule-friendly.

## Three field-based link types

### 1. `cardLink` — one-to-one

Add an "Author" field on a Reading note (`cardLink`, target set = Topics/People). Once you fill in a person card:

- The Reading note's right panel shows the author name + avatar; click jumps to the person
- The person card's **Backlinks** panel lists this Reading note automatically
- Two-way without manual maintenance — you don't mark the person side too

### 2. `cardLinks` — one-to-many

A "Notable works" field on a Person card (`cardLinks`, targets = Topics/Books + Topics/Films) can carry many cards.

### 3. `collectionLink` — card → set

Less common but useful — express "this card relates to a set" without changing its home set.

## Backlinks

Every card detail has a **Backlinks** panel listing every card that references it via cardLink/cardLinks. Click to jump; no manual two-way maintenance.

## Graph view (Connections)

The **Connections** sidebar entry opens a full-canvas graph view.

Supported:
- **Drag a node** to reposition
- **Wheel / pinch** to zoom
- **Drag empty space** to pan
- **Click a node** to jump to that card
- Filter visible nodes by `objectKind` (card type)
- Edges show every cardLink relation in the workspace

The layout uses **orthogonal routing** (right-angle edges with rounded corners), not a force-directed engine — node positions are stable and can be manually adjusted and saved.

## autoLinkRules: automatic linking

Some preset sets (e.g. Video note) ship with `autoLinkRules` in their schema — on save, a field value can automatically build a cardLink between two cards without any clicks. See [Templates](/docs/templates#autolinkrules).
