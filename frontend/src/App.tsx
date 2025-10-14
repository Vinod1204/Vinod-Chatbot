import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Message, useChat } from "ai/react";
import { Loader2, Paperclip, Plus, SendHorizonal, Sparkles } from "lucide-react";
import clsx from "clsx";
import {
    createConversation,
    deleteConversation,
    getConversation,
    listConversations,
} from "./api";
import type {
    ConversationDetail,
    ConversationSummary,
    CreateConversationPayload,
} from "./types";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { MessageBubble } from "./components/MessageBubble";
import { CreateConversationDialog } from "./components/CreateConversationDialog";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";
const DEFAULT_MODEL = (import.meta.env.VITE_DEFAULT_MODEL as string | undefined) ?? "gpt-4o-mini";

const toMessages = (conversation: ConversationDetail): Message[] =>
    conversation.messages.map((entry, index) => ({
        id: `${conversation.conversationId}-${index}`,
        role: entry.role,
        content: entry.content,
    }));

type UiMessage = Message & { timestamp?: string };

const decorateMessages = (
    conversation: ConversationDetail | null,
    messages: Message[],
): UiMessage[] =>
    messages.map((message, index) => ({
        ...message,
        timestamp: conversation?.messages[index]?.timestamp,
    }));

const summariseConversation = (
    summaries: ConversationSummary[],
    detail: ConversationDetail,
): ConversationSummary[] => {
    const filtered = summaries.filter((item) => item.conversationId !== detail.conversationId);
    const summary: ConversationSummary = {
        conversationId: detail.conversationId,
        model: detail.model,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        messageCount: detail.messageCount,
    };
    return [summary, ...filtered];
};

