import pg from "pg";

let pool = null;

/**
 * 获取（或惰性创建）全局连接池。
 * 须先设置环境变量 DATABASE_URL。
 */
export function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL 未配置，请在环境变量中设置腾讯云 PostgreSQL 连接串");

  pool = new pg.Pool({
    connectionString: url,
    // 腾讯云 PG 使用 SSL；若需完整证书验证可改为 { ca: fs.readFileSync('...') }
    ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false },

    max: 10,                          // 最大连接数（腾讯云基础版通常 ≥100）
    min: 2,                           // 保持最小常驻连接，减少冷启动延迟
    idleTimeoutMillis: 30_000,        // 空闲 30s 回收（短于腾讯云 NAT 900s 超时）
    connectionTimeoutMillis: 8_000,   // 建连超时

    // TCP keep-alive：防止 NAT 网关静默断开长闲置连接
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  // 每条新连接建立后设置 statement_timeout，防止慢查询挂死进程
  pool.on("connect", (client) => {
    client.query("SET statement_timeout = '30s'").catch(() => {});
  });

  pool.on("error", (err) => {
    // pg 库会自动从池中移除出错的 client，这里只记录日志
    console.error("[pg] idle client error:", err.message);
  });

  return pool;
}

/**
 * 执行单条 SQL，自动从池中借/还连接。
 * 遇到可重试的瞬时错误（连接断开）最多重试一次。
 */
export async function query(sql, params, { retry = 1 } = {}) {
  try {
    return await getPool().query(sql, params);
  } catch (err) {
    const code = err.code ?? err.errno;
    const transient = [
      "ECONNRESET", "ECONNREFUSED", "EPIPE",
      "57P01",  // 管理员终止连接
      "08006",  // 连接失败
      "08001",  // 无法连接
    ].includes(code);
    if (retry > 0 && transient) {
      console.warn("[pg] transient error, retrying:", code);
      await new Promise((r) => setTimeout(r, 200));
      return query(sql, params, { retry: retry - 1 });
    }
    throw err;
  }
}

/** 借出客户端，用于事务。调用方必须 finally { client.release() } */
export async function getClient() {
  return getPool().connect();
}

/** 优雅关闭连接池（SIGTERM 时调用） */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** 健康检查：SELECT 1；失败则抛出异常 */
export async function pingDb() {
  await query("SELECT 1");
}
