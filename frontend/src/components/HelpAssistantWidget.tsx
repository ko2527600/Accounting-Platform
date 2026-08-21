import { useState, useRef, useEffect, useCallback } from "react";
import { HelpCircle, X, Send, Loader2 } from "lucide-react";
import { api } from "../lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Mounted once in MainLayout.tsx so it's available on every authenticated
// page. Read-only by design - the backend's tools only ever look things up
// through the same authenticated endpoints the rest of the UI uses (see
// helpAssistantService.ts), so this can never do anything the logged-in
// user couldn't already do or see themselves.
export function HelpAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && configured === null) {
      api
        .get("/help-assistant/status")
        .then((res) => setConfigured(Boolean(res.data?.data?.configured)))
        .catch(() => setConfigured(false));
    }
  }, [isOpen, configured]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  // Move focus into panel when it opens; restore to FAB when it closes.
  const fabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    } else {
      fabRef.current?.focus();
    }
  }, [isOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  // Focus trap: cycle Tab/Shift+Tab within the panel.
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;
    setInput("");
    const priorMessages = messages;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsSending(true);
    try {
      const res = await api.post("/help-assistant/chat", { message: text, history: priorMessages });
      if (res.data.success) {
        setMessages(res.data.data.history);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err.response?.data?.error || "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close help panel" : "Open help panel"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg hover:bg-primary-700 transition-colors"
      >
        {isOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <HelpCircle className="h-6 w-6" aria-hidden="true" />}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-panel-title"
          onKeyDown={handlePanelKeyDown}
          className="fixed bottom-24 right-6 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col rounded-xl border border-secondary-200 bg-white shadow-2xl dark:border-secondary-800 dark:bg-secondary-900"
        >
          <div className="flex items-center justify-between border-b border-secondary-200 px-4 py-3 dark:border-secondary-800">
            <h2 id="help-panel-title" className="font-semibold text-secondary-900 dark:text-secondary-50">Ledgio Help</h2>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close help panel"
              className="text-secondary-400 hover:text-secondary-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
            aria-live="polite"
            aria-atomic="false"
          >
            {configured === false ? (
              <p className="text-sm text-secondary-500">
                Help Assistant isn't set up for this workspace yet. Contact your administrator.
              </p>
            ) : (
              <>
                <ChatBubble role="assistant" content="Hi, what can I help you with today?" />
                {messages.map((m, i) => (
                  <ChatBubble key={i} role={m.role} content={m.content} />
                ))}
                {isSending && (
                  <div className="flex items-center gap-2 text-xs text-secondary-400">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Thinking...
                  </div>
                )}
              </>
            )}
          </div>

          {configured !== false && (
            <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-secondary-200 p-3 dark:border-secondary-800">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                className="flex-1 h-9 rounded-md border border-secondary-300 bg-white px-3 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-800 dark:text-secondary-50"
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary-600 text-white disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

function ChatBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-primary-600 text-white"
            : "bg-secondary-100 text-secondary-900 dark:bg-secondary-800 dark:text-secondary-50"
        }`}
      >
        {content}
      </div>
    </div>
  );
}
