import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2 } from "lucide-react";

interface AuthSplitLayoutProps {
  imageSrc: string;
  imageAlt: string;
  tagline: string;
  children: ReactNode;
}

export function AuthSplitLayout({ imageSrc, imageAlt, tagline, children }: AuthSplitLayoutProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden bg-secondary-950">
        <img src={imageSrc} alt={imageAlt} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-secondary-950 via-secondary-950/70 to-secondary-950/30" />

        <Link to="/" className="relative z-10 flex items-center space-x-3">
          <div className="p-2.5 bg-gradient-to-tr from-emerald-600 to-blue-600 rounded-xl shadow-lg shadow-emerald-950">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <span className="text-2xl font-black tracking-tight text-white">
            Ledg<span className="text-emerald-400">io</span>
          </span>
        </Link>

        <p className="relative z-10 text-xl font-semibold text-white max-w-md leading-snug">
          {tagline}
        </p>
      </div>

      <div className="flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-16 bg-secondary-50 dark:bg-secondary-950 transition-colors">
        {children}
      </div>
    </div>
  );
}
