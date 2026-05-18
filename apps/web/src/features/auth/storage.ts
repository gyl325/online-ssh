import type { AuthUser } from "./types";

const AUTH_USER_STORAGE_KEY = "online-ssh.auth-user";

export function loadStoredUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
    return null;
  }
}

export function storeUser(user: AuthUser | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!user) {
    window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearAuthStorage() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
}
