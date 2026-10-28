"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { IdentityInvestigationResponse } from "@consta/contracts";

import { IdentityApiError, investigateIdentity } from "@/lib/identity";

type IdentityPhase = "idle" | "loading" | "ready" | "error";

interface IdentityContextValue {
  phase: IdentityPhase;
  result: IdentityInvestigationResponse | null;
  error: string | null;
  selectedId: string | null;
  investigate: (name: string, details: string) => Promise<void>;
  selectCandidate: (id: string) => void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (!value) {
    throw new Error("useIdentity debe usarse dentro de IdentityProvider.");
  }
  return value;
}

export default function IdentityProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<IdentityPhase>("idle");
  const [result, setResult] = useState<IdentityInvestigationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const investigate = useCallback(async (name: string, details: string) => {
    setPhase("loading");
    setError(null);
    setResult(null);
    setSelectedId(null);

    try {
      const response = await investigateIdentity({
        name,
        ...(details.trim() ? { details } : {}),
      });
      setResult(response);
      setError(response.error?.message ?? null);
      setPhase("ready");
    } catch (caught) {
      if (caught instanceof IdentityApiError && caught.partial) {
        setResult({
          ...caught.partial,
          error: {
            code: caught.code,
            message: caught.message,
            ...(caught.retryable ? { retryable: true } : {}),
          },
        });
        setError(caught.message);
        setPhase("ready");
        return;
      }

      setResult(null);
      setError(
        caught instanceof IdentityApiError
          ? caught.message
          : "No se pudo completar la investigación.",
      );
      setPhase("error");
    }
  }, []);

  const selectCandidate = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  }, []);

  const value = useMemo(
    () => ({
      phase,
      result,
      error,
      selectedId,
      investigate,
      selectCandidate,
    }),
    [phase, result, error, selectedId, investigate, selectCandidate],
  );

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}
