# Card types

Everything in cardnote is a card. The eight built-in types below mirror the template catalog on the landing page.

## Notes · 6 sub-templates

| Sub-template | For |
|---|---|
| **Study** | Class notes, textbook summaries, review dates |
| **Reading** | Chapter excerpts + your commentary |
| **Video** | Timestamped video takeaways |
| **Spark** | Fleeting ideas, trigger context, next step |
| **Journal** | One card per day with mood and weather |
| **Quote** | Plain excerpts |

## Files · 5 sub-templates

| Sub-template | Built-in fields |
|---|---|
| **Image** | Captured at, location |
| **Video** | Duration (auto), resolution (auto) |
| **Audio** | Duration (auto), performer / podcast |
| **Document** | Pages, author |
| **Other** | MIME description, note |

File cards generate WebP thumbnails on upload, and image / video / audio / PDF preview directly in the card detail.

## Topics · 12 sub-templates

| Sub-template |
|---|
| People, Organization, Place, Event, Concept, Book |
| Film/TV, Anime, Music, Game, Course, App |

Each ships with sensible built-in fields, e.g.:
- People: role, birth year, related works (cardLinks)
- Books: author, publisher, ISBN, reading status
- Films: director, cast, year, personal rating
- Apps: developer, platform, website

## Clips · 14 sub-templates

One per platform; each carries platform-specific metadata fields (original URL, author, posted at, etc.).

| Sub-template |
|---|
| Web, Email, Rednote, Bilibili, WeChat article |
| Douyin, Weibo, Zhihu, Douban, GitHub |
| Twitter / X, Instagram, Reddit, App Store |

## Tasks · 3 sub-templates

- **To-do** · plain checkable item with optional reminder date / time
- **Schedule** · scheduled item with a fixed start time
- **Habit** · recurring check-in with a "consecutive days" field

## Projects · 2 sub-templates

- **Doing** · projects in progress
- **Archived** · completed / shelved projects

## Expenses · 3 sub-templates

- **Daily** · one-off spend
- **Subscriptions** · recurring charges with the next billing date
- **Reimburse** · pending reimbursement with attached receipts

## Accounts · 3 sub-templates

- **Logins** · platform credentials (username, password, login URL)
- **Bank Card** · bank, card number, expiry
- **ID** · government IDs, passports

> ⚠️ **Important security note**: Password / card-number fields on account cards are currently stored as **plain text** under your account, not end-to-end encrypted. Highly sensitive credentials (banking passwords, CVV, ID numbers) — exercise judgment before putting them in.

> Note: some sub-templates are still being filled out — newly created cards may not have the full set of built-in fields yet. You can add the fields you need manually under Set settings → Set template.
