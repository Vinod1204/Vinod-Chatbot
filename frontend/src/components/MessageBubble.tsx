import { useMemo } from "react";
import clsx from "clsx";
import { StopCircle, Volume2 } from "lucide-react";
import type { Message } from "ai";

type MessageBubbleProps = {
    message: Message;
    timestamp?: string;
    speechSupported?: boolean;
    voiceGender?: "female" | "male";
    isSpeaking?: boolean;
    onSpeak?: () => void;
    onStop?: () => void;
};

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const transformToRichText = (raw: string): string => {
    const escaped = escapeHtml(raw.trim());
    const withHeadings = escaped.replace(/\*\*(.+?)\*\*/g, (_match, group1: string) => {
        return `<span class="message-heading">${group1}</span>`;
    });
    const paragraphs = withHeadings
        .split(/\n{2,}/)
        .map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`)
        .join("");
    return paragraphs || "<p></p>";
};

export function MessageBubble({
    message,
    speechSupported = false,
    voiceGender = "female",
    isSpeaking = false,
    onSpeak,
    onStop,
}: MessageBubbleProps) {
    const label = message.role === "user" ? "You" : "Assistant";

    const formattedContent = useMemo(() => transformToRichText(message.content), [message.content]);

    return (
        <div className={clsx("message-wrapper", message.role)}>
            <div className={clsx("message-bubble", message.role)}>
                <strong className="message-label">{label}</strong>
                <div className="message-content" dangerouslySetInnerHTML={{ __html: formattedContent }} />
                {message.role === "assistant" && speechSupported ? (
                    <div className="message-voice-controls">
                        <span className="voice-pill">{voiceGender === "female" ? "Female" : "Male"} voice</span>
                        <button
                            type="button"
                            className={clsx("message-voice-button", { active: isSpeaking })}
                            onClick={() => {
                                if (isSpeaking) {
                                    onStop?.();
                                } else {
                                    onSpeak?.();
                                }
                            }}
                            disabled={isSpeaking ? !onStop : !onSpeak}
                        >
                            {isSpeaking ? <StopCircle size={16} /> : <Volume2 size={16} />}
                            <span>{isSpeaking ? "Stop" : "Play"}</span>
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
