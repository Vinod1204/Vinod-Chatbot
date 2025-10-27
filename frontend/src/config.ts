export const API_ROOT = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const OAUTH_MESSAGE_SOURCE = "vinod-chatbot-oauth";
