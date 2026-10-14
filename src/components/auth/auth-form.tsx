'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { safeNextPath } from '@/lib/safe-next';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong username or password.',
  bad_code: 'That one-time code is not right. Check the file on the office computer.',
  account_exists: 'An account already exists. Sign in instead.',
  invalid_username: 'Username: 3 to 32 characters, letters, digits, dot, dash or underscore.',
  invalid_password: 'Password: at least 12 characters.',
  database_unavailable: 'The branch database is not ready. Ask the office to start the app again.',
  cross_site: 'This page must be opened from the branch address.',
};

/** Sign-in form, or (mode="first_run") the form that creates the first account with the one-time code. */
export function AuthForm({ mode, next }: { mode: 'login' | 'first_run'; next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = mode === 'first_run';

  async function submit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (first && data.password !== data.confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(first ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(first ? { code: data.code, username: data.username, password: data.password } : { username: data.username, password: data.password }),
      });
      if (res.ok) return window.location.assign(safeNextPath(next));
      const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
      setError(body.error === 'paused' ? `Too many wrong attempts. Try again in ${body.retryAfter ?? 60} seconds.` : (MESSAGES[body.error ?? ''] ?? 'Could not sign in. Try again.'));
    } catch {
      setError('The branch computer did not answer. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      {first && (
        <Field label="One-time code" name="code" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" />
      )}
      <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" />
      <Field label="Password" name="password" type="password" autoComplete={first ? 'new-password' : 'current-password'} minLength={first ? 12 : undefined} />
      {first && <Field label="Repeat password" name="confirm" type="password" autoComplete="new-password" />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Please wait…' : first ? 'Create account and sign in' : 'Sign in'}
      </Button>
    </form>
  );
}

function Field({ label, name, ...props }: { label: string; name: string } & React.ComponentProps<'input'>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <Input id={name} name={name} required spellCheck={false} {...props} />
    </div>
  );
}
