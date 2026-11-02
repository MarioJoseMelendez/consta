"use client";

import { useId, useState, type FormEvent } from "react";

import { IconArrowRight, IconSearch } from "@/components/Icons";

import { useIdentity } from "./IdentityProvider";

export default function IdentityForm() {
  const nameId = useId();
  const detailsId = useId();
  const interestId = useId();
  const { phase, investigate } = useIdentity();
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [interest, setInterest] = useState("");
  const loading = phase === "loading";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || loading) return;
    void investigate(nextName, details, interest);
  }

  return (
    <form className="identity-form" onSubmit={handleSubmit}>
      <div className="identity-field">
        <label htmlFor={nameId}>Nombre</label>
        <div className="identity-name">
          <IconSearch width={18} height={18} />
          <input
            id={nameId}
            name="name"
            type="text"
            value={name}
            maxLength={200}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Persona, empresa o institución"
            disabled={loading}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>

      <div className="identity-field">
        <label htmlFor={detailsId}>
          Descripción <span>opcional</span>
        </label>
        <textarea
          id={detailsId}
          name="details"
          value={details}
          maxLength={2000}
          rows={3}
          placeholder="Lugar, periodo, cargo u otro contexto público. No sustituye a una fuente."
          disabled={loading}
          onChange={(event) => setDetails(event.target.value)}
        />
      </div>

      <div className="identity-field">
        <label htmlFor={interestId}>
          Interés de investigación <span>opcional</span>
        </label>
        <textarea
          id={interestId}
          name="interest"
          value={interest}
          maxLength={1000}
          rows={3}
          placeholder="Qué quieres encontrar: contratos, partidos, empresas asociadas, apoyo externo. Si lo dejas vacío, se buscan conexiones de interés público."
          disabled={loading}
          onChange={(event) => setInterest(event.target.value)}
        />
      </div>

      <button type="submit" className="identity-submit" disabled={loading}>
        <span>{loading ? "Buscando" : "Investigar"}</span>
        <IconArrowRight width={16} height={16} />
      </button>
    </form>
  );
}
