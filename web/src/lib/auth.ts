// API-based auth with JWT tokens stored in localStorage

// Use relative API URL so it works in dev (localhost:3001) and prod (Vercel)
const getApiBase = () => {
  if (typeof window === "undefined") return "http://localhost:3001";
  // Check if custom API URL is set
  if ((window as any).TOPONYMY_API_URL) return (window as any).TOPONYMY_API_URL;
  // On Vercel or same-origin, use relative path
  return "/api";
};

const API_BASE = getApiBase();

export async function register(username: string, password: string): Promise<{ success: boolean; error?: string; userId?: string; token?: string }> {
  if (!username || !password) return { success: false, error: "Username and password required" };
  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) return { success: false, error: data.error };
    // Store token in localStorage
    if (data.token) localStorage.setItem("tm_token", data.token);
    if (data.userId) localStorage.setItem("tm_user_id", data.userId);
    if (data.username) localStorage.setItem("tm_username", data.username);
    window.dispatchEvent(new CustomEvent("tm_auth_changed", { detail: { userId: data.userId, username: data.username } }));
    return { success: true, userId: data.userId, token: data.token };
  } catch (e: any) {
    return { success: false, error: e.message ?? "Register failed" };
  }
}

export async function login(password: string): Promise<{ success: boolean; error?: string; userId?: string; token?: string }> {
  if (!password) return { success: false, error: "Password required" };
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!data.success) return { success: false, error: data.error };
    // Store token in localStorage
    if (data.token) localStorage.setItem("tm_token", data.token);
    if (data.userId) localStorage.setItem("tm_user_id", data.userId);
    if (data.username) localStorage.setItem("tm_username", data.username);
    window.dispatchEvent(new CustomEvent("tm_auth_changed", { detail: { userId: data.userId, username: data.username } }));
    return { success: true, userId: data.userId, token: data.token };
  } catch (e: any) {
    return { success: false, error: e.message ?? "Login failed" };
  }
}

export function logout() {
  localStorage.removeItem("tm_token");
  localStorage.removeItem("tm_user_id");
  localStorage.removeItem("tm_username");
  window.dispatchEvent(new CustomEvent("tm_auth_changed", { detail: { userId: null, username: null } }));
}

export function getCurrentUser(): string | null {
  return localStorage.getItem("tm_user_id");
}

export function getUsername(): string | null {
  return localStorage.getItem("tm_username");
}

export function getToken(): string | null {
  return localStorage.getItem("tm_token");
}

// helper to ask Auth UI to show
export function showAuth() {
  window.dispatchEvent(new CustomEvent("tm_show_auth"));
}

// small helper that listens for auth changes
export function onAuthChange(cb: (userId: string | null, username?: string | null) => void) {
  const handler = (e: Event) => cb((e as CustomEvent).detail?.userId ?? null, (e as CustomEvent).detail?.username ?? null);
  window.addEventListener("tm_auth_changed", handler as EventListener);
  return () => window.removeEventListener("tm_auth_changed", handler as EventListener);
}

export default { register, login, logout, getCurrentUser, getUsername, getToken, showAuth, onAuthChange };
