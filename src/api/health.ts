function apiBase(): string {
  const b = import.meta.env.VITE_API_BASE as string | undefined;
  return b?.replace(/\/$/, "") ?? "";
}

export type ApiHealth = {
  ok?: boolean;
  mediaUpload?: "cos" | "local" | null;
  storage?: string;
};

export async function fetchApiHealth(): Promise<ApiHealth | null> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/health`);
    if (!r.ok) return null;
    return (await r.json()) as ApiHealth;
  } catch {
    return null;
  }
}
