"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  IdentityConnectionState,
  IdentityInvestigation,
  IdentityInvestigationResponse,
} from "@consta/contracts";

import {
  ConnectionApiError,
  IdentityApiError,
  investigateIdentity,
  requestIdentityConnections,
  requestMoreIdentity,
} from "@/lib/identity";

type IdentityPhase = "idle" | "loading" | "ready" | "error";
type ConnectionPhase = "idle" | "loading" | "ready" | "error";

export const MAX_CONNECTION_ROUNDS = 3;

interface IdentityContextValue {
  phase: IdentityPhase;
  result: IdentityInvestigationResponse | null;
  error: string | null;
  expandedId: string | null;
  confirmedId: string | null;
  connection: IdentityConnectionState | null;
  connectionPhase: ConnectionPhase;
  connectionError: string | null;
  /** Solo tiene sentido en `connectionPhase === "error"`. */
  connectionRetryable: boolean;
  /** Rama que se está profundizando ahora mismo, si hay una. */
  branchLabel: string | null;
  notice: string | null;
  investigate: (name: string, details: string) => Promise<void>;
  searchMore: () => Promise<void>;
  selectCandidate: (id: string) => void;
  confirmCandidate: (id: string) => void;
  retryConnections: () => void;
  /** Abre una vuelta más siguiendo una entidad o una afirmación concreta. */
  investigateBranch: (branch: {
    entityId?: string;
    claimId?: string;
    label: string;
  }) => Promise<void>;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (!value) {
    throw new Error("useIdentity debe usarse dentro de IdentityProvider.");
  }
  return value;
}

function investigationOf(
  result: IdentityInvestigationResponse,
): IdentityInvestigation {
  return {
    plan: result.plan,
    rounds: result.rounds,
    candidates: result.candidates,
  };
}

