"use client";

import { FormEvent, useState } from "react";

interface AddMemberFormProps {
  onAdd: (input: string) => string | null;
  disabled?: boolean;
}

export function AddMemberForm({ onAdd, disabled }: AddMemberFormProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = onAdd(input);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setInput("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          if (error) setError(null);
        }}
        disabled={disabled}
        placeholder="letterboxd.com/username or username"
        className="min-w-0 flex-1 rounded-lg border border-lb-ocean bg-lb-charcoal px-4 py-2.5 text-lb-porcelain placeholder:text-lb-ghost focus:border-lb-vivid focus:outline-none focus:ring-1 focus:ring-lb-vivid disabled:opacity-50"
        aria-label="Letterboxd username or profile URL"
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className="rounded-lg bg-lb-green px-5 py-2.5 font-medium text-lb-white transition hover:bg-lb-green-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add to party
      </button>
      {error && (
        <p className="text-sm text-lb-star sm:basis-full" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
