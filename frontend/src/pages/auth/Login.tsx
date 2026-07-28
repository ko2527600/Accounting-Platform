import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isDeactivated, setIsDeactivated] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  const from = (location.state?.from?.pathname && location.state.from.pathname !== "/")
    ? location.state.from.pathname
    : "/dashboard";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setIsDeactivated(false);
    setResendMsg("");

    try {
      const response = await api.post("/auth/login", { email, password });

      if (response.data.success) {
        const { token, user } = response.data.data;
        login(token, user);
        navigate(from, { replace: true });
      }
    } catch (err: any) {
      if (err.response?.data?.message) {
        setError(err.response.data.message);
        setIsDeactivated(err.response.data.message === "User account has been deactivated.");
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setIsResending(true);
    setResendMsg("");
    try {
      const res = await api.post("/auth/resend-verification", { email });
      if (res.data.success) {
        setResendMsg("A new verification link/code has been sent. Please check your inbox and phone.");
      }
    } catch (err: any) {
      setResendMsg(err.response?.data?.error || "Failed to resend verification.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 dark:bg-secondary-950 transition-colors">
      <div className="sm:mx-auto sm:w-full sm:max-w-md mb-8 text-center">
        <h1 className="text-3xl font-extrabold text-primary-600 dark:text-primary-500 tracking-tight">
          Ledgio
        </h1>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Sign in to your account
        </h2>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="border-none shadow-xl sm:rounded-2xl">
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your email and password to sign in to your workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-6">
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">
                  {error}
                  {isDeactivated && (
                    <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800">
                      <p className="text-xs text-red-500 dark:text-red-400 mb-2">
                        Your account isn't verified yet. Didn't get the email or SMS code?
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleResendVerification}
                        disabled={isResending || !email}
                      >
                        {isResending ? "Sending..." : "Resend Verification"}
                      </Button>
                      {resendMsg && <p className="text-xs text-secondary-600 dark:text-secondary-400 mt-2">{resendMsg}</p>}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
