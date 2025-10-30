import { FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { StoredUser } from "../types";
import { API_ROOT, GOOGLE_CLIENT_ID, OAUTH_MESSAGE_SOURCE } from "../config";

type ProviderKey = "google";

interface AuthDialogProps {
    open: boolean;
    onClose: () => void;
    onAuthenticate: (payload: {
        mode: "login" | "signup";
        email: string;
        password: string;
        name?: string | null;
    }) => Promise<void>;
    isSubmitting?: boolean;
    error?: string | null;
    onStayLoggedOut?: () => void;
    onProviderAuthenticated?: (provider: ProviderKey, user: StoredUser) => void;
}

const GoogleLogo = () => (
    <svg className="brand-google" viewBox="0 0 24 24" aria-hidden="true">
        <path
            fill="#4285F4"
            d="M23.5 12.275c0-.85-.075-1.7-.225-2.525H12v4.785h6.5c-.28 1.5-1.13 2.78-2.405 3.63v3h3.89c2.28-2.1 3.515-5.2 3.515-8.89z"
        />
        <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.065 7.945-2.905l-3.89-3c-1.08.735-2.47 1.17-4.055 1.17-3.12 0-5.765-2.105-6.71-4.935H1.28v3.095C3.255 21.305 7.29 24 12 24z"
        />
        <path
            fill="#FBBC05"
            d="M5.29 14.33c-.24-.735-.38-1.515-.38-2.33 0-.81.135-1.59.38-2.325V6.58H1.28A11.98 11.98 0 0 0 0 12c0 1.94.465 3.77 1.28 5.42z"
        />
        <path
            fill="#EA4335"
            d="M12 4.75c1.76 0 3.34.605 4.58 1.79l3.4-3.4C17.955 1.13 15.235 0 12 0 7.29 0 3.255 2.695 1.28 6.58l4.01 3.095C6.235 6.855 8.88 4.75 12 4.75z"
        />
    </svg>
);

export function AuthDialog({
    open,
    onClose,
    onAuthenticate,
    isSubmitting = false,
    error,
    onStayLoggedOut,
    onProviderAuthenticated,
}: AuthDialogProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [mode, setMode] = useState<"login" | "signup">("login");
    const [name, setName] = useState("");
    const [formError, setFormError] = useState<string | null>(null);
    const [providerBusy, setProviderBusy] = useState<ProviderKey | null>(null);
    const popupRef = useRef<Window | null>(null);
    const popupTimerRef = useRef<number | null>(null);

    const googleReady = Boolean(GOOGLE_CLIENT_ID);
    const disableForm = isSubmitting || providerBusy !== null;

    const clearPopupWatcher = () => {
        if (popupTimerRef.current !== null) {
            window.clearInterval(popupTimerRef.current);
            popupTimerRef.current = null;
        }
    };

    const closePopup = () => {
        clearPopupWatcher();
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
        }
        popupRef.current = null;
    };

    const monitorPopup = () => {
        clearPopupWatcher();
        popupTimerRef.current = window.setInterval(() => {
            if (!popupRef.current || popupRef.current.closed) {
                clearPopupWatcher();
                popupRef.current = null;
                setProviderBusy(null);
            }
        }, 400);
    };

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        setMode("login");
        setEmail("");
        setPassword("");
        setName("");
        setFormError(null);
        setProviderBusy(null);
        closePopup();
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [open, onClose]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handleMessage = (event: MessageEvent) => {
            if (typeof event.data !== "object" || event.data === null) {
                return;
            }
            const data = event.data as {
                source?: string;
                provider?: ProviderKey;
                success?: boolean;
                message?: string;
                error?: string;
                user?: Partial<StoredUser>;
            };
            if (data.source !== OAUTH_MESSAGE_SOURCE || data.provider !== "google") {
                return;
            }
            closePopup();
            setProviderBusy(null);
            if (data.success && data.user?.userId && data.user.email) {
                setFormError(null);
                onProviderAuthenticated?.("google", {
                    userId: data.user.userId,
                    email: data.user.email,
                    name: data.user.name ?? null,
                });
                return;
            }
            const detail = data.message || data.error || "Google sign-in failed. Please try again.";
            setFormError(detail);
            if (/sign up/i.test(detail)) {
                setMode("signup");
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [open, onProviderAuthenticated]);

    useEffect(() => () => closePopup(), []);

    if (!open) {
        return null;
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (disableForm) {
            return;
        }
        const trimmedEmail = email.trim();
        const trimmedPassword = password.trim();
        const trimmedName = name.trim();
        if (!trimmedEmail || !trimmedPassword) {
            setFormError("Email and password are required.");
            return;
        }
        if (mode === "signup" && trimmedPassword.length < 8) {
            setFormError("Password must be at least 8 characters long.");
            return;
        }
        setFormError(null);
        try {
            await onAuthenticate({
                mode,
                email: trimmedEmail,
                password: trimmedPassword,
                name: mode === "signup" ? trimmedName || null : null,
            });
        } catch (authError) {
            const message = authError instanceof Error ? authError.message : String(authError);
            setFormError(message);
            if (mode === "login" && /sign up/i.test(message)) {
                setMode("signup");
            }
        }
    };

    const handleGoogleSignIn = () => {
        if (!googleReady) {
            setFormError("Google sign-in is not configured yet.");
            return;
        }
        if (providerBusy || isSubmitting) {
            return;
        }
        setFormError(null);
        const width = 480;
        const height = 640;
        const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
        const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
        const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
        const popup = window.open(
            `${API_ROOT}/api/auth/oauth/google/start`,
            "convogpt_google_oauth",
            features,
        );
        if (!popup) {
            setFormError("Allow pop-ups to continue with Google.");
            setProviderBusy(null);
            return;
        }
        popupRef.current = popup;
        setProviderBusy("google");
        monitorPopup();
    };

    const providerPrefix = mode === "signup" ? "Sign up with" : "Continue with";
    const submitLabel = mode === "signup" ? "Create account" : "Log in";
    const passwordPlaceholder = mode === "signup" ? "Create a password" : "Enter your password";

    const handleStayLoggedOut = () => {
        if (disableForm) {
            return;
        }
        if (onStayLoggedOut) {
            onStayLoggedOut();
            return;
        }
        onClose();
    };

    const providerButtons = [
        {
            key: "google" as const,
            label: `${providerPrefix} Google`,
            onClick: handleGoogleSignIn,
            disabled: disableForm || !googleReady,
            icon: <GoogleLogo />,
            note: googleReady ? undefined : "Configure Google OAuth",
        },
    ];

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="modal-card auth-card" onClick={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    className="icon-button auth-close"
                    onClick={onClose}
                    aria-label="Close sign-in dialog"
                >
                    <X size={16} />
                </button>
                <div className="auth-header">
                    <h2>{mode === "login" ? "Log in" : "Sign up"}</h2>
                    <p>
                        {mode === "login"
                            ? "Choose a provider or use your email address to access your account."
                            : "Create a new account with a provider or your email address."}
                    </p>
                    <div className="auth-mode-toggle">
                        {mode === "login" ? (
                            <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                    setMode("signup");
                                    setFormError(null);
                                }}
                            >
                                New here? Sign up
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                    setMode("login");
                                    setFormError(null);
                                }}
                            >
                                Already have an account? Log in
                            </button>
                        )}
                    </div>
                </div>
                <div className="auth-provider-list">
                    {providerButtons.map((provider) => (
                        <button
                            key={provider.key}
                            type="button"
                            className="auth-provider-button"
                            onClick={provider.onClick}
                            disabled={provider.disabled}
                        >
                            <span className="provider-icon">{provider.icon}</span>
                            <span className="provider-label">{provider.label}</span>
                            {provider.note ? <span className="provider-note">{provider.note}</span> : null}
                        </button>
                    ))}
                </div>
                <div className="auth-divider">
                    <span>or use email and password</span>
                </div>
                <form className="auth-form" onSubmit={handleSubmit}>
                    <div className="input-field">
                        <label htmlFor="auth-email">Email address</label>
                        <input
                            id="auth-email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            required
                            disabled={disableForm}
                        />
                    </div>
                    {mode === "signup" ? (
                        <div className="input-field">
                            <label htmlFor="auth-name">Full name (optional)</label>
                            <input
                                id="auth-name"
                                type="text"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="Ada Lovelace"
                                disabled={disableForm}
                            />
                        </div>
                    ) : null}
                    <div className="input-field">
                        <label htmlFor="auth-password">Password</label>
                        <input
                            id="auth-password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder={passwordPlaceholder}
                            required
                            disabled={disableForm}
                        />
                    </div>
                    {formError ? <div className="status-bar danger">{formError}</div> : null}
                    {error && !formError ? <div className="status-bar danger">{error}</div> : null}
                    <button type="submit" className="auth-submit" disabled={disableForm}>
                        {disableForm ? "Please wait..." : submitLabel}
                    </button>
                </form>
                <button
                    type="button"
                    className="link-button auth-stay-logged-out"
                    onClick={handleStayLoggedOut}
                    disabled={disableForm}
                >
                    Stay logged out
                </button>
            </div>
        </div>
    );
}
