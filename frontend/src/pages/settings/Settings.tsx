import { useState, useEffect } from "react";
import { Building2, Globe, Mail, Smartphone, Send, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

export function Settings() {
  const { user } = useAuth();
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

  const [smsData, setSmsData] = useState({
    ownerPhone: user?.phone || "",
    gatewayStatus: "Active & Managed (Included in Subscription)",
  });

  const [scheduleData, setScheduleData] = useState<{
    frequency: "Weekly" | "Monthly";
    recipients: string;
    enabled: boolean;
  }>({
    frequency: "Weekly",
    recipients: user?.email || "",
    enabled: false
  });

  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [testEmailMsg, setTestEmailMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "regional" | "sms" | "scheduled">("profile");

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
    if (user) {
      setSmsData((prev) => ({ ...prev, ownerPhone: user.phone || "" }));
      setScheduleData((prev) => ({ ...prev, recipients: user.email || "" }));
    }
  }, [settings, user]);

  // Load the tenant's actual persisted schedule (enabled/recipients), rather
  // than only ever showing the locally-seeded default.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/reports/schedule")
      .then((res) => {
        if (cancelled) return;
        const schedule = res.data?.data?.schedule;
        if (schedule) {
          setScheduleData((prev) => ({
            ...prev,
            enabled: Boolean(schedule.enabled),
            recipients: schedule.recipients?.[0] || prev.recipients,
            frequency: schedule.frequency === "Monthly" ? "Monthly" : "Weekly",
          }));
        }
      })
      .catch((err) => console.error("Failed to load schedule settings:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    try {
      await updateSettings(profileData);
      setSaveSuccessMsg("Workspace profile updated successfully.");
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegionalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    try {
      await updateSettings(regionalData);
      setSaveSuccessMsg("Regional settings updated successfully.");
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdatePhone = async () => {
    setSaveSuccessMsg(null);
    try {
      const res = await api.put("/auth/profile", { phone: smsData.ownerPhone });
      if (res.data.success) {
        setSaveSuccessMsg("✅ Owner alert mobile phone updated permanently in account DB.");
      }
    } catch (err: any) {
      setSaveSuccessMsg(`❌ Error saving phone: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleSaveSchedule = async () => {
    setSaveSuccessMsg(null);
    try {
      await api.put("/auth/profile", { email: scheduleData.recipients });
      const res = await api.post("/reports/schedule", {
        frequency: scheduleData.frequency,
        recipients: [scheduleData.recipients],
        reportType: "ProfitAndLoss",
        enabled: scheduleData.enabled,
      });
      if (res.data.success) {
        const cadence = scheduleData.frequency === "Monthly" ? "monthly" : "weekly";
        setSaveSuccessMsg(
          scheduleData.enabled
            ? `✅ Schedule saved - ${cadence} executive reports are now enabled for this address.`
            : `✅ Schedule saved - ${cadence} executive reports are disabled.`
        );
      }
    } catch (err: any) {
      setSaveSuccessMsg(`❌ Error saving schedule: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleTriggerTestEmail = async () => {
    setTestEmailMsg("Dispatching test executive email via Gmail SMTP...");
    try {
      const res = await api.post("/reports/schedule/test-email", {
        recipientEmail: scheduleData.recipients,
      });
      if (res.data.success) {
        setTestEmailMsg(`✅ Success: Test executive email dispatched to ${scheduleData.recipients}.`);
      } else {
        setTestEmailMsg("❌ Failed to send test email.");
      }
    } catch (err: any) {
      setTestEmailMsg(`❌ Error: ${err.message || "Failed to dispatch test email."}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-secondary-500">
        Loading preferences...
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Workspace Settings & Automation
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Manage workspace profile, currency, Android SMS shortage alerts, and automated weekly/monthly email reports.
        </p>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs flex items-center">
          <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
          {saveSuccessMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-secondary-200 dark:border-secondary-800 space-x-6">
        <button
          onClick={() => setActiveTab("profile")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "profile" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Building2 className="mr-2 h-4 w-4" />
          Organization Profile
        </button>
        <button
          onClick={() => setActiveTab("regional")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "regional" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Globe className="mr-2 h-4 w-4" />
          Currency & Regional
        </button>
        <button
          onClick={() => setActiveTab("sms")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "sms" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Smartphone className="mr-2 h-4 w-4 text-amber-500" />
          Android SMS Gateway
        </button>
        <button
          onClick={() => setActiveTab("scheduled")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "scheduled" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Mail className="mr-2 h-4 w-4 text-blue-500" />
          Email Reports
        </button>
      </div>

      {/* Profile Settings */}
      {activeTab === "profile" && (
        <form onSubmit={handleProfileSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Update your registered business name and slug.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Company Name</label>
                <Input
                  value={profileData.companyName}
                  onChange={(e) => setProfileData({ ...profileData, companyName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Workspace Slug</label>
                <Input
                  value={profileData.slug}
                  disabled
                  className="bg-secondary-100 dark:bg-secondary-800 opacity-60"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" variant="primary">Save Changes</Button>
            </CardFooter>
          </Card>
        </form>
      )}

      {/* Regional Settings */}
      {activeTab === "regional" && (
        <form onSubmit={handleRegionalSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Currency & Financial Preferences</CardTitle>
              <CardDescription>Configure primary operating currency for invoices, bills, and tills.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Base Currency</label>
                <select
                  value={regionalData.baseCurrency}
                  onChange={(e) => setRegionalData({ ...regionalData, baseCurrency: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-secondary-300 dark:border-secondary-700 bg-white dark:bg-secondary-900 text-sm"
                >
                  <option value="GHS">GHS - Ghanaian Cedi (GH₵)</option>
                  <option value="USD">USD - US Dollar ($)</option>
                  <option value="EUR">EUR - Euro (€)</option>
                  <option value="GBP">GBP - British Pound (£)</option>
                  <option value="NGN">NGN - Nigerian Naira (₦)</option>
                </select>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" variant="primary">Save Preferences</Button>
            </CardFooter>
          </Card>
        </form>
      )}

      {/* Platform-Managed SMS Warning Alerts Card */}
      {activeTab === "sms" && (
        <Card className="border-amber-200 bg-amber-50/20 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-300 flex items-center">
              <Smartphone className="mr-2 h-5 w-5 text-amber-600" />
              Platform-Managed SMS Shortage Alert Service
            </CardTitle>
            <CardDescription>
              Instant SMS shortage warnings are managed centrally by Ledgio and included in your subscription. You only need to maintain your alert phone number below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Target Owner Mobile Phone Number</label>
              <Input
                value={smsData.ownerPhone}
                onChange={(e) => setSmsData({ ...smsData, ownerPhone: e.target.value })}
                placeholder="+233201234567"
              />
              <p className="text-[11px] text-secondary-500">Instant cash till shortage SMS alerts will be sent to this mobile number.</p>
            </div>

            <div className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-amber-200 dark:border-amber-900/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Ledgio Gateway Service:</span>
                <strong className="text-emerald-600 font-bold">Active & Managed (Included in Subscription)</strong>
              </div>
              <div className="flex justify-between">
                <span>Shortage Template:</span>
                <em className="text-secondary-600">"Ledgio Alert: [Shop] till closed by [Staff]. Shortage: [Amount]. Please check."</em>
              </div>
            </div>

            {smsMsg && (
              <div className="p-2.5 bg-amber-100 text-amber-950 rounded text-xs">
                {smsMsg}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSmsMsg("Test shortage alert queued via Ledgio Gateway Service.")}
            >
              Test Shortage Alert
            </Button>
            <Button type="button" variant="primary" onClick={handleUpdatePhone}>
              Update Alert Mobile Number
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Platform-Managed Weekly/Monthly Email Reports Card */}
      {activeTab === "scheduled" && (
        <Card className="border-blue-200 bg-blue-50/20 dark:bg-blue-950/10">
          <CardHeader>
            <CardTitle className="text-blue-900 dark:text-blue-300 flex items-center">
              <Mail className="mr-2 h-5 w-5 text-blue-600" />
              Automated Email Report Service
            </CardTitle>
            <CardDescription>
              Executive Profit & Loss performance statements can be sent automatically on a weekly or monthly cadence - enable below and save to start receiving them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2 p-3 bg-white dark:bg-secondary-900 rounded-lg border border-blue-200 dark:border-blue-900/50 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleData.enabled}
                onChange={(e) => setScheduleData({ ...scheduleData, enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                Enable automated executive email reports
              </span>
            </label>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Recipient Email Address for Executive Reports</label>
              <Input
                value={scheduleData.recipients}
                onChange={(e) => setScheduleData({ ...scheduleData, recipients: e.target.value })}
                placeholder="owner@company.com"
              />
              <p className="text-[11px] text-secondary-500">
                {scheduleData.enabled
                  ? `Executive summaries will be delivered to this email address ${
                      scheduleData.frequency === "Monthly"
                        ? "on the 1st of every month"
                        : "every Monday morning"
                    }.`
                  : "Reports are currently disabled - enable the checkbox above and save to start receiving them."}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Report Frequency</label>
              <select
                value={scheduleData.frequency}
                onChange={(e) => setScheduleData({ ...scheduleData, frequency: e.target.value as "Weekly" | "Monthly" })}
                className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
              >
                <option value="Weekly">Weekly - every Monday at 8:00 AM UTC</option>
                <option value="Monthly">Monthly - the 1st of the month at 8:00 AM UTC</option>
              </select>
            </div>

            <div className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-blue-200 dark:border-blue-900/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Ledgio Mail Infrastructure:</span>
                <strong className="text-emerald-600">Active & Managed (Included in Subscription)</strong>
              </div>
            </div>

            {testEmailMsg && (
              <div className="p-2.5 bg-blue-100 text-blue-950 rounded text-xs">
                {testEmailMsg}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={handleTriggerTestEmail} className="flex items-center">
              <Send className="mr-2 h-4 w-4 text-blue-600" />
              Send Test Report Now
            </Button>
            <Button type="button" variant="primary" onClick={handleSaveSchedule}>
              Save Schedule Settings
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
