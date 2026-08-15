import { useState, useRef, useEffect } from "react";
import { HelpCircle, X, Send, Loader2 } from "lucide-react";
import { api } from "../lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg hover:bg-primary-700 transition-colors"
        title="Help"
      >
        {isOpen ? <X className="h-6 w-6" /> : <HelpCircle className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col rounded-xl border border-secondary-200 bg-white shadow-2xl dark:border-secondary-800 dark:bg-secondary-900">
          <div className="flex items-center justify-between border-b border-secondary-200 px-4 py-3 dark:border-secondary-800">
            <span className="font-semibold text-secondary-900 dark:text-secondary-50">Ledgio Help</span>
            <button type="button" onClick={() => setIsOpen(false)} className="text-secondary-400 hover:text-secondary-600" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
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
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
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
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary-600 text-white disabled:opacity-50"
                title="Send"
              >
                <Send className="h-4 w-4" />
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
