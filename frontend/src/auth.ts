import type { StoredUser } from "./types";

const STORAGE_KEY = "convogpt-user";
const LEGACY_USER_KEYS = ["vinod-chatbot-user"];
const GUEST_KEY = "convogpt-guest";
const LEGACY_GUEST_KEYS = ["vinod-chatbot-guest"];

export function loadStoredUser(): StoredUser | null {
    if (typeof window === "undefined") {
        return null;
    }
    const keysToCheck = [STORAGE_KEY, ...LEGACY_USER_KEYS];
    for (const key of keysToCheck) {
        let raw: string | null = null;
        try {
            raw = window.localStorage.getItem(key);
        } catch (_error) {
            return null;
        }
        if (!raw) {
            continue;
        }
        try {
            const parsed = JSON.parse(raw) as StoredUser;
            if (parsed?.userId && parsed?.email) {
                if (key !== STORAGE_KEY) {
                    try {
                        window.localStorage.setItem(STORAGE_KEY, raw);
                        window.localStorage.removeItem(key);
                    } catch (_error) {
                        /* ignore migration errors */
                    }
                }
                return parsed;
            }
        } catch (_error) {
            /* ignore parse errors */
        }
    }
    return null;
}

export function saveStoredUser(user: StoredUser): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        const payload = JSON.stringify(user);
        window.localStorage.setItem(STORAGE_KEY, payload);
        for (const legacyKey of LEGACY_USER_KEYS) {
            window.localStorage.removeItem(legacyKey);
        }
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
        for (const legacyKey of LEGACY_USER_KEYS) {
            window.localStorage.removeItem(legacyKey);
        }
    } catch (_error) {
        /* ignore storage errors */
    }
}

export function loadGuestId(): string | null {
    if (typeof window === "undefined") {
        return null;
    }
    const keysToCheck = [GUEST_KEY, ...LEGACY_GUEST_KEYS];
    for (const key of keysToCheck) {
        let value: string | null = null;
        try {
            value = window.localStorage.getItem(key);
        } catch (_error) {
            return null;
        }
        const trimmed = value && value.trim() ? value.trim() : null;
        if (!trimmed) {
            continue;
        }
        if (key !== GUEST_KEY) {
            try {
                window.localStorage.setItem(GUEST_KEY, trimmed);
                window.localStorage.removeItem(key);
            } catch (_error) {
                /* ignore migration errors */
            }
        }
        return trimmed;
    }
    return null;
}

const randomGuestId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().replace(/-/g, "");
    }
    return Math.random().toString(36).slice(2, 14);
};

export function ensureGuestId(): string | null {
    if (typeof window === "undefined") {
        return null;
    }
    const existing = loadGuestId();
    if (existing) {
        return existing;
    }
    const generated = randomGuestId();
    try {
        window.localStorage.setItem(GUEST_KEY, generated);
    } catch (_error) {
        /* ignore storage errors */
    }
    return generated;
}

export function clearGuestId(): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.removeItem(GUEST_KEY);
        for (const legacyKey of LEGACY_GUEST_KEYS) {
            window.localStorage.removeItem(legacyKey);
        }
    } catch (_error) {
        /* ignore storage errors */
    }
}
