import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

type CallbackState = "processing" | "error" | "success";

interface ErrorDetails {
  message: string;
  canRetry: boolean;
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<CallbackState>("processing");
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const processed = useRef(false);
  const { completeOAuth } = useAuth();

  const handleCallback = useCallback(async () => {
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (error) {
      setErrorDetails({
        message: errorDescription || error || "Authentication was denied",
        canRetry: true,
      });
      setState("error");
      return;
    }

    const code = searchParams.get("code");

    if (!code) {
      setErrorDetails({
        message: "No authorization code found",
        canRetry: true,
      });
      setState("error");
      return;
    }

    try {
      await completeOAuth(code);

      setState("success");
      navigate("/", { replace: true });
    } catch (err) {
      console.error("Auth callback error:", err);
      setErrorDetails({
        message: err instanceof Error ? err.message : "Authentication failed",
        canRetry: true,
      });
      setState("error");
    }
  }, [searchParams, navigate, completeOAuth]);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    handleCallback();
  }, [handleCallback]);

  const handleRetry = useCallback(() => {
    navigate("/login", { replace: true });
  }, [navigate]);

  if (state === "error" && errorDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="max-w-md w-full space-y-4 p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Authentication Failed
          </h1>
          <p className="text-gray-600">{errorDetails.message}</p>
          {errorDetails.canRetry && (
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
        <p className="mt-4 text-gray-600">Signing you in...</p>
      </div>
    </div>
  );
}
