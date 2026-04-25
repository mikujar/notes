# 属性字段

属性字段是卡片身上的结构化数据。cardnote 提供 **9 种**字段类型。

## 字段类型一览

| 类型 | 用途 | 值的形态 |
|---|---|---|
| `text` | 单行 / 多行文本 | `string` |
| `number` | 数字（含单位） | `number` |
| `choice` | 选项（单选 / 多选合并） | `string[]`（id 列表） |
| `date` | 日期，可选时分 | `YYYY-MM-DD` 或带时间 |
| `checkbox` | 勾选框 | `boolean` |
| `url` | 链接 | `string` |
| `cardLink` | 关联另一张卡片 | `{ colId, cardId }` |
| `cardLinks` | 关联多张卡片 | `{ colId, cardId }[]` |
| `collectionLink` | 关联多个合集 | `string[]`（合集 id） |

## 选项字段（choice）

`choice` 把过去的"单选"和"多选"合并成一种类型——值始终是字符串数组，长度为 1 时表现为单选。每个选项有 `id` / `name` / `color`，在 schema 里集中管理。

## 关联字段（cardLink / cardLinks / collectionLink）

- **`cardLink`** · 一对一关联，用于"读书笔记 → 书籍"、"日记 → 当天天气"这类。
- **`cardLinks`** · 一对多，用于"人物 → 多部作品"、"项目 → 多个待办"。
- **`collectionLink`** · 把卡片**和合集**关联，但**不**改变卡片的实际归属合集。常见用途：在散乱卡片上标记"这张属于 H1 季度复盘"——不改归属，只加标签。

## 不支持的字段类型

为避免误解，明确列出**不存在**的字段类型：

- ❌ `tag`（标签独立类型）——cardnote 用 `choice` 表达多选，或者直接用 `cardLinks` 指向「主题」卡片
- ❌ `rating`（星级评分）——用 `number` 自己定义 1–5
- ❌ `color`（独立颜色字段）——颜色作为 `choice` 选项的属性
- ❌ `person`（独立"人"字段）——用 `cardLink` 指向「主题/人物」
- ❌ `formula`（公式 / 计算字段）

## 在哪里看到

- **卡片详情页右侧面板**——逐字段显示 / 编辑
- **侧栏 / 时间线**只显示部分字段的简要值（不会塞满）
- 自定义字段值进入全文搜索索引

## Schema 继承 vs 卡片自定义

合集里的卡片自动继承合集 schema。给单张卡片加一次性字段（`custom_props`）不会污染合集——只在那张卡片上。这适合临时给某张卡片加一两个 ad-hoc 字段。
