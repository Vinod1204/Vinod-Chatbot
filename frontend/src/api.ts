import type {
    ChatResponse,
    ConversationDetail,
    ConversationSummary,
    CreateConversationPayload,
} from "./types";

const API_ROOT = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${API_ROOT}${path}`;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                ...(init?.headers ?? {}),
            },
            ...init,
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