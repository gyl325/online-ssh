import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";

import {
  getApiErrorMessage,
  getCurrentUser,
  login,
  loginWithEmailCode,
  logout,
  refreshAuthSession,
  register,
  verifyMfaLogin
} from "./api";
import { clearAuthStorage, loadStoredUser, storeUser } from "./storage";
import type {
  AuthSession,
  AuthUser,
  EmailCodeLoginInput,
  LoginInput,
  LoginResponse,
  MfaRequiredLoginResponse,
  RegisterInput,
  VerifyMfaLoginInput
} from "./types";
import { usePreferences } from "../preferences/PreferencesContext";
import { useToast } from "../ui/ToastContext";
import {
  authUnauthorizedEvent,
  isHttpError,
  setAuthRefreshHandler,
  type AuthUnauthorizedReason
} from "../../shared/api/http";

type AuthStatus = "checking" | "authenticated" | "anonymous";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  bootError: string | null;
  signIn: (input: LoginInput) => Promise<LoginResponse>;
  signInWithEmailCode: (input: EmailCodeLoginInput) => Promise<LoginResponse>;
  verifyMfa: (input: VerifyMfaLoginInput) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
  children: ReactNode;
  sessionCheckEnabled?: boolean;
};

function isMfaRequiredLoginResponse(response: LoginResponse): response is MfaRequiredLoginResponse {
  return (response as Partial<MfaRequiredLoginResponse>).status === "mfa_required";
}

function useProvideAuth(sessionCheckEnabled: boolean): AuthContextValue {
  const { t } = usePreferences();
  const toast = useToast();
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());
  const [session, setSession] = useState<AuthSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const setAuthenticatedUser = (nextUser: AuthUser | null, nextSession?: AuthSession | null) => {
    storeUser(nextUser);
    setUser(nextUser);
    setSession(nextSession ?? null);
    setStatus("authenticated");
    setBootError(null);
  };

  const resetToAnonymous = () => {
    clearAuthStorage();
    setUser(null);
    setSession(null);
    setStatus("anonymous");
    setBootError(null);
  };

  const refreshSession = async () => {
    startTransition(() => {
      setStatus("checking");
      setBootError(null);
    });

    try {
      let response = await getCurrentUser({ skipAuthRefresh: true });
      if (!response.user) {
        try {
          response = await refreshAuthSession();
        } catch {
          resetToAnonymous();
          return;
        }
      }
      if (!response.user) {
        resetToAnonymous();
        return;
      }

      setAuthenticatedUser(response.user, response.session);
    } catch (error) {
      if (isHttpError(error) && error.status === 401) {
        try {
          const response = await refreshAuthSession();
          setAuthenticatedUser(response.user, response.session);
        } catch {
          resetToAnonymous();
        }
        return;
      }
      setBootError(getApiErrorMessage(error, t("common.sessionProbeFailed"), t));
      setStatus(user ? "authenticated" : "anonymous");
    }
  };

  useEffect(() => {
    if (!sessionCheckEnabled) {
      setAuthRefreshHandler(null);
      return;
    }

    setAuthRefreshHandler(refreshAuthSession);
    void refreshSession();
    return () => setAuthRefreshHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCheckEnabled]);

  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      const reason = event instanceof CustomEvent
        ? (event.detail as { reason?: AuthUnauthorizedReason } | null)?.reason
        : undefined;
      const hadUser = Boolean(user || loadStoredUser());
      const shouldNotify = hadUser && (reason === "session_revoked" || status === "authenticated");

      resetToAnonymous();
      if (shouldNotify) {
        toast.warning(
          reason === "session_revoked"
            ? t("auth.sessionRevokedMessage")
            : t("auth.sessionExpiredMessage"),
          t("auth.sessionExpiredTitle")
        );
      }
    };
    window.addEventListener(authUnauthorizedEvent, handleUnauthorized);
    return () => window.removeEventListener(authUnauthorizedEvent, handleUnauthorized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, t, toast, user]);

  const signIn = async (input: LoginInput) => {
    const response = await login(input);
    if (isMfaRequiredLoginResponse(response)) {
      resetToAnonymous();
      return response;
    }
    setAuthenticatedUser(response.user, response.session);
    return response;
  };

  const signInWithEmailCode = async (input: EmailCodeLoginInput) => {
    const response = await loginWithEmailCode(input);
    if (isMfaRequiredLoginResponse(response)) {
      resetToAnonymous();
      return response;
    }
    setAuthenticatedUser(response.user, response.session);
    return response;
  };

  const verifyMfa = async (input: VerifyMfaLoginInput) => {
    const response = await verifyMfaLogin(input);
    setAuthenticatedUser(response.user, response.session);
  };

  const signUp = async (input: RegisterInput) => {
    const response = await register(input);
    setAuthenticatedUser(response.user, response.session);
  };

  const signOut = async () => {
    try {
      await logout();
    } finally {
      resetToAnonymous();
    }
  };

  return {
    status,
    user,
    session,
    isAuthenticated: status === "authenticated",
    bootError,
    signIn,
    signInWithEmailCode,
    verifyMfa,
    signUp,
    signOut,
    refreshSession
  };
}

export function AuthProvider({ children, sessionCheckEnabled = true }: AuthProviderProps) {
  const value = useProvideAuth(sessionCheckEnabled);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return value;
}
