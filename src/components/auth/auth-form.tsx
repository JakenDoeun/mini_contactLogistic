'use client';

import { useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { safeNextPath } from '@/lib/safe-next';

type Field = 'code' | 'username' | 'password' | 'confirm';

const MESSAGES: Record<string, { text: string; field?: Field }> = {
  invalid_credentials: { text: 'Wrong username or password.', field: 'password' },
  bad_code: { text: 'That code is not right. Check it and try again.', field: 'code' },
  account_exists: { text: 'An account already exists. Reload the page to sign in.' },
  invalid_username: { text: 'Username: 3 to 32 characters, letters, digits, dot, dash or underscore.', field: 'username' },
  invalid_password: { text: 'Password: at least 12 characters.', field: 'password' },
  database_unavailable: { text: 'The branch database is not ready. Ask the office to start the app again.' },
  cross_site: { text: 'This page must be opened from the branch address.' },
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Sign-in form, or (mode="first_run") the form that creates the first account with the one-time code. */
export function AuthForm({ mode, next }: { mode: 'login' | 'first_run'; next?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'success'>('idle');
  const first = mode === 'first_run';

  // Feedback only: runs alongside the request and the redirect, never before them.
  function fail(e: { text: string; field?: Field }) {
    setError(e);
    setStatus('idle');
    const form = formRef.current;
    if (!form) return;
    if (e.field) {
      const input = form.elements.namedItem(e.field) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }
    if (!reducedMotion()) animate(form, { translateX: [0, -6, 5, -3, 2, 0], duration: 360, ease: 'inOutSine' });
  }

  async function submit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (first && data.password !== data.confirm) return fail({ text: 'The two passwords do not match.', field: 'confirm' });
    setStatus('busy');
    setError(null);
    try {
      const res = await fetch(first ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(first ? { code: data.code, username: data.username, password: data.password } : { username: data.username, password: data.password }),
      });
      if (res.ok) {
        setStatus('success');
        window.location.assign(safeNextPath(next));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
      if (body.error === 'paused') return fail({ text: `Too many wrong attempts. Try again in ${body.retryAfter ?? 60} seconds.` });
      fail(MESSAGES[body.error ?? ''] ?? { text: 'Could not sign in. Try again.' });
    } catch {
      fail({ text: 'The branch computer did not answer. Check the connection and try again.' });
    }
  }

  const invalid = (name: Field) => (error?.field === name ? { 'aria-invalid': true, 'aria-describedby': 'auth-error' } : {});

  return (
    <form
      ref={formRef}
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (status === 'idle') void submit(e.currentTarget);
      }}
    >
      {first && (
        <FormField label="One-time code" name="code" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" className="font-mono tracking-wider" {...invalid('code')} />
      )}
      <FormField label="Username" name="username" autoComplete="username" autoCapitalize="none" {...invalid('username')} />
      <FormField label="Password" name="password" type="password" autoComplete={first ? 'new-password' : 'current-password'} minLength={first ? 12 : undefined} {...invalid('password')} />
      {first && <FormField label="Repeat password" name="confirm" type="password" autoComplete="new-password" {...invalid('confirm')} />}
      {/* Fixed-height slot: a one-line message appears without moving the button. */}
      <p id="auth-error" role="alert" className="min-h-5 text-sm leading-5 text-destructive">
        {error?.text}
      </p>
      <Button
        type="submit"
        className={cn('w-full transition-colors', status === 'success' && 'bg-success hover:bg-success')}
        disabled={status !== 'idle'}
        aria-busy={status === 'busy'}
      >
        {status === 'busy' ? (
          <>
            <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden />
            {first ? 'Creating account…' : 'Signing in…'}
          </>
        ) : status === 'success' ? (
          <>
            <Check aria-hidden />
            Signed in
          </>
        ) : first ? (
          'Create account and sign in'
        ) : (
          'Sign in'
        )}
      </Button>
    </form>
  );
}

function FormField({ label, name, className, ...props }: { label: string; name: Field } & React.ComponentProps<'input'>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={name}
        name={name}
        required
        spellCheck={false}
        className={cn('h-11 rounded-lg aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/30', className)}
        {...props}
      />
    </div>
  );
}
