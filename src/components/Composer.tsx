/**
 * MYRAA — composer (message input).
 * Text input with send button; Enter sends, multiline preserved. Never fake:
 * sends {type:"text"} through the live voice client.
 */
import { useEffect, useRef, useState } from "react";

interface ComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
  onUserSpeechStarted: () => void;
}

export function Composer({ disabled, onSend, onUserSpeechStarted }: ComposerProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // TOPICS flyout prefills the composer via this window event.
  useEffect(() => {
    const onPrefill = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail) {
        setValue(detail);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("myraa:prefill", onPrefill);
    return () => window.removeEventListener("myraa:prefill", onPrefill);
  }, []);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <div className="pointer-events-auto w-full max-w-2xl">
      <div className="myraa-panel flex items-end gap-2 p-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={onUserSpeechStarted}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Type a message to MYRAA..."
          className="myraa-scroll max-h-28 min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600"
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          title="Send message"
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="m5 12 14 0" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
