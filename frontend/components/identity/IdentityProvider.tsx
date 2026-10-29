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

import { IdentityApiError, investigateIdentity, requestMoreIdentity } from "@/lib/identity";

type IdentityPhase = "idle" | "loading" | "ready" | "error";

interface IdentityContextValue {
  phase: IdentityPhase;
  result: IdentityInvestigationResponse | null;
  error: string | null;
  selectedId: string | null;
  notice: string | null;
  investigate: (name: string, details: string) => Promise<void>;
  searchMore: () => Promise<void>;
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
  const [consultedName, setConsultedName] = useState("");
  const [consultedDetails, setConsultedDetails] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const investigate = useCallback(async (name: string, details: string) => {
    setPhase("loading");
    setError(null);
    setNotice(null);
    setResult(null);
    setSelectedId(null);
    setConsultedName(name.trim());
    setConsultedDetails(details.trim());

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

  const searchMore = useCallback(async () => {
    if (!result || !consultedName || phase === "loading") return;
    const before = result.rounds.length;
    setPhase("loading");
    setError(null);
    setNotice(null);

    try {
      const response = await requestMoreIdentity({
        name: consultedName,
        ...(consultedDetails ? { details: consultedDetails } : {}),
        investigation: result,
      });
      setResult(response);
      setError(response.error?.message ?? null);
      setNotice(
        response.rounds.length === before
          ? "Esos datos ya se buscaron o ya están en el perfil."
          : null,
      );
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
      }
      setError(
        caught instanceof IdentityApiError
          ? caught.message
          : "No se pudo completar la búsqueda extra.",
      );
      setPhase("ready");
    }
  }, [consultedDetails, consultedName, phase, result]);

  const selectCandidate = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  }, []);

  const value = useMemo(
    () => ({
      phase,
      result,
      error,
      selectedId,
      notice,
      investigate,
      searchMore,
      selectCandidate,
    }),
    [phase, result, error, selectedId, notice, investigate, searchMore, selectCandidate],
  );

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}
