import clsx from "clsx";
import { KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { FileDown, MessageSquare, MoreVertical, Plus, Share2, Trash2 } from "lucide-react";
import type { ConversationSummary } from "../types";

type SidebarProps = {
    conversations: ConversationSummary[];
    activeConversationId: string | null;
    onSelect: (conversationId: string) => void;
    onCreate: () => void;
    onDelete: (conversationId: string) => void;
    onShare: (conversationId: string) => void;
    onSaveAsPdf: (conversationId: string) => void;
    formatTitle: (value: string) => string;
};

export function ConversationSidebar({
    conversations,
    activeConversationId,
    onSelect,
    onCreate,
    onDelete,
    onShare,
    onSaveAsPdf,
    formatTitle,
}: SidebarProps) {
    const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!menuConversationId) {
            menuRef.current = null;
            return;
        }
        const handleClick = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuConversationId(null);
            }
        };
        const handleEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenuConversationId(null);
            }
        };
        document.addEventListener("mousedown", handleClick);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClick);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [menuConversationId]);

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-title">Conversations</div>
                <button type="button" className="create-button" onClick={onCreate}>
                    <Plus size={16} /> New
                </button>
            </div>
            <div className="conversation-list" role="list">
                {conversations.length === 0 && (
                    <div className="empty-state" role="status">
                        <MessageSquare size={28} />
                        <div>
                            <h2>No conversations yet</h2>
                            <p>Create a new thread to start chatting with your assistant.</p>
                        </div>
                    </div>
                )}
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
                                aria-haspopup="menu"
                                aria-expanded={menuConversationId === conversation.conversationId}
                                aria-label={`Open menu for ${conversation.conversationId}`}
                            >
                                <MoreVertical size={16} />
                            </button>
                            {menuConversationId === conversation.conversationId ? (
                                <div
                                    className="conversation-menu"
                                    ref={menuRef}
                                    role="menu"
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onShare(conversation.conversationId);
                                            setMenuConversationId(null);
                                        }}
                                    >
                                        <Share2 size={14} />
                                        <span>Share</span>
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onSaveAsPdf(conversation.conversationId);
                                            setMenuConversationId(null);
                                        }}
                                    >
                                        <FileDown size={14} />
                                        <span>Save as PDF</span>
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="danger"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDelete(conversation.conversationId);
                                            setMenuConversationId(null);
                                        }}
                                    >
                                        <Trash2 size={14} />
                                        <span>Delete</span>
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
}
