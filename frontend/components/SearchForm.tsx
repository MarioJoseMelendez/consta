"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { IconArrowRight, IconSearch } from "./Icons";

interface SearchFormProps {
  initialQuery?: string;
  variant?: "hero" | "workspace";
  submitLabel?: string;
  placeholder?: string;
}

export default function SearchForm({
  initialQuery = "",
  variant = "hero",
  submitLabel = "Investigar",
  placeholder = "Empresa, persona o NIT…",
}: SearchFormProps) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(initialQuery);

  useEffect(() => {
    setValue(initialQuery);
  }, [initialQuery]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = value.trim();
    router.push(query ? `/workspace?q=${encodeURIComponent(query)}` : "/workspace");
  }

  return (
    <form
      className={`search-form search-form--${variant}`}
      action="/workspace"
      method="get"
      role="search"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor={inputId}>
        Buscar una empresa, persona o identificador
      </label>
      <IconSearch className="search-icon" width={20} height={20} />
      <input
        id={inputId}
        name="q"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      <button
        type="submit"
        className="search-submit"
        aria-label={submitLabel}
      >
        <span>{submitLabel}</span>
        <IconArrowRight width={16} height={16} />
      </button>
    </form>
  );
}
