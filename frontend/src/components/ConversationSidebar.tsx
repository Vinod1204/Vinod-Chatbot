import clsx from "clsx";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, MoreVertical, Pencil, Plus, Share2, Trash2, X } from "lucide-react";
import brandLogo from "../../ConvoGPT.png";
import type { ConversationSummary } from "../types";

type SidebarProps = {
    conversations: ConversationSummary[];
    activeConversationId: string | null;
    onSelect: (conversationId: string) => void;
    onCreate: () => void;
    onDelete: (conversationId: string) => void;
    onShare: (conversationId: string) => void;
    onSaveAsPdf: (conversationId: string) => void;
    onRename: (conversationId: string, title: string) => Promise<void> | void;
    formatTitle: (value: string) => string;
    onClose?: () => void;
};

export function ConversationSidebar({
    conversations,
    activeConversationId,
    onSelect,
    onCreate,
    onDelete,
    onShare,
    onSaveAsPdf,
    onRename,
    formatTitle,
    onClose,
}: SidebarProps) {
    const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const renameInputRef = useRef<HTMLInputElement | null>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [renameError, setRenameError] = useState<string | null>(null);
    const [renameBusy, setRenameBusy] = useState(false);

    const activeMenuConversation = useMemo(() => {
        if (!menuConversationId) {
            return null;
        }
        return conversations.find((item) => item.conversationId === menuConversationId) ?? null;
    }, [conversations, menuConversationId]);

    useEffect(() => {
        if (!activeMenuConversation) {
            setIsRenaming(false);
            setRenameValue("");
            setRenameError(null);
            setRenameBusy(false);
            return;
        }
        setIsRenaming(false);
        setRenameValue(activeMenuConversation.title);
        setRenameError(null);
        setRenameBusy(false);
    }, [activeMenuConversation]);

    useEffect(() => {
        if (!menuConversationId) {
            menuRef.current = null;
            return;
        }
        const handleEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenuConversationId(null);
            }
        };
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("keydown", handleEscape);
        };
    }, [menuConversationId]);

    useEffect(() => {
        if (!isRenaming) {
            return;
        }
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [isRenaming]);

    const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!activeMenuConversation) {
            return;
        }
        const trimmed = renameValue.trim();
        if (!trimmed) {
            setRenameError("Conversation name cannot be empty.");
            return;
        }
        setRenameBusy(true);
        setRenameError(null);
        try {
            await onRename(activeMenuConversation.conversationId, trimmed);
            setMenuConversationId(null);
            setIsRenaming(false);
            setRenameBusy(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not rename conversation.";
            setRenameError(message);
            setRenameBusy(false);
        }
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-heading">
                    <img src={brandLogo} alt="ConvoGPT logo" className="sidebar-title-logo" />
                    <div className="sidebar-title">Conversations</div>
                </div>
                <div className="sidebar-header-actions">
                    <button type="button" className="create-button" onClick={onCreate}>
                        <Plus size={16} /> New
                    </button>
                    {onClose ? (
                        <button
                            type="button"
                            className="icon-button sidebar-close"
                            onClick={onClose}
                            aria-label="Close conversations panel"
                        >
                            <X size={16} />
                        </button>
                    ) : null}
                </div>
            </div>
            <div className="conversation-list" role="list">
                {conversations.map((conversation) => (
                    <div
                        key={conversation.conversationId}
                        role="listitem"
                        className={clsx("conversation-item", {
                            active: conversation.conversationId === activeConversationId,
                        })}
                        onClick={() => {
                            setMenuConversationId(null);
                            onSelect(conversation.conversationId);
                        }}
                        tabIndex={0}
                        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setMenuConversationId(null);
                                onSelect(conversation.conversationId);
                            }
                        }}
                    >
                        <div className="conversation-info">
                            <span className="conversation-name">
                                {formatTitle(conversation.title)}
                            </span>
                        </div>
                        <div className="conversation-actions">
                            <button
                                type="button"
                                className="icon-button conversation-menu-trigger"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setMenuConversationId((current) =>
                                        current === conversation.conversationId ? null : conversation.conversationId,
                                    );
                                }}
                                aria-haspopup="dialog"
                                aria-expanded={menuConversationId === conversation.conversationId}
                                aria-label={`Open menu for ${conversation.conversationId}`}
                            >
                                <MoreVertical size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {activeMenuConversation ? (
                <div
                    className="conversation-menu-overlay"
                    role="presentation"
                    onClick={() => setMenuConversationId(null)}
                >
                    <div
                        className="conversation-menu-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="conversation-menu-title"
                        onClick={(event) => event.stopPropagation()
                        }
                        ref={menuRef}
                    >
                        <header className="conversation-menu-header">
                            <div>
                                <h2 id="conversation-menu-title">Conversation options</h2>
                                <p>{formatTitle(activeMenuConversation.title)}</p>
                            </div>
                            <button
                                type="button"
                                className="icon-button conversation-menu-close"
                                onClick={() => setMenuConversationId(null)}
                                aria-label="Close conversation options"
                            >
                                <X size={16} />
                            </button>
                        </header>
                        <div className="conversation-menu-actions">
                            {isRenaming ? (
                                <form className="conversation-rename-form" onSubmit={handleRenameSubmit}>
                                    <label className="sr-only" htmlFor="conversation-rename-input">
                                        New conversation name
                                    </label>
                                    <input
                                        id="conversation-rename-input"
                                        ref={renameInputRef}
                                        type="text"
                                        value={renameValue}
                                        onChange={(event) => {
                                            setRenameValue(event.target.value);
                                            if (renameError) {
                                                setRenameError(null);
                                            }
                                        }}
                                        disabled={renameBusy}
                                        placeholder="Enter a new name"
                                        autoComplete="off"
                                    />
                                    {renameError ? <p className="conversation-rename-error">{renameError}</p> : null}
                                    <div className="conversation-rename-actions">
                                        <button type="button" onClick={() => {
                                            setIsRenaming(false);
                                            setRenameError(null);
                                            setRenameValue(activeMenuConversation.title);
                                            setRenameBusy(false);
                                        }} disabled={renameBusy}>
                                            Cancel
                                        </button>
                                        <button type="submit" disabled={renameBusy}>
                                            {renameBusy ? "Saving..." : "Save"}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsRenaming(true);
                                            setRenameError(null);
                                        }}
                                    >
                                        <Pencil size={14} />
                                        <span>Rename conversation</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onShare(activeMenuConversation.conversationId);
                                            setMenuConversationId(null);
                                        }}
                                    >
                                        <Share2 size={14} />
                                        <span>Share conversation</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onSaveAsPdf(activeMenuConversation.conversationId);
                                            setMenuConversationId(null);
                                        }}
                                    >
                                        <FileDown size={14} />
                                        <span>Save as PDF</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="danger"
                                        onClick={() => {
                                            onDelete(activeMenuConversation.conversationId);
                                            setMenuConversationId(null);
                                        }}
                                    >
                                        <Trash2 size={14} />
                                        <span>Delete conversation</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </aside>
    );
}
