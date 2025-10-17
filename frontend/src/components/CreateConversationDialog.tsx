import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import type { CreateConversationPayload } from "../types";

type Props = {
    open: boolean;
    onClose: () => void;
    onCreate: (payload: CreateConversationPayload) => Promise<void>;
    isSubmitting: boolean;
    error?: string | null;
};

export function CreateConversationDialog({
    open,
    onClose,
    onCreate,
    isSubmitting,
    error,
}: Props) {
    const [conversationName, setConversationName] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
    const [nameError, setNameError] = useState<string | null>(null);
    const firstInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (open) {
            setConversationName("");
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
    }, [open, onClose]);

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
                        setNameError(null);
                        await onCreate({
                            title: conversationName.trim(),
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
                        {nameError ? <div className="status-bar danger">{nameError}</div> : null}
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
