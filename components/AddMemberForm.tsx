"use client";

import { FormEvent, useState } from "react";

export interface AddMemberExternalError {
  input: string;
  message: string;
}

interface AddMemberFormProps {
  onAdd: (input: string) => string | null;
  disabled?: boolean;
  externalError?: AddMemberExternalError | null;
  onExternalErrorDismiss?: () => void;
}

export function AddMemberForm({
  onAdd,
  disabled,
  externalError,
  onExternalErrorDismiss,
}: AddMemberFormProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputValue = externalError?.input ?? input;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = onAdd(inputValue);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setInput("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
            if (externalError) onExternalErrorDismiss?.();
          }}
          disabled={disabled}
          placeholder="letterboxd.com/username or username"
          className="min-w-0 flex-1 rounded-lg border border-lb-ocean bg-lb-charcoal px-4 py-2.5 text-lb-porcelain placeholder:text-lb-ghost focus:border-lb-vivid focus:outline-none focus:ring-1 focus:ring-lb-vivid disabled:opacity-50"
          aria-label="Letterboxd username or profile URL"
        />
        <button
          type="submit"
          disabled={disabled || !inputValue.trim()}
          className="rounded-lg bg-lb-green px-5 py-2.5 font-medium text-lb-white transition hover:bg-lb-green-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add to party
        </button>
      </div>
      {(error ?? externalError?.message) && (
        <p className="text-sm text-lb-star" role="alert">
          {error ?? externalError?.message}
        </p>
      )}
    </form>
  );
}
