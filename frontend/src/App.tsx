import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Message, useChat } from "ai/react";
import {
    Calculator,
    Mic,
    MicOff,
    Loader2,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Settings2,
    SendHorizonal,
    Sparkles,
    Sun,
    Volume2,
    StopCircle,
    X,
} from "lucide-react";
import clsx from "clsx";
import {
    createConversation,
    deleteConversation,
    getConversation,
    listConversations,
    loginUser,
    signupUser,
} from "./api";
import type {
    ConversationDetail,
    ConversationSummary,
    CreateConversationPayload,
    StoredUser,
} from "./types";
import { loadStoredUser, saveStoredUser, clearStoredUser } from "./auth";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { MessageBubble } from "./components/MessageBubble";
import { CreateConversationDialog } from "./components/CreateConversationDialog";
import { CalculatorPanel } from "./components/CalculatorPanel";
import { AuthDialog } from "./components/AuthDialog";
import { API_ROOT } from "./config";
const API_BASE = API_ROOT;
const USER_ID_HEADER = "x-user-id";
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
    "victoria",
    "karen",
    "natalie",
    "linda",
    "siri",
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
    "alex",
    "fred",
    "daniel",
    "arthur",
    "george",
    "ralph",
    "henry",
];

type SpeechRecognitionInstance = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    abort?: () => void;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
};

type RecognitionConstructor = new () => SpeechRecognitionInstance;

