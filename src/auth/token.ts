const KEY = "mikujar_admin_jwt";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(KEY);
}
