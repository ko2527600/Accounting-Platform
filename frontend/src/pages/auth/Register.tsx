import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api";
import { FileText } from "lucide-react";
import { AuthSplitLayout } from "../../components/layout/AuthSplitLayout";

export function Register() {
  const [step, setStep] = useState<"account" | "tenant">("account");
  const [formData, setFormData] = useState({
    adminName: "",
    email: "",
    phone: "",
    password: "",
    tenantName: "",
    tenantSlug: "",
    baseCurrency: "GHS",
    orgType: "BUSINESS"
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [activeLegalDoc, setActiveLegalDoc] = useState<"terms-and-conditions" | "privacy-policy">("terms-and-conditions");
  const [legalDocContent, setLegalDocContent] = useState<Record<string, string>>({});
  const [isLegalDocLoading, setIsLegalDocLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login } = useAuth();

  const fetchLegalDoc = async (policyName: "terms-and-conditions" | "privacy-policy") => {
    setActiveLegalDoc(policyName);
    setIsTermsModalOpen(true);
    if (!legalDocContent[policyName]) {
      setIsLegalDocLoading(true);
      try {
        const res = await api.get(`/legal/${policyName}`);
        if (res.data.success) {
          setLegalDocContent((prev) => ({ ...prev, [policyName]: res.data.content }));
        }
      } catch (err) {
        setLegalDocContent((prev) => ({
          ...prev,
          [policyName]: policyName === "terms-and-conditions"
            ? "Failed to load Terms and Conditions. Please try again."
            : "Failed to load Privacy Policy. Please try again.",
        }));
      } finally {
        setIsLegalDocLoading(false);
      }
    }
  };

  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.email || !formData.password || !formData.adminName || !formData.phone || !formData.tenantName) {
      setError("Please fill in all required fields.");
      return;
    }
    setStep("tenant");
  };

  const handleTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.tenantName) return;
    
    if (!termsAccepted) {
      setError("You must accept the Terms and Conditions to onboard your business workspace.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await api.post("/tenants/onboard", {
        companyName: formData.tenantName,
        slug: formData.tenantSlug,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        adminName: formData.adminName,
        baseCurrency: formData.baseCurrency,
        orgType: formData.orgType,
        termsAccepted: true,
        acceptedTermsVersion: "v1.0",
      });

      if (response.data.success) {
        const { token, admin, tenant } = response.data.data;
        const userObj = {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          tenantId: tenant.id,
          orgType: tenant.orgType,
        };

        login(token, userObj);
        navigate(`/verify-account?email=${encodeURIComponent(formData.email)}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to onboard business workspace.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      imageSrc="/auth/register-panel.jpg"
      imageAlt="3D data analytics illustration with charts and graphs"
      tagline="Set up your isolated workspace in minutes - invoicing, mobile money, team roles, and nonprofit fund accounting, all included."
    >
      <div className="sm:mx-auto sm:w-full sm:max-w-md mb-8 text-center">
        <h1 className="text-3xl font-extrabold text-primary-600 dark:text-primary-500 tracking-tight lg:hidden">
          Ledgio
        </h1>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Onboard Your Business Workspace
        </h2>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="border-none shadow-xl sm:rounded-2xl">
          <CardHeader>
            <CardTitle>{step === "account" ? "Create your account" : "Almost done"}</CardTitle>
            <CardDescription>
              {step === "account"
                ? "Enter your business name and contact details to get started."
                : "Choose your currency and workspace type — you can adjust settings later."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            {step === "account" ? (
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div>
                  <label htmlFor="tenantName" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Business / Company Name
                  </label>
                  <Input
                    id="tenantName"
                    type="text"
                    required
                    autoFocus
                    placeholder="Acme Retail Ltd"
                    value={formData.tenantName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setFormData({
                        ...formData,
                        tenantName: name,
                        tenantSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
                      });
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="adminName" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Your Full Name
                  </label>
                  <Input
                    id="adminName"
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={formData.adminName}
                    onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Email Address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="jane@acme.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Mobile Phone Number
                  </label>
                  <Input
                    id="phone"
                    type="tel"
                    required
                    placeholder="+233201234567 or 0256334758"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                  <p className="text-[11px] text-secondary-500 mt-1">
                    Used for SMS verification and instant till shortage alerts.
                  </p>
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>
                <Button type="submit" className="w-full">
                  Continue
                </Button>
              </form>
            ) : (
              <form onSubmit={handleTenantSubmit} className="space-y-4 animate-in slide-in-from-right-4 duration-300 fade-in">
                <div>
                  <label htmlFor="baseCurrency" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Currency
                  </label>
                  <select
                    id="baseCurrency"
                    className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                    value={formData.baseCurrency}
                    onChange={(e) => setFormData({ ...formData, baseCurrency: e.target.value })}
                  >
                    <option value="GHS">GHS — Ghanaian Cedi (GH₵)</option>
                    <option value="NGN">NGN — Nigerian Naira (₦)</option>
                    <option value="USD">USD — US Dollar ($)</option>
                    <option value="GBP">GBP — British Pound (£)</option>
                    <option value="EUR">EUR — Euro (€)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                    Workspace Type
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: "BUSINESS", label: "Business", sub: "Retail, wholesale, services, hospitality" },
                      { value: "NONPROFIT", label: "Nonprofit / NGO", sub: "Churches, schools, NGOs, donor-funded orgs" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, orgType: opt.value })}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          formData.orgType === opt.value
                            ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                            : "border-secondary-200 dark:border-secondary-700 hover:border-secondary-400 dark:hover:border-secondary-500"
                        }`}
                      >
                        <div className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">{opt.label}</div>
                        <div className="text-[11px] text-secondary-500 mt-0.5">{opt.sub}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-secondary-500 mt-1.5">
                    Nonprofit workspaces include fund tracking and hide point-of-sale features.
                  </p>
                </div>

                {/* Terms and Conditions Checkbox */}
                <div className="pt-2 border-t border-secondary-100 dark:border-secondary-800">
                  <div className="flex items-start">
                    <input
                      id="terms"
                      type="checkbox"
                      required
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="h-4 w-4 mt-0.5 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                    />
                    <label htmlFor="terms" className="ml-2 block text-xs text-secondary-600 dark:text-secondary-400">
                      I have read and agree to the{" "}
                      <button
                        type="button"
                        onClick={() => fetchLegalDoc("terms-and-conditions")}
                        className="font-medium text-primary-600 underline hover:text-primary-500 dark:text-primary-400 inline-flex items-center"
                      >
                        <FileText className="inline-block h-3 w-3 mr-0.5" />
                        Terms and Conditions
                      </button>
                      {" "}&{" "}
                      <button
                        type="button"
                        onClick={() => fetchLegalDoc("privacy-policy")}
                        className="font-medium text-primary-600 underline hover:text-primary-500 dark:text-primary-400 inline-flex items-center"
                      >
                        <FileText className="inline-block h-3 w-3 mr-0.5" />
                        Privacy Policy
                      </button>
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => setStep("account")} className="w-1/3">
                    Back
                  </Button>
                  <Button type="submit" className="w-2/3" isLoading={isLoading}>
                    {isLoading ? "Provisioning Workspace..." : "Onboard Business"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
          {step === "account" && (
            <CardFooter className="justify-center border-t border-secondary-100 dark:border-secondary-800 pt-6">
              <p className="text-sm text-secondary-600 dark:text-secondary-400">
                Already have an account?{" "}
                <Link to="/login" className="font-medium text-primary-600 hover:text-primary-500 dark:text-primary-400">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          )}
        </Card>
      </div>

      {/* Terms & Conditions / Privacy Policy Modal */}
      <Modal isOpen={isTermsModalOpen} onClose={() => setIsTermsModalOpen(false)} title="Legal Documents">
        <div className="flex space-x-4 border-b border-secondary-200 dark:border-secondary-800 mb-4">
          <button
            type="button"
            onClick={() => fetchLegalDoc("terms-and-conditions")}
            className={`pb-2 text-xs font-semibold transition-colors border-b-2 ${activeLegalDoc === "terms-and-conditions" ? "border-primary-500 text-primary-600 dark:text-primary-400" : "border-transparent text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200"}`}
          >
            Terms and Conditions
          </button>
          <button
            type="button"
            onClick={() => fetchLegalDoc("privacy-policy")}
            className={`pb-2 text-xs font-semibold transition-colors border-b-2 ${activeLegalDoc === "privacy-policy" ? "border-primary-500 text-primary-600 dark:text-primary-400" : "border-transparent text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200"}`}
          >
            Privacy Policy
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-2 text-sm text-secondary-700 dark:text-secondary-300">
          {isLegalDocLoading ? (
            <div className="py-8 text-center">Loading document...</div>
          ) : (
            <div className="prose dark:prose-invert max-w-none whitespace-pre-line font-mono text-xs bg-secondary-50 dark:bg-secondary-900 p-4 rounded-lg border border-secondary-200 dark:border-secondary-800">
              {legalDocContent[activeLegalDoc]}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-4 border-t border-secondary-200 dark:border-secondary-800 mt-4">
          <Button variant="primary" onClick={() => { setTermsAccepted(true); setIsTermsModalOpen(false); }}>
            Accept & Close
          </Button>
        </div>
      </Modal>
    </AuthSplitLayout>
  );
}