const getSpeechRecognition = (): RecognitionConstructor | null => {
    if (typeof window === "undefined") {
        return null;
    }
    const globalWindow = window as Window & typeof globalThis & {
        SpeechRecognition?: RecognitionConstructor;
        webkitSpeechRecognition?: RecognitionConstructor;
    };
    return globalWindow.SpeechRecognition || globalWindow.webkitSpeechRecognition || null;
};

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
        title: detail.title,
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
    const [isUtilitiesOpen, setIsUtilitiesOpen] = useState(false);
    const [isVoiceSearchSupported, setIsVoiceSearchSupported] = useState(false);
    const [isVoiceSearching, setIsVoiceSearching] = useState(false);
    const [showAuthDialog, setShowAuthDialog] = useState(false);
    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
    const [authBusy, setAuthBusy] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
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
    const voiceSeedRef = useRef("");
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const voiceRetryRef = useRef<number | null>(null);

    const { messages, append, isLoading, setMessages, input, handleInputChange, setInput } = useChat({
        api: `${API_BASE}/api/chat`,
        sendExtraMessageFields: true,
        headers: () => (currentUser?.userId ? { [USER_ID_HEADER]: currentUser.userId } : {}),
    });

    useEffect(() => {
        const stored = loadStoredUser();
        if (stored) {
            setCurrentUser(stored);
        }
    }, []);

    useEffect(() => {
        if (showAuthDialog) {
            setAuthError(null);
        }
    }, [showAuthDialog]);

    const normaliseTitle = useCallback((value: string): string => {
        const normalized = value
            .trim()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ");
        if (!normalized) {
            return "";
        }
        return normalized
            .split(" ")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(" ");
    }, []);

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
        if (getSpeechRecognition()) {
            setIsVoiceSearchSupported(true);
        }
    }, []);

    useEffect(() => {
        if (isCompactLayout) {
            setIsResizing(false);
            setIsSidebarOpen(false);
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
        return () => {
            if (!recognitionRef.current) {
                return;
            }
            try {
                recognitionRef.current.stop();
            } catch (_error) {
                recognitionRef.current.abort?.();
            }
            recognitionRef.current = null;
        };
    }, []);

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
        const handleVoicesChanged = () => populateVoices();
        synth.addEventListener("voiceschanged", handleVoicesChanged);
        if (synth.getVoices().length === 0) {
            voiceRetryRef.current = window.setTimeout(populateVoices, 350);
        }
        return () => {
            synth.removeEventListener("voiceschanged", handleVoicesChanged);
            if (voiceRetryRef.current !== null) {
                window.clearTimeout(voiceRetryRef.current);
                voiceRetryRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        setIsUtilitiesOpen(false);
    }, [currentConversation?.conversationId]);

    const handleSelectConversation = useCallback(
        async (conversationId: string) => {
            setActiveConversationId(conversationId);
            setToast(null);
            if (isCompactLayout) {
                setIsSidebarOpen(false);
            }
            try {
                const detail = await getConversation(conversationId);
                setCurrentConversation(detail);
                setMessages(toMessages(detail));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setToast({ type: "error", message });
            }
        },
        [isCompactLayout, setMessages],
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
    }, [activeConversationId, handleSelectConversation, hasAutoPromptedCreate, currentUser?.userId]);

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

    const applyAuthenticatedUser = useCallback(
        async (user: StoredUser, successMessage: string) => {
            saveStoredUser(user);
            setCurrentUser(user);
            setActiveConversationId(null);
            setCurrentConversation(null);
            setMessages([]);
            setHasAutoPromptedCreate(false);
            setShowAuthDialog(false);
            setToast({ type: "success", message: successMessage });
            await refreshConversations();
        },
        [refreshConversations, setMessages],
    );

    const handleAuthentication = useCallback(
        async ({
            mode,
            email,
            password,
            name,
        }: {
            mode: "login" | "signup";
            email: string;
            password: string;
            name?: string | null;
        }) => {
            setAuthBusy(true);
            setAuthError(null);
            try {
                const normalisedEmail = email.trim().toLowerCase();
                const trimmedName = name?.trim() || null;
                const user =
                    mode === "signup"
                        ? await signupUser({ email: normalisedEmail, password, name: trimmedName })
                        : await loginUser({ email: normalisedEmail, password });
                const resolvedUser: StoredUser = {
                    userId: user.userId,
                    email: user.email,
                    name: user.name ?? trimmedName,
                };
                await applyAuthenticatedUser(
                    resolvedUser,
                    mode === "signup" ? "Account created." : "Signed in successfully.",
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setAuthError(message);
                throw error;
            } finally {
                setAuthBusy(false);
            }
        },
        [applyAuthenticatedUser],
    );

    const handleProviderAuthenticated = useCallback(
        async (
            provider: "google" | "microsoft" | "apple" | "phone",
            user: StoredUser,
        ) => {
            if (provider !== "google") {
                setAuthError("That sign-in option is not available yet.");
                return;
            }
            try {
                await applyAuthenticatedUser(user, "Signed in with Google.");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setAuthError(message);
            } finally {
                setAuthBusy(false);
            }
        },
        [applyAuthenticatedUser],
    );

    const handleLogout = useCallback(async () => {
        clearStoredUser();
        setCurrentUser(null);
        setShowAuthDialog(false);
        setAuthError(null);
        setActiveConversationId(null);
        setCurrentConversation(null);
        setMessages([]);
        setHasAutoPromptedCreate(false);
        await refreshConversations();
        setToast({ type: "success", message: "Signed out." });
    }, [refreshConversations, setMessages]);

    const handleCloseAuthDialog = useCallback(() => {
        if (authBusy) {
            return;
        }
        setShowAuthDialog(false);
        setAuthError(null);
    }, [authBusy]);

    const handleStayLoggedOutChoice = useCallback(() => {
        if (authBusy) {
            return;
        }
        clearStoredUser();
        setCurrentUser(null);
        setShowAuthDialog(false);
        setAuthError(null);
    }, [authBusy]);

    const handleShareConversation = useCallback(
        async (conversationId: string) => {
            const conversation = conversations.find((item) => item.conversationId === conversationId);
            const title = conversation?.title ?? conversationId;
            if (typeof window === "undefined") {
                setToast({ type: "error", message: "Sharing is not available." });
                return;
            }
            const shareUrl = `${window.location.origin}?conversation=${encodeURIComponent(conversationId)}`;
            const nav = window.navigator as Navigator & {
                share?: (data: ShareData) => Promise<void>;
                clipboard?: Clipboard;
            };
            try {
                if (nav.share) {
                    await nav.share({ title, text: title, url: shareUrl });
                    setToast({ type: "success", message: "Share link sent." });
                    return;
                }
                if (nav.clipboard?.writeText) {
                    await nav.clipboard.writeText(shareUrl);
                    setToast({ type: "success", message: "Link copied to clipboard." });
                    return;
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") {
                    setToast({ type: "error", message: "Share cancelled." });
                } else {
                    setToast({ type: "error", message: "Could not share the conversation." });
                }
                return;
            }
            setToast({ type: "error", message: "Sharing is not supported on this device." });
        },
        [conversations, setToast],
    );

    const handleSaveConversationAsPdf = useCallback(
        async (conversationId: string) => {
            if (typeof window === "undefined") {
                setToast({ type: "error", message: "Saving is only available in the browser." });
                return;
            }
            try {
                const detail =
                    currentConversation && currentConversation.conversationId === conversationId
                        ? currentConversation
                        : await getConversation(conversationId);
                if (!detail) {
                    setToast({ type: "error", message: "Conversation not found." });
                    return;
                }
                const iframe = document.createElement("iframe");
                iframe.style.position = "fixed";
                iframe.style.right = "0";
                iframe.style.bottom = "0";
                iframe.style.width = "0";
                iframe.style.height = "0";
                iframe.style.border = "0";
                document.body.appendChild(iframe);
                const frameWindow = iframe.contentWindow;
                const frameDocument = frameWindow?.document;
                if (!frameWindow || !frameDocument) {
                    iframe.remove();
                    setToast({ type: "error", message: "Could not prepare the PDF export." });
                    return;
                }
                const escapeHtml = (value: string) =>
                    value
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&#39;");
                const formatContent = (value: string) => escapeHtml(value).replace(/\n/g, "<br />");
                const title = detail.title || conversationId;
                const createdDisplay = new Date(detail.createdAt).toLocaleString();
                const updatedDisplay = new Date(detail.updatedAt).toLocaleString();
                const messageMarkup = detail.messages
                    .map((entry, index) => {
                        const role =
                            entry.role === "assistant" ? "Assistant" : entry.role === "user" ? "You" : "System";
                        const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : null;
                        return `
                            <article class="message">
                                <header>
                                    <span class="role">${escapeHtml(role)}</span>
                                    <span class="meta">${timestamp ? escapeHtml(timestamp) : ""}</span>
                                    <span class="index">#${index + 1}</span>
                                </header>
                                <div class="content">${formatContent(entry.content)}</div>
                            </article>
                        `;
                    })
                    .join("");
                const documentHtml = `<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)} - Chat Transcript</title>
        <style>
            body {
                font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                margin: 40px;
                color: #0f172a;
                background: #ffffff;
            }
            h1 {
                margin: 0 0 12px;
                font-size: 28px;
            }
            .meta {
                font-size: 12px;
                color: #475569;
            }
            .summary {
                margin-bottom: 24px;
                padding-bottom: 12px;
                border-bottom: 1px solid #e2e8f0;
            }
            .message {
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
                background: #f8fafc;
                break-inside: avoid;
            }
            .message header {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: #1e293b;
                margin-bottom: 10px;
            }
            .message .content {
                white-space: pre-wrap;
                font-size: 14px;
                line-height: 1.6;
                color: #0f172a;
            }
            .message .meta {
                font-size: 11px;
                color: #64748b;
                margin-left: 12px;
            }
            @page {
                margin: 25mm;
            }
        </style>
    </head>
    <body>
        <header class="summary">
            <h1>${escapeHtml(title)}</h1>
            <div class="meta">Conversation ID: ${escapeHtml(detail.conversationId)}</div>
            <div class="meta">Model: ${escapeHtml(detail.model)}</div>
            <div class="meta">Created: ${escapeHtml(createdDisplay)}</div>
            <div class="meta">Last updated: ${escapeHtml(updatedDisplay)}</div>
            <div class="meta">Total messages: ${detail.messageCount}</div>
        </header>
        <main>
            ${messageMarkup || "<p class=\"meta\">No messages yet.</p>"}
        </main>
    </body>
</html>`;
                frameDocument.open();
                frameDocument.write(documentHtml);
                frameDocument.close();
                let fallbackTimer: number | null = null;
                const cleanup = () => {
                    if (fallbackTimer !== null) {
                        window.clearTimeout(fallbackTimer);
                        fallbackTimer = null;
                    }
                    frameWindow.removeEventListener("afterprint", cleanup);
                    iframe.remove();
                };
                frameWindow.addEventListener("afterprint", cleanup);
                fallbackTimer = window.setTimeout(cleanup, 5000);
                frameWindow.focus();
                try {
                    frameWindow.print();
                    setToast({ type: "success", message: "Browser print dialog opened." });
                } catch (_error) {
                    cleanup();
                    setToast({ type: "error", message: "Unable to open the print dialog." });
                }
            } catch (_error) {
                setToast({ type: "error", message: "Could not prepare the PDF export." });
            }
        },
        [currentConversation, setToast],
    );

    const startVoiceSearch = useCallback(() => {
        const Recognition = getSpeechRecognition();
        if (!Recognition) {
            setToast({ type: "error", message: "Voice search is not available on this device." });
            return;
        }
        voiceSeedRef.current = input.trim();
        try {
            const recognition = new Recognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
            recognition.maxAlternatives = 1;
            recognition.onresult = (event: any) => {
                const transcript = Array.from(event.results || [])
                    .map((result: any) => (result[0]?.transcript ?? "").trim())
                    .join(" ")
                    .trim();
                const prefix = voiceSeedRef.current;
                const nextValue = `${prefix}${prefix ? " " : ""}${transcript}`.trim();
                setInput(nextValue);
            };
            recognition.onerror = () => {
                setIsVoiceSearching(false);
                setToast({ type: "error", message: "Could not capture audio. Please try again." });
            };
            recognition.onend = () => {
                setIsVoiceSearching(false);
                recognitionRef.current = null;
            };
            recognitionRef.current = recognition;
            recognition.start();
            setIsVoiceSearching(true);
            setToast(null);
        } catch (_error) {
            setIsVoiceSearching(false);
            setToast({ type: "error", message: "Voice search could not start." });
        }
    }, [input, setInput, setToast]);

    const stopVoiceSearch = useCallback(() => {
        const recognition = recognitionRef.current;
        if (!recognition) {
            return;
        }
        try {
            recognition.stop();
        } catch (_error) {
            recognition.abort?.();
        }
        setIsVoiceSearching(false);
    }, []);

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
            if (isVoiceSearching) {
                stopVoiceSearch();
            }
            setToast(null);
            try {
                await append(
                    { role: "user", content: trimmed },
                    {
                        body: {
                            conversationId: activeConversationId,
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
        [activeConversationId, append, input, isVoiceSearching, setInput, setMessages, stopVoiceSearch],
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
                const speaker = entry.role === "assistant" ? "AI" : entry.role === "user" ? "You" : "System";
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
            const uri = (voice as SpeechSynthesisVoice & { voiceURI?: string }).voiceURI?.toLowerCase() ?? "";
            return hints.some((hint) => lower.includes(hint) || uri.includes(hint));
        });
        if (desired) {
            return desired;
        }
        const genderFallback = voices.find((voice) => {
            const lower = voice.name.toLowerCase();
            const uri = (voice as SpeechSynthesisVoice & { voiceURI?: string }).voiceURI?.toLowerCase() ?? "";
            if (voiceGender === "male") {
                return lower.includes("male") || uri.includes("male");
            }
            return lower.includes("female") || uri.includes("female");
        });
        if (genderFallback) {
            return genderFallback;
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
        <div className="app-page">
            <header className="top-bar">
                {currentUser ? (
                    <div className="auth-status">
                        <span className="auth-identity" aria-live="polite">
                            {currentUser.name ? `${currentUser.name} · ${currentUser.email}` : currentUser.email}
                        </span>
                        <button
                            type="button"
                            className="auth-trigger"
                            onClick={() => {
                                void handleLogout();
                            }}
                        >
                            Log out
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="auth-trigger"
                        onClick={() => {
                            setAuthError(null);
                            setShowAuthDialog(true);
                        }}
                        aria-haspopup="dialog"
                        aria-expanded={showAuthDialog}
                    >
                        Log in
                    </button>
                )}
            </header>
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
                            onShare={(id) => {
                                void handleShareConversation(id);
                            }}
                            onSaveAsPdf={(id) => {
                                void handleSaveConversationAsPdf(id);
                            }}
                            formatTitle={normaliseTitle}
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
                    {isUtilitiesOpen ? (
                        <aside className="utility-panel" role="complementary" aria-label="Conversation tools">
                            <div className="utility-header">
                                <h2>Quick tools</h2>
                                <button
                                    type="button"
                                    className="icon-button"
                                    onClick={() => setIsUtilitiesOpen(false)}
                                    aria-label="Close tools"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="utility-section">
                                <h3>Appearance</h3>
                                <button
                                    type="button"
                                    className="icon-button"
                                    onClick={toggleTheme}
                                    aria-label="Toggle theme"
                                >
                                    {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
                                    <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
                                </button>
                            </div>
                            <div className="utility-section">
                                <h3>Tools</h3>
                                <button
                                    type="button"
                                    className={clsx("icon-button", { active: showCalculator })}
                                    onClick={() => setShowCalculator((prev) => !prev)}
                                    aria-label="Toggle calculator"
                                    aria-pressed={showCalculator}
                                >
                                    <Calculator size={18} />
                                    <span>{showCalculator ? "Hide calculator" : "Show calculator"}</span>
                                </button>
                            </div>
                            {speechSupported ? (
                                <div className="utility-section">
                                    <h3>Voice</h3>
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
                            {currentConversation ? (
                                <div className="utility-section utility-meta">
                                    <h3>Conversation</h3>
                                    <dl>
                                        <div>
                                            <dt>ID</dt>
                                            <dd>{currentConversation.conversationId}</dd>
                                        </div>
                                        <div>
                                            <dt>Total messages</dt>
                                            <dd>{currentConversation.messageCount}</dd>
                                        </div>
                                    </dl>
                                </div>
                            ) : null}
                        </aside>
                    ) : null}
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
                                            <h1>{normaliseTitle(currentConversation.title)}</h1>
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
                                            className={clsx("icon-button", { active: isUtilitiesOpen })}
                                            onClick={() => setIsUtilitiesOpen((prev) => !prev)}
                                            aria-label={isUtilitiesOpen ? "Hide tools" : "Show tools"}
                                            aria-pressed={isUtilitiesOpen}
                                        >
                                            <Settings2 size={18} />
                                            <span>Tools</span>
                                        </button>
                                    </div>
                                </header>

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
                                    <div className="composer-input">
                                        <textarea
                                            value={input}
                                            onChange={handleInputChange}
                                            placeholder="Ask a question or describe a task..."
                                            disabled={!activeConversationId || isLoading}
                                            aria-label="Message"
                                        />
                                        {isVoiceSearchSupported ? (
                                            <button
                                                type="button"
                                                className={clsx("icon-button", "voice-search-button", {
                                                    active: isVoiceSearching,
                                                })}
                                                onClick={() => {
                                                    if (isVoiceSearching) {
                                                        stopVoiceSearch();
                                                    } else {
                                                        startVoiceSearch();
                                                    }
                                                }}
                                                aria-pressed={isVoiceSearching}
                                                aria-label={isVoiceSearching ? "Stop voice search" : "Start voice search"}
                                                disabled={!activeConversationId || isLoading}
                                            >
                                                {isVoiceSearching ? <MicOff size={18} /> : <Mic size={18} />}
                                            </button>
                                        ) : null}
                                    </div>
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
                error={createError}
            />
            <AuthDialog
                open={showAuthDialog}
                onClose={handleCloseAuthDialog}
                onAuthenticate={handleAuthentication}
                isSubmitting={authBusy}
                error={authError}
                onStayLoggedOut={handleStayLoggedOutChoice}
                onProviderAuthenticated={handleProviderAuthenticated}
            />
        </div>
    );
}
