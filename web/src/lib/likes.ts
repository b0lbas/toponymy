// API-based likes store
import auth from "./auth";

// Use relative API URL so it works in dev and prod
const getApiBase = () => {
  if (typeof window === "undefined") return "http://localhost:3001";
  if ((window as any).TOPONYMY_API_URL) return (window as any).TOPONYMY_API_URL;
  return "/api";
};

const API_BASE = getApiBase();

export async function getLikes(patternKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/likes/${encodeURIComponent(patternKey)}`);
    const data = await res.json();
    return data.users ?? [];
  } catch {
    return [];
  }
}

export async function getCount(patternKey: string): Promise<number> {
  const arr = await getLikes(patternKey);
  return arr.length;
}

export async function hasLiked(patternKey: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const arr = await getLikes(patternKey);
  return arr.includes(userId);
}

export async function toggleLike(patternKey: string, userId: string | null): Promise<{ ok: boolean; liked?: boolean; count?: number; error?: string }> {
  if (!userId) return { ok: false, error: "Not authenticated" };
  const token = auth.getToken();
  if (!token) return { ok: false, error: "No token" };

  try {
    const res = await fetch(`${API_BASE}/likes/toggle`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ patternKey }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error };
    window.dispatchEvent(new CustomEvent("tm_likes_changed", { detail: { patternKey } }));
    return { ok: true, liked: data.liked, count: data.count };
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Toggle failed" };
  }
}

export async function getAllLikes(): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`${API_BASE}/likes`);
    const data = await res.json();
    return data;
  } catch {
    return {};
  }
}

export function onLikesChange(cb: (patternKey?: string) => void) {
  const handler = (e: Event) => cb((e as CustomEvent).detail?.patternKey);
  window.addEventListener("tm_likes_changed", handler as EventListener);
  return () => window.removeEventListener("tm_likes_changed", handler as EventListener);
}

export default { getLikes, getCount, hasLiked, toggleLike, getAllLikes, onLikesChange };
