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
        <label htmlFor={nameId}>Name</label>
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
            placeholder="Person, company, or institution"
            disabled={loading}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>

      <div className="identity-field">
        <label htmlFor={detailsId}>
          Description <span>optional</span>
        </label>
        <textarea
          id={detailsId}
          name="details"
          value={details}
          maxLength={2000}
          rows={3}
          placeholder="Place, period, office, or other public context. This is not a source."
          disabled={loading}
          onChange={(event) => setDetails(event.target.value)}
        />
      </div>

      <div className="identity-field">
        <label htmlFor={interestId}>
          Investigation interest <span>optional</span>
        </label>
        <textarea
          id={interestId}
          name="interest"
          value={interest}
          maxLength={1000}
          rows={3}
          placeholder="What to look for: contracts, parties, associated companies, outside support. Leave empty to follow public-interest ties."
          disabled={loading}
          onChange={(event) => setInterest(event.target.value)}
        />
      </div>

      <button type="submit" className="identity-submit" disabled={loading}>
        <span>{loading ? "Searching" : "Investigate"}</span>
        <IconArrowRight width={16} height={16} />
      </button>
    </form>
  );
}
