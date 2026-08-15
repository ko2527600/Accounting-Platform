import { Lock } from "lucide-react";
import { Card, CardContent } from "./ui/Card";
import { TIER_NAMES, type TenantTier } from "../types/tenant";

interface UpgradeRequiredProps {
  featureLabel: string;
  requiredTier: TenantTier;
  currentTier: TenantTier;
}

// Shown instead of a gated page's real content when the tenant's plan
// doesn't meet the feature's minimum tier - see requireTier() in
// backend/src/middleware/tierEnforcementMiddleware.ts, the source of truth
// this mirrors. No self-serve upgrade button yet (no billing integration) -
// upgrading is a platform-admin action for now, so this points the user at
// support rather than a payment flow that doesn't exist.
export function UpgradeRequired({ featureLabel, requiredTier, currentTier }: UpgradeRequiredProps) {
  return (
    <Card className="max-w-lg mx-auto mt-12">
      <CardContent className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <Lock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-secondary-900 dark:text-secondary-50">
          {featureLabel} requires the {TIER_NAMES[requiredTier]} plan
        </h2>
        <p className="mt-2 text-sm text-secondary-500 dark:text-secondary-400">
          Your business is currently on the {TIER_NAMES[currentTier]} plan. Upgrading unlocks {featureLabel.toLowerCase()}
          {" "}and everything else on the {TIER_NAMES[requiredTier]} plan, with all your existing data carried over exactly as it is.
        </p>
        <p className="mt-4 text-xs text-secondary-400 dark:text-secondary-500">
          Contact support to upgrade your plan.
        </p>
      </CardContent>
    </Card>
  );
}
