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
    const res = await fetch(`${API_BASE}/likes`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data[patternKey] || []) as string[];
  } catch (e) {
    console.error("getLikes error:", e);
    return [];
  }
}

export async function getCount(patternKey: string): Promise<number> {
  try {
    const arr = await getLikes(patternKey);
    return arr.length;
  } catch (e) {
    console.error("getCount error:", e);
    return 0;
  }
}

export async function hasLiked(patternKey: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const token = auth.getToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API_BASE}/likes/${encodeURIComponent(patternKey)}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.liked === true;
  } catch (e) {
    console.error("hasLiked error:", e);
    return false;
  }
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
    
    if (!res.ok) {
      const errData = await res.json();
      return { ok: false, error: errData.error || "Toggle failed" };
    }

    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error };
    
    // Dispatch event for CountryPanel to update sorting
    // SmallMultiple will ignore this since it updates state directly from response
    window.dispatchEvent(new CustomEvent("tm_likes_changed", { detail: { patternKey } }));
    
    return { ok: true, liked: data.liked, count: data.count };
  } catch (e: any) {
    console.error("toggleLike error:", e);
    return { ok: false, error: e.message ?? "Toggle failed" };
  }
}

export async function getAllLikes(): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`${API_BASE}/likes`);
    if (!res.ok) return {};
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("getAllLikes error:", e);
    return {};
  }
}

export function onLikesChange(cb: (patternKey?: string) => void) {
  const handler = (e: Event) => cb((e as CustomEvent).detail?.patternKey);
  window.addEventListener("tm_likes_changed", handler as EventListener);
  return () => window.removeEventListener("tm_likes_changed", handler as EventListener);
}

export default { getLikes, getCount, hasLiked, toggleLike, getAllLikes, onLikesChange };
