import clsx from "clsx";
import type { Message } from "ai";

const formatTimestamp = (iso?: string): string | null => {
    if (!iso) return null;
    try {
        const dt = new Date(iso);
        return dt.toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            month: "short",
            day: "numeric",
        });
    } catch (_error) {
        return iso;
    }
};

type MessageBubbleProps = {
    message: Message;
    timestamp?: string;
};

export function MessageBubble({ message, timestamp }: MessageBubbleProps) {
    const formattedTime = formatTimestamp(timestamp);
    const label = message.role === "user" ? "You" : "Assistant";

    return (
        <div>
            <div className={clsx("message-bubble", message.role)}>
                <strong>{label}</strong>
                <div>{message.content}</div>
            </div>
            {formattedTime ? <div className="message-timestamp">{formattedTime}</div> : null}
        </div>
    );
}
