import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Send, Trash2, X } from "lucide-react";

export type BugReportPayload = {
    description: string;
    files: File[];
    contactEmail?: string | null;
};

type BugReportDialogProps = {
    open: boolean;
    onClose: () => void;
    onSubmit: (payload: BugReportPayload) => void;
    isSubmitting?: boolean;
    error?: string | null;
    defaultContactEmail?: string | null;
};

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;

const formatFileSize = (bytes: number): string => {
    if (bytes <= 0) {
        return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
};

export function BugReportDialog({
    open,
    onClose,
    onSubmit,
    isSubmitting = false,
    error,
    defaultContactEmail,
}: BugReportDialogProps) {
    const [description, setDescription] = useState("");
    const [contactEmail, setContactEmail] = useState(defaultContactEmail ?? "");
    const [files, setFiles] = useState<File[]>([]);
    const [localError, setLocalError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        setDescription("");
        setFiles([]);
        setLocalError(null);
        setContactEmail(defaultContactEmail ?? "");
    }, [open, defaultContactEmail]);

    const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

    if (!open) {
        return null;
    }

    const handleSelectFiles = (selectedFiles: File[]) => {
        if (selectedFiles.length === 0) {
            return;
        }

        const incomingTotal = selectedFiles.reduce((sum, file) => sum + file.size, 0);

        if (selectedFiles.length + files.length > MAX_ATTACHMENTS) {
            setLocalError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
            return;
        }

        if (selectedFiles.some((file) => file.size > MAX_FILE_SIZE)) {
            setLocalError(`Each attachment must be under ${MAX_FILE_SIZE / (1024 * 1024)} MB.`);
            return;
        }

        if (totalSize + incomingTotal > MAX_TOTAL_SIZE) {
            setLocalError(`Attachments exceed the ${MAX_TOTAL_SIZE / (1024 * 1024)} MB total limit.`);
            return;
        }

        const nextFiles = [...files, ...selectedFiles];
        setFiles(nextFiles);
        setLocalError(null);
    };

    const handleFileChange = (event: FormEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        const selected = Array.from(input.files ?? []);
        handleSelectFiles(selected);
        input.value = "";
    };

    const handleRemoveFile = (index: number) => {
        setFiles((prev) => prev.filter((_, idx) => idx !== index));
        setLocalError(null);
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const trimmedDescription = description.trim();
        if (!trimmedDescription) {
            setLocalError("Please describe what went wrong so we can investigate.");
            return;
        }

        if (files.length > MAX_ATTACHMENTS) {
            setLocalError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
            return;
        }

        if (files.some((file) => file.size > MAX_FILE_SIZE)) {
            setLocalError(`Each attachment must be under ${MAX_FILE_SIZE / (1024 * 1024)} MB.`);
            return;
        }

        if (totalSize > MAX_TOTAL_SIZE) {
            setLocalError(`Attachments exceed the ${MAX_TOTAL_SIZE / (1024 * 1024)} MB total limit.`);
            return;
        }

        const email = contactEmail.trim() || undefined;
        setLocalError(null);
        onSubmit({ description: trimmedDescription, files, contactEmail: email });
    };

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => !isSubmitting && onClose()}>
            <div className="modal-card bug-report-card" onClick={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    className="icon-button bug-report-close"
                    onClick={onClose}
                    aria-label="Close bug report dialog"
                    disabled={isSubmitting}
                >
                    <X size={16} />
                </button>
                <div className="bug-report-header">
                    <h2>Found a glitch?</h2>
                    <p>Give us a quick rundown and attach a visual if you have one.</p>
                </div>
                <form className="bug-report-body" onSubmit={handleSubmit}>
                    <div className="input-field">
                        <label htmlFor="bug-description">Describe the issue</label>
                        <textarea
                            id="bug-description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="What went wrong and what were you expecting instead?"
                            rows={6}
                            required
                            disabled={isSubmitting}
                        />
                    </div>
                    <div className="input-field">
                        <label htmlFor="bug-contact">Email (optional)</label>
                        <input
                            id="bug-contact"
                            type="email"
                            value={contactEmail}
                            onChange={(event) => setContactEmail(event.target.value)}
                            placeholder="We’ll reach out if we need more details"
                            disabled={isSubmitting}
                        />
                    </div>
                    <div className="bug-report-attachments">
                        <div className="bug-report-attachments-header">
                            <span>Screenshots (optional)</span>
                            <span className="bug-report-hint">
                                Up to {MAX_ATTACHMENTS} images · {MAX_FILE_SIZE / (1024 * 1024)} MB each
                            </span>
                        </div>
                        <div className="bug-report-dropzone">
                            <button
                                type="button"
                                className="bug-report-upload-button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isSubmitting}
                            >
                                <ImagePlus size={18} />
                                <span>Upload images</span>
                            </button>
                            <p>or drag & drop files here</p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="bug-report-file-input"
                                onChange={handleFileChange}
                                disabled={isSubmitting}
                                aria-label="Add screenshots"
                            />
                        </div>
                        {files.length > 0 ? (
                            <ul className="bug-report-file-list">
                                {files.map((file, index) => (
                                    <li key={`${file.name}-${index}`} className="bug-report-file-item">
                                        <div className="bug-report-file-meta">
                                            <span className="file-name">{file.name}</span>
                                            <span className="file-size">{formatFileSize(file.size)}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className="icon-button"
                                            onClick={() => handleRemoveFile(index)}
                                            disabled={isSubmitting}
                                            aria-label={`Remove ${file.name}`}
                                        >
                                            <Trash2 size={16} />
                                            <span>Remove</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        {files.length > 0 ? (
                            <div className="bug-report-file-summary">
                                <span>{files.length === 1 ? "1 file" : `${files.length} files`}</span>
                                <span>{formatFileSize(totalSize)} total</span>
                            </div>
                        ) : null}
                    </div>
                    {localError || error ? <div className="bug-report-error">{localError || error}</div> : null}
                    <div className="modal-actions">
                        <button type="button" className="secondary-button" onClick={onClose} disabled={isSubmitting}>
                            Cancel
                        </button>
                        <button type="submit" className="primary-button" disabled={isSubmitting}>
                            <Send size={16} />
                            <span>{isSubmitting ? "Sending..." : "Send report"}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

