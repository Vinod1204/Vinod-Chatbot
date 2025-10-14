import type { Message } from "ai";

export type ConversationSummary = {
    conversationId: string;
    model: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
};

export type ConversationMessage = {
    role: Message["role"];
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
    usage?: Record<string, number>;
};

export type ConversationDetail = ConversationSummary & {
    systemPrompt: string;
    messages: ConversationMessage[];
};

export type ChatResponse = {
    id: string;
    role: Message["role"];
    content: string;
    createdAt: string;
    usage?: Record<string, number>;
    conversation: ConversationDetail;
};

export type CreateConversationPayload = {
    conversationId: string;
    model?: string;
    systemPrompt?: string;
    overwrite?: boolean;
};
