import { useMemo } from "react";
import clsx from "clsx";
import { StopCircle, Volume2 } from "lucide-react";
import type { Message } from "ai";

type MessageBubbleProps = {
    message: Message;
    timestamp?: string;
    speechSupported?: boolean;
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

const ASSISTANT_EMOJI_RULES: Array<{ pattern: RegExp; emoji: string }> = [
    { pattern: /(success|completed|resolved|done)/i, emoji: "\u2705" },
    { pattern: /(warning|caution|important|note)/i, emoji: "\u26A0" },
    { pattern: /(error|issue|problem|bug|failed)/i, emoji: "\u{1F41B}" },
    { pattern: /(idea|tip|suggest|recommend|consider)/i, emoji: "\u{1F4A1}" },
    { pattern: /(plan|roadmap|steps|schedule)/i, emoji: "\u{1F4C5}" },
    { pattern: /(code|snippet|api|function|query)/i, emoji: "\u{1F4BB}" },
    { pattern: /(thanks|thank you|glad|happy)/i, emoji: "\u{1F60A}" },
];

const DEFAULT_ASSISTANT_EMOJI = "\u2728";

const getAssistantEmoji = (text: string): string | null => {
    const rule = ASSISTANT_EMOJI_RULES.find(({ pattern }) => pattern.test(text));
    if (rule) {
        return rule.emoji;
    }
    return text.trim() ? DEFAULT_ASSISTANT_EMOJI : null;
};

const URL_PATTERN = /(https?:\/\/[\w.-]+(?:\/[\w\-./?%&=+#]*)?)/g;

const formatInlineContent = (value: string): string => {
    const escaped = escapeHtml(value);
    const withStrong = escaped.replace(/\*\*(.+?)\*\*/g, (_match, group1: string) => {
        return `<span class="message-heading">${group1}</span>`;
    });
    return withStrong.replace(
        URL_PATTERN,
        (match: string) => `<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>`,
    );
};

const transformToRichText = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) {
        return "<p></p>";
    }

    const blocks = trimmed.split(/\n{2,}/);
    const htmlSegments = blocks
        .map((block) => {
            const lines = block.split("\n");
            if (lines.length === 0) {
                return null;
            }

            const [firstLine, ...restLines] = lines;
            const headingMatch = firstLine.match(/^###\s+(.*)$/);
            if (headingMatch) {
                const headingText = headingMatch[1];
                const headingHtml = `<div class="message-section-title">${formatInlineContent(headingText)}</div>`;
                const hasRestContent = restLines.some((line) => line.trim().length > 0);
                if (!hasRestContent) {
                    return headingHtml;
                }
                const restHtml = restLines
                    .map((line) => formatInlineContent(line))
                    .join("<br/>");
                return `${headingHtml}<p>${restHtml}</p>`;
            }

            const paragraphContent = lines.map((line) => formatInlineContent(line)).join("<br/>");
            if (!paragraphContent.trim()) {
                return null;
            }
            return `<p>${paragraphContent}</p>`;
        })
        .filter((segment): segment is string => Boolean(segment));

    return htmlSegments.join("") || "<p></p>";
};

export function MessageBubble({
    message,
    speechSupported = false,
    isSpeaking = false,
    onSpeak,
    onStop,
}: MessageBubbleProps) {
    const label = message.role === "user" ? "You" : null;
    const contentWithEmoji = useMemo(() => {
        if (message.role !== "assistant") {
            return message.content;
        }
        const emoji = getAssistantEmoji(message.content);
        if (!emoji || message.content.includes(emoji)) {
            return message.content;
        }
        const trimmed = message.content.trimEnd();
        const needsSpace = trimmed.length > 0 && !/\s$/.test(trimmed);
        return `${trimmed}${needsSpace ? " " : ""}${emoji}`;
    }, [message.content, message.role]);

    const formattedContent = useMemo(() => transformToRichText(contentWithEmoji), [contentWithEmoji]);

    return (
        <div className={clsx("message-wrapper", message.role)}>
            <div className={clsx("message-bubble", message.role)}>
                {label ? <strong className="message-label">{label}</strong> : null}
                <div className="message-content" dangerouslySetInnerHTML={{ __html: formattedContent }} />
                {message.role === "assistant" && speechSupported ? (
                    <div className="message-voice-controls">
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
