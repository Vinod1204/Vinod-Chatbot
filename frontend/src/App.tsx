import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Message, useChat } from "ai/react";
import {
    Calculator,
    Loader2,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    SendHorizonal,
    Sparkles,
    Sun,
    Volume2,
    StopCircle,
} from "lucide-react";
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
import { CalculatorPanel } from "./components/CalculatorPanel";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";
const DEFAULT_MODEL = (import.meta.env.VITE_DEFAULT_MODEL as string | undefined) ?? "gpt-4o-mini";
const FEMALE_VOICE_HINTS = [
    "female",
    "zira",
    "aria",
    "joanna",
    "amy",
    "emma",
    "salli",
    "ivy",
    "sarah",
    "olivia",
    "samantha",
    "nova",
    "alloy",
];
const MALE_VOICE_HINTS = [
    "male",
    "david",
    "guy",
    "matthew",
    "brian",
    "joey",
    "kevin",
    "stephen",
    "justin",
    "liam",
    "oliver",
    "roger",
    "alloy",
];

const toMessages = (conversation: ConversationDetail): Message[] =>
    conversation.messages.map((entry, index) => ({
        id: `${conversation.conversationId}-${index}`,
        role: entry.role,
        content: entry.content,
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
    const [showCalculator, setShowCalculator] = useState(false);
    const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
    const [isNarratingConversation, setIsNarratingConversation] = useState(false);
    const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
    const [speechSupported, setSpeechSupported] = useState(false);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [theme, setTheme] = useState<"light" | "dark">(() => {
        if (typeof window === "undefined") {
            return "light";
        }
        try {
            const stored = window.localStorage.getItem("vinod-chatbot-theme");
            if (stored === "light" || stored === "dark") {
                return stored;
            }
        } catch (_error) {
            /* ignore storage errors */
        }
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    });
    const shellRef = useRef<HTMLDivElement | null>(null);
    const [sidebarWidth, setSidebarWidth] = useState(320);
    const [isResizing, setIsResizing] = useState(false);
    const [isCompactLayout, setIsCompactLayout] = useState(() =>
        typeof window === "undefined" ? false : window.innerWidth < 960,
    );
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const { messages, append, isLoading, setMessages, input, handleInputChange, setInput } = useChat({
        api: `${API_BASE}/api/chat`,
        sendExtraMessageFields: true,
    });

    useEffect(() => {
        if (typeof document !== "undefined") {
            document.documentElement.dataset.theme = theme;
        }
        if (typeof window !== "undefined") {
            try {
                window.localStorage.setItem("vinod-chatbot-theme", theme);
            } catch (_error) {
                /* no-op when storage is unavailable */
            }
        }
    }, [theme]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const updateLayout = () => setIsCompactLayout(window.innerWidth < 960);
        updateLayout();
        window.addEventListener("resize", updateLayout);
        return () => window.removeEventListener("resize", updateLayout);
    }, []);

    useEffect(() => {
        if (isCompactLayout) {
            setIsResizing(false);
        }
    }, [isCompactLayout]);

    const handleResizerMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (isCompactLayout) {
            return;
        }
        event.preventDefault();
        setIsResizing(true);
    }, [isCompactLayout]);

    useEffect(() => {
        if (!isResizing) {
            return;
        }
        const handleMouseMove = (event: MouseEvent) => {
            if (!shellRef.current) {
                return;
            }
            const rect = shellRef.current.getBoundingClientRect();
            const rawWidth = event.clientX - rect.left;
            const minWidth = 220;
            const maxWidth = Math.min(420, rect.width - 260);
            const nextWidth = Math.max(minWidth, Math.min(maxWidth, rawWidth));
            setSidebarWidth(nextWidth);
        };
        const stopResize = () => setIsResizing(false);
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", stopResize);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", stopResize);
        };
    }, [isResizing]);

    useEffect(() => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
            return;
        }
        setSpeechSupported(true);
        const synth = window.speechSynthesis;
        const populateVoices = () => {
            const available = synth.getVoices();
            if (available.length > 0) {
                setVoices(available);
            }
        };
        populateVoices();
        synth.addEventListener("voiceschanged", populateVoices);
        return () => synth.removeEventListener("voiceschanged", populateVoices);
    }, []);

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

    const statusMessage = toast?.message ?? null;
    const statusClass = toast?.type === "error" ? "danger" : undefined;

    const renderedMessages: Message[] = messages;

    const transcript = useMemo(() => {
        if (!currentConversation) {
            return "";
        }
        return currentConversation.messages
            .map((entry) => {
                const speaker = entry.role === "assistant" ? "Assistant" : entry.role === "user" ? "You" : "System";
                return `${speaker}: ${entry.content}`;
            })
            .join(". ");
    }, [currentConversation]);

    useEffect(() => {
        if (!speechSupported) {
            return;
        }
        window.speechSynthesis.cancel();
        setIsNarratingConversation(false);
        setSpeakingMessageId(null);
    }, [currentConversation?.conversationId, speechSupported]);

    const pickVoice = useCallback(() => {
        if (voices.length === 0) {
            return null;
        }
        const hints = (voiceGender === "female" ? FEMALE_VOICE_HINTS : MALE_VOICE_HINTS).map((hint) =>
            hint.toLowerCase(),
        );
        const desired = voices.find((voice) => {
            const lower = voice.name.toLowerCase();
            return hints.some((hint) => lower.includes(hint));
        });
        if (desired) {
            return desired;
        }
        const englishFallback = voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
        return englishFallback ?? voices[0];
    }, [voices, voiceGender]);

    const handleSpeakTranscript = useCallback(() => {
        if (!speechSupported || typeof window === "undefined" || !window.speechSynthesis) {
            setToast({ type: "error", message: "Voice playback is not available in this browser." });
            return;
        }
        if (!transcript) {
            setToast({ type: "error", message: "There is no conversation to narrate yet." });
            return;
        }
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(transcript);
        const voice = pickVoice();
        if (voice) {
            utterance.voice = voice;
        }
        utterance.onend = () => {
            setIsNarratingConversation(false);
            setSpeakingMessageId(null);
        };
        utterance.onerror = () => {
            setIsNarratingConversation(false);
            setSpeakingMessageId(null);
        };
        setToast(null);
        setIsNarratingConversation(true);
        setSpeakingMessageId(null);
        synth.speak(utterance);
    }, [pickVoice, speechSupported, setToast, transcript]);

    const handleStopSpeaking = useCallback(() => {
        if (!speechSupported || typeof window === "undefined" || !window.speechSynthesis) {
            return;
        }
        window.speechSynthesis.cancel();
        setIsNarratingConversation(false);
        setSpeakingMessageId(null);
    }, [speechSupported]);

    const handleSpeakMessage = useCallback(
        (messageId: string, content: string) => {
            if (!speechSupported || typeof window === "undefined" || !window.speechSynthesis) {
                setToast({ type: "error", message: "Voice playback is not available in this browser." });
                return;
            }
            const trimmed = content.trim();
            if (!trimmed) {
                setToast({ type: "error", message: "Nothing to narrate for this reply yet." });
                return;
            }
            const synth = window.speechSynthesis;
            synth.cancel();
            const utterance = new SpeechSynthesisUtterance(trimmed);
            const voice = pickVoice();
            if (voice) {
                utterance.voice = voice;
            }
            utterance.onend = () => {
                setSpeakingMessageId(null);
                setIsNarratingConversation(false);
            };
            utterance.onerror = () => {
                setSpeakingMessageId(null);
                setIsNarratingConversation(false);
            };
            setToast(null);
            setIsNarratingConversation(false);
            setSpeakingMessageId(messageId);
            synth.speak(utterance);
        },
        [pickVoice, speechSupported, setToast],
    );

    const toggleTheme = useCallback(() => {
        setTheme((prev) => (prev === "light" ? "dark" : "light"));
    }, []);

    const isAnythingSpeaking = isNarratingConversation || speakingMessageId !== null;

    return (
        <>
            <div className="app-shell" ref={shellRef}>
                <div
                    className={clsx("sidebar-container", { collapsed: !isSidebarOpen })}
                    style={isSidebarOpen && !isCompactLayout ? { width: sidebarWidth } : undefined}
                    aria-hidden={!isSidebarOpen}
                >
                    {isSidebarOpen ? (
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
                    ) : null}
                </div>
                {!isCompactLayout && isSidebarOpen ? (
                    <div
                        className={clsx("sidebar-resizer", { dragging: isResizing })}
                        onMouseDown={handleResizerMouseDown}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize conversations panel"
                    />
                ) : null}
                <section className="chat-card">
                    {currentConversation ? (
                        <>
                            <div className="chat-top">
                                <header className="chat-header">
                                    <div className="chat-heading">
                                        <button
                                            type="button"
                                            className={clsx("icon-button", "sidebar-toggle", {
                                                active: isSidebarOpen === false,
                                            })}
                                            onClick={() => setIsSidebarOpen((prev) => !prev)}
                                            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                                            aria-pressed={!isSidebarOpen}
                                        >
                                            {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                                        </button>
                                        <div className="chat-title">
                                            <h1>{currentConversation.conversationId}</h1>
                                            {currentConversation.systemPrompt &&
                                                currentConversation.systemPrompt !== "You are a helpful assistant." ? (
                                                <p className="conversation-subtitle">{currentConversation.systemPrompt}</p>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="chat-tools">
                                        <span className="badge">
                                            <Sparkles size={16} />
                                            {currentConversation.messageCount} {currentConversation.messageCount === 1 ? "message" : "messages"}
                                        </span>
                                        <button
                                            type="button"
                                            className={clsx("icon-button", { active: showCalculator })}
                                            onClick={() => setShowCalculator((prev) => !prev)}
                                            aria-pressed={showCalculator}
                                            aria-label="Toggle calculator"
                                        >
                                            <Calculator size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            className="icon-button"
                                            onClick={toggleTheme}
                                            aria-label="Toggle theme"
                                        >
                                            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
                                        </button>
                                    </div>
                                </header>
                                {speechSupported ? (
                                    <div className="voice-controls">
                                        <div className="voice-choice">
                                            <span>Voice</span>
                                            <div className="voice-toggle">
                                                <button
                                                    type="button"
                                                    className={clsx("pill-button", { active: voiceGender === "female" })}
                                                    onClick={() => setVoiceGender("female")}
                                                >
                                                    Female
                                                </button>
                                                <button
                                                    type="button"
                                                    className={clsx("pill-button", { active: voiceGender === "male" })}
                                                    onClick={() => setVoiceGender("male")}
                                                >
                                                    Male
                                                </button>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="icon-button speak-button"
                                            onClick={isAnythingSpeaking ? handleStopSpeaking : handleSpeakTranscript}
                                            disabled={!transcript && !isAnythingSpeaking}
                                        >
                                            {isAnythingSpeaking ? <StopCircle size={18} /> : <Volume2 size={18} />}
                                            <span>{isAnythingSpeaking ? "Stop narration" : "Play narration"}</span>
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                            <div className="message-scroll">
                                {renderedMessages.length === 0 ? (
                                    <div className="empty-state">
                                        <Sparkles size={32} />
                                        <div>
                                            <h2>Say hello to your assistant</h2>
                                            <p>Send a message to kick-start the conversation.</p>
                                        </div>
                                    </div>
                                ) : (
                                    renderedMessages.map((message) => (
                                        <MessageBubble
                                            key={message.id}
                                            message={message}
                                            speechSupported={speechSupported}
                                            voiceGender={voiceGender}
                                            isSpeaking={speakingMessageId === message.id}
                                            onSpeak={() => handleSpeakMessage(message.id, message.content)}
                                            onStop={handleStopSpeaking}
                                        />
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
                                        {isLoading ? <Loader2 size={18} className="spin" /> : <SendHorizonal size={20} />}
                                        <span className="send-label">Send</span>
                                    </button>
                                </form>
                                {showCalculator ? <CalculatorPanel onClose={() => setShowCalculator(false)} /> : null}
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
