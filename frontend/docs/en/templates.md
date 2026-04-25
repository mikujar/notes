# Templates (Schema)

Every set can have a **schema** — defining what custom fields cards in this set should have. New cards get those fields automatically.

## What a schema contains

- **Property fields (`schemaFields`)** — the list of fields each card carries
- **autoLinkRules** — rules that automatically build cardLinks on save (see below)

> There's no "body template" feature — cardnote does not pre-fill the body.

## Where to edit it

Right-click a set → **Set settings** → **Set template** tab.

The UI supports:
- Drag to reorder fields
- Edit field name, type, default value, color / icon
- Add / remove / rename options for `choice` fields
- Pick the target set for `cardLink` / `cardLinks` fields

> Note: **Preset sub-template schemas (Study / Book note / Bookmark …) are read-only** to avoid conflicts with future preset upgrades. To customize, move the card into a regular set and add fields there.

## autoLinkRules

Some preset sets ship with `autoLinkRules` — on save, a card's field value automatically generates a `cardLink` between two cards.

A real example: the **Video note** sub-template ships with a rule — when you reference a video file card in the "Source video" field and save, it automatically writes the video note back into the source video card's "From" field. No need to maintain both directions.

> Custom autoLinkRules are **not** yet editable through the UI — they currently only ship with presets. Exposing them to users is on the roadmap.

## No formula / computed fields

cardnote does **not** support formula or computed fields today. To derive a value from other fields, fill it in manually on save.
