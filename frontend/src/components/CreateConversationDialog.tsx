import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import type { CreateConversationPayload } from "../types";

const MAX_CONVERSATION_ID_LENGTH = 120;

const toConversationSlug = (name: string): string => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
        return "";
    }
    const withDashes = trimmed.replace(/\s+/g, "-");
    const safeCharacters = withDashes.replace(/[^a-z0-9._-]/g, "");
    const collapsed = safeCharacters.replace(/-+/g, "-");
    const trimmedEdges = collapsed.replace(/^[-_.]+|[-_.]+$/g, "");
    return trimmedEdges.slice(0, MAX_CONVERSATION_ID_LENGTH);
};

const randomSuffix = (): string => {
    const cryptoApi = globalThis?.crypto;
    if (cryptoApi?.randomUUID) {
        return cryptoApi.randomUUID().replace(/-/g, "").slice(0, 8);
    }
    return Math.random().toString(36).slice(2, 10);
};

const buildConversationId = (slug: string): string => {
    if (!slug) {
        return "";
    }
    const suffix = randomSuffix().slice(0, 8) || "chat";
    const maxSlugLength = Math.max(1, MAX_CONVERSATION_ID_LENGTH - suffix.length - 1);
    const trimmedSlug = slug.slice(0, maxSlugLength).replace(/[-_.]+$/g, "");
    const safeSlug = trimmedSlug || slug.slice(0, maxSlugLength);
    return `${safeSlug}-${suffix}`;
};

type Props = {
    open: boolean;
    onClose: () => void;
    onCreate: (payload: CreateConversationPayload) => Promise<void>;
    isSubmitting: boolean;
    defaultModel: string;
    error?: string | null;
};

export function CreateConversationDialog({
    open,
    onClose,
    onCreate,
    isSubmitting,
    defaultModel,
    error,
}: Props) {
    const [conversationName, setConversationName] = useState("");
    const [generatedConversationId, setGeneratedConversationId] = useState("");
    const [model, setModel] = useState(defaultModel);
    const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
    const [nameError, setNameError] = useState<string | null>(null);
    const firstInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (open) {
            setConversationName("");
            setGeneratedConversationId("");
            setModel(defaultModel);
            setSystemPrompt("You are a helpful assistant.");
            setNameError(null);
            setTimeout(() => firstInputRef.current?.focus(), 20);
            const handleEsc = (event: KeyboardEvent) => {
                if (event.key === "Escape") {
                    onClose();
                }
            };
            window.addEventListener("keydown", handleEsc);
            return () => window.removeEventListener("keydown", handleEsc);
        }
        return undefined;
    }, [open, defaultModel, onClose]);

    useEffect(() => {
        if (!conversationName) {
            setGeneratedConversationId("");
            return;
        }
        const slug = toConversationSlug(conversationName);
        if (!slug) {
            setGeneratedConversationId("");
            return;
        }
        setGeneratedConversationId(buildConversationId(slug));
    }, [conversationName]);

    if (!open) {
        return null;
    }

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
                <h2>New conversation</h2>
                <p>Create a dedicated thread for your next idea or debugging session.</p>
                <form
                    onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        if (!conversationName.trim()) {
                            setNameError("Please enter a conversation name.");
                            return;
                        }
                        if (!generatedConversationId) {
                            setNameError(
                                "Name must contain letters or numbers so an ID can be generated.",
                            );
                            return;
                        }
                        setNameError(null);
                        await onCreate({
                            conversationId: generatedConversationId,
                            model: model.trim() || undefined,
                            systemPrompt: systemPrompt.trim() || undefined,
                        });
                    }}
                >
                    <div className="input-field">
                        <label htmlFor="conversation-name">Conversation name</label>
                        <input
                            id="conversation-name"
                            ref={firstInputRef}
                            value={conversationName}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                if (nameError) {
                                    setNameError(null);
                                }
                                setConversationName(event.target.value);
                            }}
                            placeholder="e.g. Design Review"
                        />
                        <div className="status-bar" aria-live="polite">
                            Conversation ID: {generatedConversationId || "will generate automatically"}
                        </div>
                        {nameError ? <div className="status-bar danger">{nameError}</div> : null}
                    </div>
                    <div className="input-field">
                        <label htmlFor="model">Model (optional)</label>
                        <input
                            id="model"
                            value={model}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setModel(event.target.value)}
                            placeholder={defaultModel}
                        />
                    </div>
                    <div className="input-field">
                        <label htmlFor="system-prompt">System prompt</label>
                        <textarea
                            id="system-prompt"
                            value={systemPrompt}
                            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                                setSystemPrompt(event.target.value)
                            }
                            rows={3}
                        />
                    </div>
                    {error ? <div className="status-bar danger">{error}</div> : null}
                    <div className="modal-actions">
                        <button
                            type="button"
                            className="secondary-button"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button type="submit" className="create-button" disabled={isSubmitting}>
                            {isSubmitting ? "Creating..." : "Create"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
