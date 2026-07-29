import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Building2, FileText } from "lucide-react";
import { api } from "../../lib/api";

// The docs/*.md source files use a blockquote (> text) for one-off callouts
// (e.g. "Placeholder notice"). Styled distinctly so it reads as an aside,
// not part of the legal text itself.
const markdownComponents = {
  h1: (props: React.ComponentPropsWithoutRef<"h1">) => (
    <h1 className="text-xl font-bold text-white mt-8 mb-3 first:mt-0" {...props} />
  ),
  h2: (props: React.ComponentPropsWithoutRef<"h2">) => (
    <h2 className="text-lg font-bold text-white mt-8 mb-3 pb-2 border-b border-secondary-800" {...props} />
  ),
  h3: (props: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 className="text-base font-semibold text-white mt-6 mb-2" {...props} />
  ),
  p: (props: React.ComponentPropsWithoutRef<"p">) => (
    <p className="text-sm text-secondary-300 leading-relaxed mb-4" {...props} />
  ),
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="list-disc list-outside pl-5 space-y-1.5 mb-4 text-sm text-secondary-300" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="list-decimal list-outside pl-5 space-y-1.5 mb-4 text-sm text-secondary-300" {...props} />
  ),
  li: (props: React.ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed" {...props} />,
  strong: (props: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-white" {...props} />
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2" {...props} />
  ),
  blockquote: (props: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="border-l-2 border-amber-500/60 bg-amber-950/20 pl-4 py-2 my-4 text-xs text-amber-200/90 italic"
      {...props}
    />
  ),
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code className="px-1.5 py-0.5 rounded bg-secondary-800 text-emerald-300 text-xs font-mono" {...props} />
  ),
  hr: () => <hr className="border-secondary-800 my-8" />,
  table: (props: React.ComponentPropsWithoutRef<"table">) => (
    <div className="overflow-x-auto mb-4 rounded-lg border border-secondary-800">
      <table className="w-full text-xs text-left" {...props} />
    </div>
  ),
  thead: (props: React.ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-secondary-800/60 text-secondary-200 font-semibold" {...props} />
  ),
  th: (props: React.ComponentPropsWithoutRef<"th">) => <th className="px-3 py-2 border-b border-secondary-800" {...props} />,
  td: (props: React.ComponentPropsWithoutRef<"td">) => (
    <td className="px-3 py-2 border-b border-secondary-800/60 text-secondary-300 align-top" {...props} />
  ),
  tr: (props: React.ComponentPropsWithoutRef<"tr">) => <tr className="even:bg-secondary-900/40" {...props} />,
};

const POLICY_NAV: { policyName: string; label: string }[] = [
  { policyName: "terms-and-conditions", label: "Terms & Conditions" },
  { policyName: "privacy-policy", label: "Privacy Policy" },
  { policyName: "sla", label: "Service Level Agreement" },
  { policyName: "customization-policy", label: "Customization Tier Policy" },
];

export function LegalDocumentPage() {
  const { policyName } = useParams<{ policyName: string }>();
  const [title, setTitle] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setTitle(null);
    setContent(null);

    api
      .get(`/legal/${policyName}`)
      .then((res) => {
        if (cancelled) return;
        if (res.data.success) {
          setTitle(res.data.title);
          setContent(res.data.content);
        } else {
          setError("This legal document could not be loaded.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || "This legal document could not be found.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [policyName]);

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans">
      <header className="sticky top-0 z-40 border-b border-secondary-800/80 bg-secondary-950/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-tr from-emerald-600 to-blue-600 rounded-xl shadow-lg shadow-emerald-950">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tight text-white">Ledgio</span>
          </Link>
          <Link
            to="/#legal"
            className="inline-flex items-center text-xs font-semibold text-secondary-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to Trust Center
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <nav className="flex flex-wrap gap-2 mb-8">
          {POLICY_NAV.map((item) => (
            <Link
              key={item.policyName}
              to={`/legal/${item.policyName}`}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                item.policyName === policyName
                  ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                  : "border-secondary-800 text-secondary-400 hover:text-white hover:border-secondary-600"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center space-x-3 mb-6">
          <FileText className="h-5 w-5 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">{title || "Loading document..."}</h1>
        </div>

        {isLoading && (
          <div className="py-16 text-center text-sm text-secondary-500">Loading document...</div>
        )}

        {!isLoading && error && (
          <div className="p-6 bg-red-950/30 border border-red-900 rounded-xl text-sm text-red-300">{error}</div>
        )}

        {!isLoading && !error && content && (
          <div className="max-w-none bg-secondary-900 border border-secondary-800 rounded-xl p-6 sm:p-10">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
          </div>
        )}
      </main>
    </div>
  );
}
