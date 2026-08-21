import { useState, useEffect, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileBottomNav } from "./MobileBottomNav";
import { HelpAssistantWidget } from "../HelpAssistantWidget";
import { FeedbackWidget } from "../FeedbackWidget";
import { SubscriptionBanner } from "../SubscriptionBanner";
import { SubscriptionWall } from "../SubscriptionWall";
import { WorkspaceModeProvider } from "../../contexts/WorkspaceModeContext";
import { api } from "../../lib/api";

export function MainLayout({ children }: { children: ReactNode }) {
  const [subState, setSubState] = useState<"ACTIVE" | "TRIAL" | "GRACE" | "EXPIRED" | null>(null);
  const [currentTier, setCurrentTier] = useState(1);

  useEffect(() => {
    api
      .get<{ state: "ACTIVE" | "TRIAL" | "GRACE" | "EXPIRED"; tier: number }>("/subscription/status")
      .then((r) => {
        setSubState(r.data.state);
        setCurrentTier(r.data.tier ?? 1);
      })
      .catch(() => setSubState("ACTIVE")); // default open if endpoint unavailable
  }, []);

  return (
    <WorkspaceModeProvider>
      <div className="flex h-screen overflow-hidden bg-secondary-50 dark:bg-secondary-950 transition-colors duration-200">
        {subState === "EXPIRED" && <SubscriptionWall currentTier={currentTier} />}
        <Sidebar />
        <div className="flex flex-col flex-1 w-0 overflow-hidden">
          <Header />
          <SubscriptionBanner />
          <main className="flex-1 relative z-0 overflow-y-auto focus:outline-none">
            {/* pb-20 on mobile leaves room above the fixed bottom nav bar */}
            <div className="py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full pb-20 md:pb-6">
              {children}
            </div>
          </main>
        </div>
        <HelpAssistantWidget />
        <FeedbackWidget />
        <MobileBottomNav />
      </div>
    </WorkspaceModeProvider>
  );
}