export default function IdentityProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<IdentityPhase>("idle");
  const [result, setResult] = useState<IdentityInvestigationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [connection, setConnection] = useState<IdentityConnectionState | null>(
    null,
  );
  const [connectionPhase, setConnectionPhase] =
    useState<ConnectionPhase>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionRetryable, setConnectionRetryable] = useState(false);
  const [branchLabel, setBranchLabel] = useState<string | null>(null);
  const [consultedName, setConsultedName] = useState("");
  const [consultedDetails, setConsultedDetails] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const runRef = useRef(0);

  const resetConnections = useCallback(() => {
    runRef.current += 1;
    setExpandedId(null);
    setConfirmedId(null);
    setConnection(null);
    setConnectionPhase("idle");
    setConnectionError(null);
    setConnectionRetryable(false);
    setBranchLabel(null);
  }, []);

  const investigate = useCallback(
    async (name: string, details: string) => {
      setPhase("loading");
      setError(null);
      setNotice(null);
      setResult(null);
      resetConnections();
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
    },
    [resetConnections],
  );

  const runConnections = useCallback(
    async (
      name: string,
      details: string,
      investigation: IdentityInvestigation,
      candidateId: string,
      runId: number,
    ) => {
      let state: IdentityConnectionState | null = null;

      try {
        for (let round = 0; round < MAX_CONNECTION_ROUNDS; round += 1) {
          const response = await requestIdentityConnections({
            name,
            ...(details ? { details } : {}),
            investigation,
            candidateId,
            ...(state ? { connection: state } : {}),
          });

          if (runRef.current !== runId) return;

          state = {
            claims: response.claims,
            rounds: response.rounds,
            summary: response.summary,
            canContinue: response.canContinue,
            stoppedReason: response.stoppedReason,
          };
          setConnection(state);
          setConnectionError(response.error?.message ?? null);
          setConnectionRetryable(response.error?.retryable === true);

          if (
            !response.canContinue ||
            state.rounds.length >= MAX_CONNECTION_ROUNDS
          ) {
            break;
          }
        }

        if (runRef.current !== runId) return;
        setConnectionPhase("ready");
      } catch (caught) {
        if (runRef.current !== runId) return;

        if (caught instanceof ConnectionApiError) {
          if (caught.partial) setConnection(caught.partial);
          setConnectionError(caught.message);
          // Red, timeout y 5xx reintentables vienen marcados por el cliente;
          // validación y 4xx quedan fuera.
          setConnectionRetryable(caught.retryable);
        } else {
          setConnectionError("No se pudieron tejer las conexiones.");
          setConnectionRetryable(false);
        }
        setConnectionPhase("error");
      }
    },
    [],
  );

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

      if (
        confirmedId &&
        !response.candidates.some((candidate) => candidate.id === confirmedId)
      ) {
        resetConnections();
      }

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
  }, [confirmedId, consultedDetails, consultedName, phase, resetConnections, result]);

  const selectCandidate = useCallback(
    (id: string) => {
      if (confirmedId && confirmedId !== id) {
        runRef.current += 1;
        setConfirmedId(null);
        setConnection(null);
        setConnectionPhase("idle");
        setConnectionError(null);
        setConnectionRetryable(false);
      }
      setExpandedId((current) => (current === id ? null : id));
    },
    [confirmedId],
  );

  const confirmCandidate = useCallback(
    (id: string) => {
      if (!result || !consultedName) return;
      const candidate = result.candidates.find((item) => item.id === id);
      if (!candidate) return;

      runRef.current += 1;
      const runId = runRef.current;

      setExpandedId(id);
      setConfirmedId(id);
      setConnection(null);
      setConnectionError(null);
      setConnectionRetryable(false);
      setBranchLabel(null);
      setConnectionPhase("loading");

      void runConnections(
        consultedName,
        consultedDetails,
        investigationOf(result),
        id,
        runId,
      );
    },
    [consultedDetails, consultedName, result, runConnections],
  );

  const retryConnections = useCallback(() => {
    if (!result || !confirmedId || !consultedName) return;
    const candidate = result.candidates.find((item) => item.id === confirmedId);
    if (!candidate) return;

    runRef.current += 1;
    const runId = runRef.current;

    setConnection(null);
    setConnectionError(null);
    setConnectionRetryable(false);
    setBranchLabel(null);
    setConnectionPhase("loading");
    void runConnections(
      consultedName,
      consultedDetails,
      investigationOf(result),
      confirmedId,
      runId,
    );
  }, [confirmedId, consultedDetails, consultedName, result, runConnections]);

  /**
   * Una vuelta suelta que sigue la rama elegida. El backend abre la vuelta
   * aunque el loop acumulado ya se hubiera detenido, y devuelve el estado
   * completo para no perder los hilos anteriores.
   */
  const investigateBranch = useCallback(
    async (branch: { entityId?: string; claimId?: string; label: string }) => {
      if (!result || !confirmedId || !consultedName) return;
      if (connectionPhase === "loading") return;

      const runId = runRef.current;
      setConnectionPhase("loading");
      setConnectionError(null);
      setConnectionRetryable(false);
      setBranchLabel(branch.label);

      try {
        const response = await requestIdentityConnections({
          name: consultedName,
          ...(consultedDetails ? { details: consultedDetails } : {}),
          investigation: investigationOf(result),
          candidateId: confirmedId,
          ...(connection ? { connection } : {}),
          branchContext: {
            ...(branch.entityId ? { entityId: branch.entityId } : {}),
            ...(branch.claimId ? { claimId: branch.claimId } : {}),
            label: branch.label,
          },
        });

        if (runRef.current !== runId) return;

        setConnection({
          claims: response.claims,
          rounds: response.rounds,
          summary: response.summary,
          canContinue: response.canContinue,
          stoppedReason: response.stoppedReason,
        });
        setConnectionError(response.error?.message ?? null);
        setConnectionRetryable(response.error?.retryable === true);
        setConnectionPhase("ready");
      } catch (caught) {
        if (runRef.current !== runId) return;

        if (caught instanceof ConnectionApiError) {
          if (caught.partial) setConnection(caught.partial);
          setConnectionError(caught.message);
          setConnectionRetryable(caught.retryable);
        } else {
          setConnectionError("No se pudo profundizar en esa rama.");
          setConnectionRetryable(false);
        }
        setConnectionPhase("error");
      }
    },
    [confirmedId, connection, connectionPhase, consultedDetails, consultedName, result],
  );

  const value = useMemo(
    () => ({
      phase,
      result,
      error,
      expandedId,
      confirmedId,
      connection,
      connectionPhase,
      connectionError,
      connectionRetryable,
      branchLabel,
      notice,
      investigate,
      searchMore,
      selectCandidate,
      confirmCandidate,
      retryConnections,
      investigateBranch,
    }),
    [
      phase,
      result,
      error,
      expandedId,
      confirmedId,
      connection,
      connectionPhase,
      connectionError,
      connectionRetryable,
      branchLabel,
      notice,
      investigate,
      searchMore,
      selectCandidate,
      confirmCandidate,
      retryConnections,
      investigateBranch,
    ],
  );

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}
