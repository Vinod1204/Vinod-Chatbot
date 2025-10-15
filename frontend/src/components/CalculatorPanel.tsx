import { useState } from "react";

const sanitizeExpression = (value: string): string => value.replace(/[^0-9+\-*/().]/g, "");

const evaluateExpression = (expression: string): string => {
    try {
        const clean = sanitizeExpression(expression);
        if (!clean) {
            return "0";
        }
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${clean});`)();
        if (typeof result === "number" && Number.isFinite(result)) {
            return result.toString();
        }
    } catch (_error) {
        /* swallow and fall through */
    }
    return "Error";
};

type CalculatorPanelProps = {
    onClose: () => void;
};

export function CalculatorPanel({ onClose }: CalculatorPanelProps) {
    const [expression, setExpression] = useState("0");

    const handleInput = (value: string) => {
        setExpression((prev) => {
            if ((prev === "0" || prev === "Error") && /^[0-9.]$/.test(value)) {
                return value;
            }
            if (value === "C") {
                return "0";
            }
            if (value === "⌫") {
                const next = prev.slice(0, -1);
                return next.length > 0 ? next : "0";
            }
            if (value === "=") {
                return evaluateExpression(prev);
            }
            return `${prev}${value}`;
        });
    };

    const keypad: string[][] = [
        ["7", "8", "9", "⌫"],
        ["4", "5", "6", "/"],
        ["1", "2", "3", "*"],
        ["0", ".", "-", "+"],
    ];

    return (
        <div className="calculator-panel" role="dialog" aria-label="Virtual calculator">
            <div className="calculator-display">{expression}</div>
            <div className="calculator-keypad">
                {keypad.flat().map((symbol) => (
                    <button
                        key={symbol}
                        type="button"
                        onClick={() => handleInput(symbol)}
                        className="calculator-key"
                    >
                        {symbol}
                    </button>
                ))}
                <button type="button" className="calculator-key wide" onClick={() => handleInput("C")}>
                    C
                </button>
                <button type="button" className="calculator-key wide" onClick={() => handleInput("=")}>
                    =
                </button>
                <button type="button" className="calculator-key secondary" onClick={onClose}>
                    Close
                </button>
            </div>
        </div>
    );
}
