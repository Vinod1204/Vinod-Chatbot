import type { StoredUser } from "./types";

const STORAGE_KEY = "vinod-chatbot-user";

export function loadStoredUser(): StoredUser | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as StoredUser;
        if (parsed?.userId && parsed?.email) {
            return parsed;
        }
    } catch (_error) {
        /* ignore storage errors */
    }
    return null;
}

export function saveStoredUser(user: StoredUser): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch (_error) {
        /* ignore storage errors */
    }
}

export function clearStoredUser(): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
        /* ignore storage errors */
    }
}