export default function App() {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [currentConversation, setCurrentConversation] = useState<ConversationDetail | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [hasAutoPromptedCreate, setHasAutoPromptedCreate] = useState(false);
    const [createBusy, setCreateBusy] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    const { messages, append, isLoading, setMessages, input, handleInputChange, setInput } = useChat({
        api: `${API_BASE}/api/chat`,
        sendExtraMessageFields: true,
    });

    const handleSelectConversation = useCallback(
        async (conversationId: string) => {
            setActiveConversationId(conversationId);
            setToast(null);
            try {
                const detail = await getConversation(conversationId);
                setCurrentConversation(detail);
                setMessages(toMessages(detail));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setToast({ type: "error", message });
            }
        },
        [setMessages],
    );

    const refreshConversations = useCallback(async () => {
        try {
            const list = await listConversations();
            setConversations(list);
            if (list.length === 0) {
                if (!hasAutoPromptedCreate) {
                    setShowCreateModal(true);
                    setCreateError(null);
                    setHasAutoPromptedCreate(true);
                }
            } else if (!activeConversationId) {
                await handleSelectConversation(list[0].conversationId);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setToast({ type: "error", message });
        }
    }, [activeConversationId, handleSelectConversation, hasAutoPromptedCreate]);

    useEffect(() => {
        void refreshConversations();
    }, [refreshConversations]);

    const handleCreateConversation = useCallback(
        async (payload: CreateConversationPayload) => {
            setCreateBusy(true);
            setCreateError(null);
            try {
                const detail = await createConversation({ ...payload, overwrite: false });
                setShowCreateModal(false);
                setHasAutoPromptedCreate(true);
                setConversations((prev: ConversationSummary[]) => summariseConversation(prev, detail));
                await handleSelectConversation(detail.conversationId);
                setToast({ type: "success", message: "Conversation created." });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setCreateError(message);
            } finally {
                setCreateBusy(false);
            }
        },
        [handleSelectConversation],
    );

    const handleDeleteConversation = useCallback(
        async (conversationId: string) => {
            const confirmed = window.confirm(
                `Delete conversation "${conversationId}"? This action cannot be undone.`,
            );
            if (!confirmed) {
                return;
            }
            try {
                await deleteConversation(conversationId);
                setConversations((prev: ConversationSummary[]) =>
                    prev.filter((item: ConversationSummary) => item.conversationId !== conversationId),
                );
                if (activeConversationId === conversationId) {
                    setActiveConversationId(null);
                    setCurrentConversation(null);
                    setMessages([]);
                }
                setToast({ type: "success", message: "Conversation deleted." });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setToast({ type: "error", message });
            }
        },
        [activeConversationId, setMessages],
    );

    const handleSendMessage = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!activeConversationId) {
                setToast({ type: "error", message: "Select or create a conversation first." });
                return;
            }
            const trimmed = input.trim();
            if (!trimmed) {
                return;
            }
            setToast(null);
            try {
                await append(
                    { role: "user", content: trimmed },
                    {
                        body: {
                            conversationId: activeConversationId,
                            model: currentConversation?.model ?? DEFAULT_MODEL,
                        },
                    },
                );
                setInput("");
                const detail = await getConversation(activeConversationId);
                setCurrentConversation(detail);
                setMessages(toMessages(detail));
                setConversations((prev: ConversationSummary[]) => summariseConversation(prev, detail));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setToast({ type: "error", message });
            }
        },
        [activeConversationId, append, currentConversation?.model, input, setInput, setMessages],
    );

    const decoratedMessages = useMemo(
        () => decorateMessages(currentConversation, messages),
        [currentConversation, messages],
    );

    const statusMessage = toast?.message ?? null;
    const statusClass = toast?.type === "error" ? "danger" : undefined;

    return (
        <>
            <div className="app-shell">
                <ConversationSidebar
                    conversations={conversations}
                    activeConversationId={activeConversationId}
                    onSelect={(id) => {
                        void handleSelectConversation(id);
                    }}
                    onCreate={() => {
                        setShowCreateModal(true);
                        setCreateError(null);
                    }}
                    onDelete={(id) => {
                        void handleDeleteConversation(id);
                    }}
                />
                <section className="chat-card">
                    {currentConversation ? (
                        <>
                            <header className="chat-header">
                                <div>
                                    <h1>{currentConversation.conversationId}</h1>
                                    <small>
                                        Model · {currentConversation.model}
                                        {currentConversation.systemPrompt ? ` · ${currentConversation.systemPrompt}` : ""}
                                    </small>
                                </div>
                                <span className="badge">
                                    <Sparkles size={16} /> {currentConversation.messageCount} messages
                                </span>
                            </header>
                            <div className="message-scroll">
                                {decoratedMessages.length === 0 ? (
                                    <div className="empty-state">
                                        <Sparkles size={32} />
                                        <div>
                                            <h2>Say hello to your assistant</h2>
                                            <p>Send a message to kick-start the conversation.</p>
                                        </div>
                                    </div>
                                ) : (
                                    decoratedMessages.map((message) => (
                                        <MessageBubble key={message.id} message={message} timestamp={message.timestamp} />
                                    ))
                                )}
                            </div>
                            <div className="chat-composer">
                                {statusMessage ? (
                                    <div className={clsx("status-bar", statusClass)}>{statusMessage}</div>
                                ) : null}
                                <form onSubmit={handleSendMessage}>
                                    <textarea
                                        value={input}
                                        onChange={handleInputChange}
                                        placeholder="Ask a question or describe a task..."
                                        disabled={!activeConversationId || isLoading}
                                    />
                                    <button
                                        type="submit"
                                        className="send-button"
                                        disabled={!activeConversationId || isLoading || input.trim().length === 0}
                                    >
                                        {isLoading ? <Loader2 size={18} className="spin" /> : <SendHorizonal size={18} />}
                                        Send
                                    </button>
                                </form>
                                <div className="status-bar">
                                    <Paperclip size={14} /> Conversations persist locally in the conversations folder.
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="empty-state">
                            <Sparkles size={40} />
                            <div>
                                <h2>Create your first conversation</h2>
                                <p>Craft a unique thread to explore ideas, debug issues, or draft content.</p>
                            </div>
                            <button className="create-button" type="button" onClick={() => setShowCreateModal(true)}>
                                <Plus size={18} /> Start a conversation
                            </button>
                        </div>
                    )}
                </section>
            </div>
            <CreateConversationDialog
                open={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={(payload) => handleCreateConversation(payload)}
                isSubmitting={createBusy}
                defaultModel={DEFAULT_MODEL}
                error={createError}
            />
        </>
    );
}
