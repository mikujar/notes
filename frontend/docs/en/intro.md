# Introduction

cardnote is a card-based note tool built around three things: **fast capture, set-based organization, and deep linking.**

## The three things cardnote wants to do well

### 1. Fast capture

Open and write — no template picker, no required category. **Titles are optional**: just type — the first line shows as the title automatically; or write a Markdown `#` heading if you want a deliberate one; clip / file cards ship with a dedicated **Title** field. A paragraph, an image, a web clip, a to-do — all live in the same primitive, and one Enter saves it.

### 2. Set-based organization

A card **can belong to multiple sets at once** — file it once by topic, again by time, etc. With zero memberships it becomes a "loose card" and won't get lost. Sets themselves nest arbitrarily; a child set's cards aggregate up into the parent's view. Each set can carry a [schema](/docs/templates) describing what fields its cards should have.

### 3. Deep linking

Cards link to each other through `cardLink` / `cardLinks` **fields** — not in-text `@` mentions, but structured field-level references. The referenced card automatically gets a backlink. The whole network is browsable, draggable, and filterable in the **Connections** view.

## Three core concepts

- **Card** — the smallest unit. Every card has body text, properties, links, and lives in one or more sets.
- **Set** — a container for cards. Sets nest arbitrarily; a card can belong to multiple sets at once, or temporarily belong to none (a "loose card").
- **Link** — references between cards built through `cardLink` / `cardLinks` properties. Backlinks are automatic.

## Eight built-in card types

| Type | For | Sub-templates |
|---|---|---|
| Note | Text, thoughts, journal | 6 |
| File | Image / video / audio / doc / other | 5 |
| Topic | People, orgs, places, books, films… | 12 |
| Clip | Web / email / social platforms | 14 |
| Task | To-do / Schedule / Habit | 3 |
| Project | Doing / Archived | 2 |
| Expense | Daily / Subscriptions / Reimburse | 3 |
| Account | Logins / Bank Card / ID | 3 |

See [Card types](/docs/cards) for details.

## Who it's for

- People who like **structured notes** and want fields on them
- People who want one tool for reading notes, web clips, to-dos, and projects
- A lighter, quieter alternative to Notion / Obsidian — no heavy collaboration

## Current stage

cardnote is in **public beta**:

- Single-player; no collaboration yet
- Data lives under your remote account; sign in from any browser
- **Not** end-to-end encrypted — Account-card password fields are stored as plain text under your account. Don't put your most sensitive credentials in without thinking about it.

Continue: [Quickstart](/docs/quickstart)
