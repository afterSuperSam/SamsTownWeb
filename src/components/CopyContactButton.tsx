import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface CopyContactButtonProps {
  value: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
}

type CopyStatus = "idle" | "copied" | "failed";

export function CopyContactButton({ value, label, copiedLabel, failedLabel }: CopyContactButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<number | null>(null);
  const copyValue = value.trim();

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    if (!copyValue) return;
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);

    try {
      await navigator.clipboard.writeText(copyValue);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }

    resetTimer.current = window.setTimeout(() => {
      setStatus("idle");
      resetTimer.current = null;
    }, 1_800);
  };

  const feedback = status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label;

  return <button
    className={`button join-contact copy-contact${status === "copied" ? " is-copied" : ""}`}
    type="button"
    disabled={!copyValue}
    onClick={handleCopy}
    aria-label={feedback}
  >
    <span aria-live="polite" aria-atomic="true">{feedback}</span>
    {status === "copied" ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
  </button>;
}
