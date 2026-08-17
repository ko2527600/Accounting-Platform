import { useState } from "react";
import { MessageSquarePlus, X, Send, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../contexts/ToastContext";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "GENERAL", label: "General feedback" },
  { value: "BUG", label: "Report a bug" },
  { value: "FEATURE_REQUEST", label: "Feature request" },
];

// Mounted once in MainLayout.tsx so every role can reach it on every page -
// unlike the Admin/Auditor-only Feedback Inbox that reviews submissions,
// this send button has no role gate.
export function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState("GENERAL");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      await api.post("/feedback", { message: trimmed, category });
      showToast("Thanks! Your feedback was sent.", "success");
      setMessage("");
      setCategory("GENERAL");
      setIsOpen(false);
    } catch (err: any) {
      showToast(err.response?.data?.error || "Couldn't send feedback. Please try again.", "error");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-6 left-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-secondary-800 text-white shadow-lg hover:bg-secondary-900 transition-colors dark:bg-secondary-700 dark:hover:bg-secondary-600"
        title="Send Feedback"
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageSquarePlus className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 left-6 z-40 flex w-96 max-w-[calc(100vw-3rem)] flex-col rounded-xl border border-secondary-200 bg-white shadow-2xl dark:border-secondary-800 dark:bg-secondary-900">
          <div className="flex items-center justify-between border-b border-secondary-200 px-4 py-3 dark:border-secondary-800">
            <span className="font-semibold text-secondary-900 dark:text-secondary-50">Send Feedback</span>
            <button type="button" onClick={() => setIsOpen(false)} className="text-secondary-400 hover:text-secondary-600" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
            <label className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-800 dark:text-secondary-50"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
              Message
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what's on your mind..."
                rows={4}
                className="mt-1 block w-full resize-none rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-800 dark:text-secondary-50"
                disabled={isSending}
              />
            </label>

            <button
              type="submit"
              disabled={isSending || !message.trim()}
              className="flex h-9 items-center justify-center gap-2 rounded-md bg-primary-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-primary-700 transition-colors"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
