#!/usr/bin/env bash
# 将 test/railway.dump（或第一个参数）恢复到本机临时库并跑 pg-migrate-incremental.js
#
# 要求：
#   - pg_restore 与备份时的 PostgreSQL 主版本一致或更新（Railway PG18 → 需本机 PG16+ 的 pg_restore）
#   - 若报错 unsupported version (1.x) in file header → brew install postgresql@18
#       并把 PATH 设为：export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
#   - server/.env 里 DATABASE_URL 仅用于读取密码/主机；目标库名由第二个参数指定（默认 mikujar_cloud_dump_test）
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DUMP="${1:-$ROOT/test/railway.dump}"
TARGET_DB="${2:-mikujar_cloud_dump_test}"

if [[ ! -f "$DUMP" ]]; then
  echo "❌ 找不到 dump: $DUMP"
  exit 1
fi

# Railway 等 PG16+ 导出的 custom dump 需 pg_restore 版本足够新（建议 brew install postgresql@17）
if [[ -x "/opt/homebrew/opt/postgresql@17/bin/pg_restore" ]]; then
  export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "❌ 未找到 pg_restore，请先安装 PostgreSQL 客户端。"
  exit 1
fi

echo "pg_restore: $(command -v pg_restore) ($(pg_restore --version))"
echo "📂 dump: $DUMP"
echo "🗄️  目标库: $TARGET_DB"

# 从 server/.env 解析 DATABASE_URL（仅本机开发用）
ENV_FILE="$ROOT/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 缺少 $ENV_FILE"
  exit 1
fi
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ server/.env 未设置 DATABASE_URL"
  exit 1
fi

# postgresql://user:pass@host:port/dbname
if [[ "$DATABASE_URL" =~ postgresql://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+) ]]; then
  PGUSER="${BASH_REMATCH[1]}"
  export PGPASSWORD="${BASH_REMATCH[2]}"
  PGHOST="${BASH_REMATCH[3]}"
  PGPORT="${BASH_REMATCH[5]:-5432}"
else
  echo "❌ 无法解析 DATABASE_URL"
  exit 1
fi

export PGUSER PGHOST PGPORT

dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$TARGET_DB" || true
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$TARGET_DB"

echo "📥 pg_restore …"
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --no-owner --no-acl -d "$TARGET_DB" "$DUMP"

TEST_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${TARGET_DB}"
export DATABASE_URL="$TEST_URL"

echo "📦 npm run db:migrate（目标: ${TARGET_DB}）…"
cd "$ROOT/server"
npm run db:migrate

echo ""
echo "✅ 完成。自检可执行："
echo "   psql \"$TEST_URL\" -c \"\\\\dt trashed_notes\" -c \"SELECT count(*) FROM cards WHERE trashed_at IS NOT NULL;\""
echo ""
echo "（本脚本不会修改你原来的业务库名；仅新建 ${TARGET_DB}。）"
