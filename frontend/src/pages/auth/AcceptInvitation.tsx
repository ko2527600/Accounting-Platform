import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api";
import { Building } from "lucide-react";

export function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { login } = useAuth();

  const [invitationInfo, setInvitationInfo] = useState<{
    email: string;
    role: string;
    tenantName: string;
  } | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided.");
      setIsLoading(false);
      return;
    }

    const verifyInvitation = async () => {
      try {
        const response = await api.get(`/auth/invitation/${token}`);
        if (response.data.success) {
          setInvitationInfo(response.data.data.invitation);
        }
      } catch (err: any) {
        setError(err.response?.data?.error || "Failed to verify invitation token.");
      } finally {
        setIsLoading(false);
      }
    };

    verifyInvitation();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.post("/auth/accept-invitation", {
        token,
        name,
        password,
      });

      if (response.data.success) {
        const { token: jwtToken, user } = response.data.data;
        login(jwtToken, user);
        navigate("/");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to accept invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-secondary-50 dark:bg-secondary-900 flex items-center justify-center p-4">
        <div className="text-secondary-600 dark:text-secondary-400">Verifying invitation...</div>
      </div>
    );
  }

  if (error && !invitationInfo) {
    return (
      <div className="min-h-screen bg-secondary-50 dark:bg-secondary-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-red-200 dark:border-red-900">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Invalid Invitation</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/login")} className="w-full">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 transition-colors duration-200">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-center text-3xl font-extrabold bg-gradient-to-r from-primary-500 to-primary-700 bg-clip-text text-transparent">
          AccountGo
        </h1>
        <h2 className="mt-2 text-center text-xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Join Workspace Team
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3 mb-2 p-3 bg-primary-50 dark:bg-primary-950/40 rounded-lg border border-primary-200 dark:border-primary-800">
              <Building className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <div>
                <p className="text-xs text-secondary-500">Invited to Workspace</p>
                <p className="text-sm font-semibold text-secondary-900 dark:text-secondary-50">
                  {invitationInfo?.tenantName}
                </p>
              </div>
            </div>
            <CardTitle>Complete Your Account</CardTitle>
            <CardDescription>
              {invitationInfo?.email} • Assigned Role: <span className="font-semibold text-primary-600 dark:text-primary-400">{invitationInfo?.role}</span>
            </CardDescription>
          </CardHeader>

          <CardContent>
            {error && (
              <div className="mb-4 p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Full Name
                </label>
                <Input
                  type="text"
                  required
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Create Password
                </label>
                <Input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Confirm Password
                </label>
                <Input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <Button type="submit" variant="primary" className="w-full flex justify-center" disabled={isSubmitting}>
                {isSubmitting ? "Joining Workspace..." : "Accept Invitation & Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
