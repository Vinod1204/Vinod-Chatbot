import type {
    ChatResponse,
    ConversationDetail,
    ConversationSummary,
    CreateConversationPayload,
    StoredUser,
} from "./types";
import { loadStoredUser } from "./auth";
import { API_ROOT } from "./config";
const USER_ID_HEADER = "x-user-id";

const supportsHeaders = (): boolean => typeof Headers !== "undefined";

const toHeaderRecord = (input?: HeadersInit): Record<string, string> => {
    if (!input) {
        return {};
    }
    if (supportsHeaders() && input instanceof Headers) {
        const record: Record<string, string> = {};
        input.forEach((value, key) => {
            record[key] = value;
        });
        return record;
    }
    if (Array.isArray(input)) {
        const record: Record<string, string> = {};
        for (const [key, value] of input) {
            record[key] = value;
        }
        return record;
    }
    return { ...(input as Record<string, string>) };
};

const authHeaders = (): Record<string, string> => {
    const user = loadStoredUser();
    if (!user?.userId) {
        return {};
    }
    return { [USER_ID_HEADER]: user.userId };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${API_ROOT}${path}`;
    let response: Response;
    try {
        const mergedHeaders = {
            "Content-Type": "application/json",
            ...authHeaders(),
            ...toHeaderRecord(init?.headers),
        };
        response = await fetch(url, {
            ...init,
            headers: mergedHeaders,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not reach the API at ${url}. ${message}`);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    let payload: unknown;
    const text = await response.text();
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (err) {
            throw new Error(`Unexpected server response: ${text}`);
        }
    }

    if (!response.ok) {
        const detail = (payload as { detail?: string })?.detail;
        throw new Error(detail || `Request failed with status ${response.status}`);
    }

    return payload as T;
}

export async function listConversations(): Promise<ConversationSummary[]> {
    return request<ConversationSummary[]>("/api/conversations");
}

export async function getConversation(
    conversationId: string,
): Promise<ConversationDetail> {
    return request<ConversationDetail>(`/api/conversations/${encodeURIComponent(conversationId)}`);
}

export async function createConversation(
    payload: CreateConversationPayload,
): Promise<ConversationDetail> {
    return request<ConversationDetail>("/api/conversations", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function deleteConversation(conversationId: string): Promise<void> {
    await request<void>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: "DELETE",
    });
}

export async function sendMessage(
    conversationId: string,
    content: string,
    extra?: { model?: string; systemPrompt?: string },
): Promise<ChatResponse> {
    return request<ChatResponse>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, ...extra }),
    });
}

export async function signupUser(payload: {
    email: string;
    password: string;
    name?: string | null;
}): Promise<StoredUser> {
    return request<StoredUser>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function loginUser(payload: { email: string; password: string }): Promise<StoredUser> {
    return request<StoredUser>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}