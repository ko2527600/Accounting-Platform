import { useState, useEffect } from "react";
import { Building2, Globe, AlertTriangle, Mail } from "lucide-react";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

export function Settings() {
  const { settings, isLoading, updateSettings } = useTenantSettings();
  
  // Local state for forms to handle edits before saving
  const [profileData, setProfileData] = useState({
    companyName: settings.companyName,
    slug: settings.slug
  });
  
  const [regionalData, setRegionalData] = useState({
    baseCurrency: settings.baseCurrency,
    financialYearStart: settings.financialYearStart,
    timezone: settings.timezone
  });

  const [scheduleData, setScheduleData] = useState({
    frequency: "Weekly",
    recipients: "management@company.com",
    enabled: true
  });

  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "regional" | "scheduled" | "advanced">("profile");

  useEffect(() => {
    if (settings.companyName) {
      setProfileData({
        companyName: settings.companyName,
        slug: settings.slug,
      });
      setRegionalData({
        baseCurrency: settings.baseCurrency,
        financialYearStart: settings.financialYearStart,
        timezone: settings.timezone,
      });
    }
  }, [settings]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    await updateSettings(profileData);
    setSaveSuccessMsg("Company profile updated successfully!");
  };

  const handleRegionalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(regionalData);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Settings
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Manage your workspace profile and preferences.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Settings Navigation Sidebar */}
        <aside className="w-full md:w-64 flex-shrink-0">
          <nav className="flex md:flex-col space-x-2 md:space-x-0 md:space-y-1 overflow-x-auto pb-2 md:pb-0">
            <button
              onClick={() => setActiveTab("profile")}
              className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "profile" 
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" 
                  : "text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50"
              }`}
            >
              <Building2 className="flex-shrink-0 -ml-1 mr-3 h-5 w-5 opacity-70" />
              Company Profile
            </button>
            <button
              onClick={() => setActiveTab("regional")}
              className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "regional" 
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" 
                  : "text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50"
              }`}
            >
              <Globe className="flex-shrink-0 -ml-1 mr-3 h-5 w-5 opacity-70" />
              Regional Defaults
            </button>
            <button
              onClick={() => setActiveTab("scheduled")}
              className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "scheduled" 
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" 
                  : "text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50"
              }`}
            >
              <Mail className="flex-shrink-0 -ml-1 mr-3 h-5 w-5 opacity-70" />
              Scheduled Reports
            </button>
            <button
              onClick={() => setActiveTab("advanced")}
              className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "advanced" 
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" 
                  : "text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900 dark:text-secondary-400 dark:hover:bg-secondary-800 dark:hover:text-secondary-50"
              }`}
            >
              <AlertTriangle className="flex-shrink-0 -ml-1 mr-3 h-5 w-5 opacity-70" />
              Advanced
            </button>
          </nav>
        </aside>

        {/* Settings Content Area */}
        <main className="flex-1 min-w-0">
          {activeTab === "profile" && (
            <Card className="border-none shadow-md">
              <form onSubmit={handleProfileSubmit}>
                <CardHeader>
                  <CardTitle>Company Profile</CardTitle>
                  <CardDescription>
                    Update your workspace's primary public information.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {saveSuccessMsg && (
                    <div className="p-3 text-sm bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-300 rounded-md">
                      {saveSuccessMsg}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Company Name
                    </label>
                    <Input
                      value={profileData.companyName}
                      onChange={(e) => setProfileData({ ...profileData, companyName: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Workspace URL (Slug)
                    </label>
                    <div className="flex rounded-md shadow-sm">
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-secondary-300 bg-secondary-50 text-secondary-500 sm:text-sm dark:bg-secondary-800 dark:border-secondary-700">
                        accountgo.com/
                      </span>
                      <Input
                        className="rounded-l-none"
                        value={profileData.slug}
                        onChange={(e) => setProfileData({ ...profileData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '') })}
                        required
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="justify-end border-t border-secondary-100 dark:border-secondary-800 pt-6">
                  <Button type="submit" isLoading={isLoading}>Save Profile</Button>
                </CardFooter>
              </form>
            </Card>
          )}

          {activeTab === "regional" && (
            <Card className="border-none shadow-md">
              <form onSubmit={handleRegionalSubmit}>
                <CardHeader>
                  <CardTitle>Regional Defaults</CardTitle>
                  <CardDescription>
                    Configure currency and time preferences for reports and journals.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Base Currency
                    </label>
                    <select
                      value={regionalData.baseCurrency}
                      onChange={(e) => setRegionalData({ ...regionalData, baseCurrency: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
                    >
                      <option value="GHS">GHS - Ghanaian Cedi (GH₵)</option>
                      <option value="USD">USD - US Dollar ($)</option>
                      <option value="EUR">EUR - Euro (€)</option>
                      <option value="GBP">GBP - British Pound (£)</option>
                      <option value="NGN">NGN - Nigerian Naira (₦)</option>
                      <option value="KES">KES - Kenyan Shilling (KSh)</option>
                      <option value="ZAR">ZAR - South African Rand (R)</option>
                      <option value="JPY">JPY - Japanese Yen (¥)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Financial Year Start
                    </label>
                    <select
                      value={regionalData.financialYearStart}
                      onChange={(e) => setRegionalData({ ...regionalData, financialYearStart: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
                    >
                      <option value="01-01">January 1st</option>
                      <option value="04-01">April 1st</option>
                      <option value="07-01">July 1st</option>
                      <option value="10-01">October 1st</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Timezone
                    </label>
                    <Input
                      value={regionalData.timezone}
                      onChange={(e) => setRegionalData({ ...regionalData, timezone: e.target.value })}
                      placeholder="e.g. America/New_York"
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="justify-end border-t border-secondary-100 dark:border-secondary-800 pt-6">
                  <Button type="submit" isLoading={isLoading}>Save Regional Defaults</Button>
                </CardFooter>
              </form>
            </Card>
          )}

          {activeTab === "scheduled" && (
            <Card className="border-none shadow-md">
              <form onSubmit={async (e) => {
                e.preventDefault();
                setScheduleMsg(null);
                try {
                  const recipientsList = scheduleData.recipients.split(",").map(s => s.trim()).filter(Boolean);
                  const res = await api.post("/reports/schedule", {
                    frequency: scheduleData.frequency,
                    recipients: recipientsList,
                    enabled: scheduleData.enabled
                  });
                  if (res.data.success) {
                    setScheduleMsg("Scheduled report settings saved successfully!");
                  }
                } catch (err: any) {
                  alert(err.response?.data?.error || "Failed to save schedule.");
                }
              }}>
                <CardHeader>
                  <CardTitle>Scheduled Email Reports</CardTitle>
                  <CardDescription>
                    Automatically deliver PDF financial reports to stakeholders & management.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {scheduleMsg && (
                    <div className="p-3 text-sm bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-300 rounded-md">
                      {scheduleMsg}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Delivery Frequency
                    </label>
                    <select
                      value={scheduleData.frequency}
                      onChange={(e) => setScheduleData({ ...scheduleData, frequency: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
                    >
                      <option value="Daily">Daily Summary</option>
                      <option value="Weekly">Weekly Financial Pack (Mondays)</option>
                      <option value="Monthly">Monthly Financial Statements (1st of month)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                      Recipient Email Addresses (comma separated)
                    </label>
                    <Input
                      value={scheduleData.recipients}
                      onChange={(e) => setScheduleData({ ...scheduleData, recipients: e.target.value })}
                      placeholder="cfo@company.com, ceo@company.com"
                      required
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      type="checkbox"
                      id="enable-reports"
                      checked={scheduleData.enabled}
                      onChange={(e) => setScheduleData({ ...scheduleData, enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                    />
                    <label htmlFor="enable-reports" className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
                      Enable automated report delivery background service
                    </label>
                  </div>
                </CardContent>
                <CardFooter className="justify-end border-t border-secondary-100 dark:border-secondary-800 pt-6">
                  <Button type="submit">Save Report Schedule</Button>
                </CardFooter>
              </form>
            </Card>
          )}

          {activeTab === "advanced" && (
            <Card className="border-red-200 dark:border-red-900/50 shadow-md">
              <CardHeader>
                <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
                <CardDescription>
                  Destructive actions for this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-secondary-200 dark:border-secondary-800 rounded-lg">
                  <div>
                    <h4 className="text-sm font-medium text-secondary-900 dark:text-secondary-50">Purge Sandbox Data</h4>
                    <p className="text-sm text-secondary-500 mt-1">Permanently delete all journal entries.</p>
                  </div>
                  <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20">Purge Data</Button>
                </div>
                <div className="flex items-center justify-between p-4 border border-red-200 dark:border-red-900/30 rounded-lg bg-red-50/50 dark:bg-red-900/10">
                  <div>
                    <h4 className="text-sm font-medium text-red-900 dark:text-red-200">Delete Workspace</h4>
                    <p className="text-sm text-red-700 dark:text-red-400 mt-1">Permanently remove this workspace and all associated users.</p>
                  </div>
                  <Button variant="danger">Delete Workspace</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
