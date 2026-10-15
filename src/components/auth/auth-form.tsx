'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { safeNextPath } from '@/lib/safe-next';

type Field = 'code' | 'username' | 'password' | 'confirm';
type Mode = 'login' | 'first_run' | 'recover';

const MESSAGES: Record<string, { text: string; field?: Field }> = {
  invalid_credentials: { text: 'Wrong username or password.', field: 'password' },
  bad_code: { text: 'That code is not right. Check it and try again.', field: 'code' },
  bad_recovery: { text: 'That username and recovery code do not match an active code.', field: 'code' },
  account_exists: { text: 'An account already exists. Reload the page to sign in.' },
  invalid_username: { text: 'Username: 3 to 32 characters, letters, digits, dot, dash or underscore.', field: 'username' },
  invalid_password: { text: 'Password: at least 12 characters.', field: 'password' },
  database_unavailable: { text: 'The branch database is not ready. Ask the office to start the app again.' },
  cross_site: { text: 'This page must be opened from the branch address.' },
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Sign-in form, or (mode="first_run") the form that creates the first account with the one-time code. From sign-in,
 * "Forgot password?" switches to the recovery form (new password with the recovery code from the office computer).
 */
export function AuthForm({ mode: initialMode, next }: { mode: 'login' | 'first_run'; next?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const switched = useRef(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'success'>('idle');
  const first = mode === 'first_run';
  const recover = mode === 'recover';
  const newPassword = first || recover;

  // After a switch (not on first load), move focus to the new heading so screen readers announce the change.
  useEffect(() => {
    if (switched.current) headingRef.current?.focus();
  }, [mode]);

  function switchMode(to: Mode) {
    switched.current = true;
    setMode(to);
    setError(null);
    setNotice(null);
  }

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
    if (newPassword && data.password !== data.confirm) return fail({ text: 'The two passwords do not match.', field: 'confirm' });
    setStatus('busy');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(first ? '/api/auth/setup' : recover ? '/api/auth/recover' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPassword ? { code: data.code, username: data.username, password: data.password } : { username: data.username, password: data.password }),
      });
      if (res.ok && recover) {
        form.reset();
        setStatus('idle');
        switched.current = true;
        setMode('login');
        setNotice('Password changed. Every device was signed out. Sign in with the new password.');
        return;
      }
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
    <>
      {!first && (
        <>
          <h1 ref={headingRef} tabIndex={-1} className="text-[1.375rem] leading-tight font-semibold tracking-tight outline-none">
            {recover ? 'Reset your password' : 'Sign in'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {recover ? 'Use the recovery code from the office computer to set a new password.' : 'Use your staff account.'}
          </p>
        </>
      )}
      <form
        ref={formRef}
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (status === 'idle') void submit(e.currentTarget);
        }}
      >
        {recover && (
          <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>On the office computer, in the project folder:</p>
            <ol className="space-y-2">
              <li>
                1. Create a code, if none exists yet or the last one was used:
                <CommandLine command="npm run recovery-code -- rotate" />
              </li>
              <li>
                2. Show it, then type it below. It works once.
                <CommandLine command="npm run recovery-code -- show" />
              </li>
            </ol>
          </div>
        )}
        {first && (
          <FormField label="One-time code" name="code" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" className="font-mono tracking-wider" {...invalid('code')} />
        )}
        <FormField label="Username" name="username" autoComplete="username" autoCapitalize="none" {...invalid('username')} />
        {recover && (
          <FormField label="Recovery code" name="code" autoComplete="off" placeholder="XXXX-XXXX-…" autoCapitalize="characters" className="font-mono tracking-wider" {...invalid('code')} />
        )}
        <FormField
          label={recover ? 'New password' : 'Password'}
          name="password"
          type="password"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 12 : undefined}
          {...invalid('password')}
        />
        {newPassword && <FormField label="Repeat password" name="confirm" type="password" autoComplete="new-password" {...invalid('confirm')} />}
        {/* Fixed-height slot: a one-line message appears without moving the button. */}
        <p id="auth-error" role={error ? 'alert' : 'status'} className={cn('min-h-5 text-sm leading-5', error ? 'text-destructive' : 'text-success')}>
          {error?.text ?? notice}
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
              {first ? 'Creating account…' : recover ? 'Changing password…' : 'Signing in…'}
            </>
          ) : status === 'success' ? (
            <>
              <Check aria-hidden />
              Signed in
            </>
          ) : first ? (
            'Create account and sign in'
          ) : recover ? (
            'Change password'
          ) : (
            'Sign in'
          )}
        </Button>
        {!first && (
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => switchMode(recover ? 'login' : 'recover')}
          >
            {recover ? 'Back to sign in' : 'Forgot password?'}
          </button>
        )}
      </form>
    </>
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

function CommandLine({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="mt-1 flex items-center gap-1 rounded-lg bg-secondary py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] whitespace-nowrap text-foreground">{command}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() =>
          navigator.clipboard.writeText(command).then(
            () => {
              setState('copied');
              setTimeout(() => setState('idle'), 2000);
            },
            () => setState('failed'),
          )
        }
      >
        {state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select the text' : 'Copy'}</span>
      </Button>
    </div>
  );
}
