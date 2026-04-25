# Import & migration

cardnote currently supports importing from 4 sources. All imports are parsed locally in the browser and only written to the server on confirm.

## Supported sources

| Source | File format | Notes |
|---|---|---|
| **Apple Notes** | iCloud web export ZIP / TXT | Use ZIP if you want images; Markdown-style formatting is preserved |
| **Evernote** | `.enex` | Tags become `choice` fields; attachments become file cards |
| **Flomo** | Official export ZIP | Tags converted to `choice` fields |
| **Yuque (语雀)** | Knowledge-base export ZIP | Document tree maps to nested sets; images relinked |

## How to import

Sidebar bottom `⋯` menu → pick the importer → drop the file → preview (skip what you don't want) → confirm.

Imports land in a new **Import set** under your account. Nothing pollutes your existing sets — you can curate later or just leave it as-is.

## Not supported (yet)

No official importer for:

- Notion (export ZIP with HTML / Markdown — complex structure; on the roadmap)
- Obsidian (Vault folder, plain Markdown — technically simple but not done)
- Roam Research, Logseq

## Export / backup

cardnote does not yet have a one-click bulk export. Today's options:

1. Data lives under a remote account (Postgres) backed up by the platform
2. Individual cards: copy body / download attachments by hand
3. A self-serve bulk export API is in progress

> If you need to take everything out urgently, email hejiac0226@gmail.com — one-time JSON export can be arranged manually.
