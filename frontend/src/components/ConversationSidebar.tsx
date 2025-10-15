import clsx from "clsx";
import { KeyboardEvent } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { ConversationSummary } from "../types";

type SidebarProps = {
    conversations: ConversationSummary[];
    activeConversationId: string | null;
    onSelect: (conversationId: string) => void;
    onCreate: () => void;
    onDelete: (conversationId: string) => void;
};

export function ConversationSidebar({
    conversations,
    activeConversationId,
    onSelect,
    onCreate,
    onDelete,
}: SidebarProps) {
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
                        onClick={() => onSelect(conversation.conversationId)}
                        tabIndex={0}
                        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelect(conversation.conversationId);
                            }
                        }}
                    >
                        <div className="conversation-info">
                            <span className="conversation-name">{conversation.conversationId}</span>
                            {conversation.messageCount > 0 ? (
                                <span className="conversation-meta">
                                    {conversation.messageCount} {conversation.messageCount === 1 ? "message" : "messages"}
                                </span>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            className="secondary-button danger-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete(conversation.conversationId);
                            }}
                            aria-label={`Delete ${conversation.conversationId}`}
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </aside>
    );
}
