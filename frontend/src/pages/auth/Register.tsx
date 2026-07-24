import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api";
import { FileText } from "lucide-react";

export function Register() {
  const [step, setStep] = useState<"account" | "tenant">("account");
  const [formData, setFormData] = useState({
    adminName: "",
    email: "",
    password: "",
    tenantName: "",
    tenantSlug: ""
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [termsContent, setTermsContent] = useState<string | null>(null);
  const [isTermsLoading, setIsTermsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login } = useAuth();
  const tenantNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "tenant" && tenantNameInputRef.current) {
      tenantNameInputRef.current.focus();
    }
  }, [step]);

  const fetchTerms = async () => {
    setIsTermsModalOpen(true);
    if (!termsContent) {
      setIsTermsLoading(true);
      try {
        const res = await api.get("/legal/terms-and-conditions");
        if (res.data.success) {
          setTermsContent(res.data.content);
        }
      } catch (err) {
        setTermsContent("Failed to load Terms and Conditions. Please try again.");
      } finally {
        setIsTermsLoading(false);
      }
    }
  };

  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.email || !formData.password || !formData.adminName) {
      setError("Please fill in your name, email, and password.");
      return;
    }
    setStep("tenant");
  };

  const handleTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.tenantName || !formData.tenantSlug) return;
    
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
        password: formData.password,
        adminName: formData.adminName,
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
        };

        login(token, userObj);
        navigate("/");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to onboard business workspace.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 dark:bg-secondary-950 transition-colors">
      <div className="sm:mx-auto sm:w-full sm:max-w-md mb-8 text-center">
        <h1 className="text-3xl font-extrabold text-primary-600 dark:text-primary-500 tracking-tight">
          AccountGo
        </h1>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Onboard Your Business Workspace
        </h2>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="border-none shadow-xl sm:rounded-2xl">
          <CardHeader>
            <CardTitle>{step === "account" ? "Administrator Account" : "Business Workspace Setup"}</CardTitle>
            <CardDescription>
              {step === "account" 
                ? "First, set up your workspace administrator credentials." 
                : "Now, enter your company details to provision your isolated workspace."}
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
                  <label htmlFor="adminName" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Your Full Name
                  </label>
                  <Input
                    id="adminName"
                    type="text"
                    required
                    autoFocus
                    placeholder="Jane Doe"
                    value={formData.adminName}
                    onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Admin Email Address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="admin@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
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
                  Continue to Workspace Setup
                </Button>
              </form>
            ) : (
              <form onSubmit={handleTenantSubmit} className="space-y-4 animate-in slide-in-from-right-4 duration-300 fade-in">
                <div>
                  <label htmlFor="tenantName" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Company / Business Name
                  </label>
                  <Input
                    id="tenantName"
                    type="text"
                    required
                    ref={tenantNameInputRef}
                    placeholder="Acme Enterprises"
                    value={formData.tenantName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setFormData({ 
                        ...formData, 
                        tenantName: name,
                        tenantSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                      });
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="tenantSlug" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                    Workspace URL Slug
                  </label>
                  <div className="flex items-center">
                    <span className="inline-flex h-10 items-center px-3 rounded-l-md border border-r-0 border-secondary-300 bg-secondary-50 text-secondary-500 sm:text-sm dark:bg-secondary-800 dark:border-secondary-700">
                      accountgo.com/
                    </span>
                    <Input
                      id="tenantSlug"
                      type="text"
                      required
                      className="rounded-l-none"
                      placeholder="acme-enterprises"
                      value={formData.tenantSlug}
                      onChange={(e) => setFormData({ ...formData, tenantSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '') })}
                    />
                  </div>
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
                        onClick={fetchTerms}
                        className="font-medium text-primary-600 underline hover:text-primary-500 dark:text-primary-400 inline-flex items-center"
                      >
                        <FileText className="inline-block h-3 w-3 mr-0.5" />
                        Terms and Conditions & Privacy Policy
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

      {/* Terms & Conditions Modal */}
      <Modal isOpen={isTermsModalOpen} onClose={() => setIsTermsModalOpen(false)} title="Platform Terms and Conditions">
        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-2 text-sm text-secondary-700 dark:text-secondary-300">
          {isTermsLoading ? (
            <div className="py-8 text-center">Loading document...</div>
          ) : (
            <div className="prose dark:prose-invert max-w-none whitespace-pre-line font-mono text-xs bg-secondary-50 dark:bg-secondary-900 p-4 rounded-lg border border-secondary-200 dark:border-secondary-800">
              {termsContent}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-4 border-t border-secondary-200 dark:border-secondary-800 mt-4">
          <Button variant="primary" onClick={() => { setTermsAccepted(true); setIsTermsModalOpen(false); }}>
            Accept & Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}
