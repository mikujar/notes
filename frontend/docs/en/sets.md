# Sets

A set is a container for cards.

## Multi-set membership

**A card can belong to multiple sets at once.** Under the hood it's a many-to-many `card_placements` table — every (card, set) pair has its own row, with independent `pinned` and `sort_order`.

A note about Linear can simultaneously sit in:

- "Apps / Tools" (by topic)
- "H1 2026" (by time)
- "Sprint 3" (by project)

Its position and pin state are independent in each set.

## Add / remove

- **Add to another set** — card detail → **Add to set**, pick the target
- **Remove from a set** — card detail → in the membership list, click `⋯ → Remove from this set`. The card itself is not deleted; it just leaves this set
- **Drag** — drag the card from one set in the sidebar onto another

## Loose cards

A card with zero set memberships falls into a special holder (`LOOSE_NOTES_COLLECTION_ID`) and surfaces in the **All notes** timeline. Removing a card from its last set turns it loose — it's not deleted.

## Nesting

Sets nest to arbitrary depth:

```
Reading notes
├── Literature
│   ├── Chinese
│   └── World
└── Tech
    ├── Programming
    └── Design
```

A child set's cards **do** aggregate up to the parent set's view (and the sidebar badge counts the entire subtree).

## Basics

- **Create** — sidebar bottom: `+ New set`
- **Rename / change icon** — right-click the set → **Set settings**
- **Add a child set** — right-click parent → `+ Child set`
- **Delete** — a deletion dialog asks how to handle existing content (move to trash / move to another set / leave loose)

## Preset sets

On signup, the system creates a few preset sets — one per top-level card type:

- Notes, Files, Topics, Clips, Tasks, Projects, Expenses, Accounts

They behave like ordinary sets — **deletable and renameable**. But deleting a preset set and creating one with the same name later won't auto-restore the schema; preset field definitions live on the card sub-templates, not on the set itself.

## Archived

The sidebar's "Archived" entry is a **special view**, not a set. Any card with an `archivedAt` timestamp shows up there. Archiving doesn't change the card's set memberships; it just hides the card from regular lists.

## Trash

Deleted cards go to Trash and can be restored within 30 days. After that, a backend job hard-deletes them.
