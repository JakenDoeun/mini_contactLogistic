'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { safeNextPath } from '@/lib/safe-next';
import { useT, type MessageKey } from '@/lib/i18n-react';

type Field = 'code' | 'username' | 'password' | 'confirm';
type Mode = 'login' | 'first_run' | 'recover';

const MESSAGES: Record<string, { key: MessageKey; field?: Field }> = {
  invalid_credentials: { key: 'auth.error.invalidCredentials', field: 'password' },
  bad_code: { key: 'auth.error.badCode', field: 'code' },
  bad_recovery: { key: 'auth.error.badRecovery', field: 'code' },
  account_exists: { key: 'auth.error.accountExists' },
  invalid_username: { key: 'auth.error.invalidUsername', field: 'username' },
  invalid_password: { key: 'auth.error.invalidPassword', field: 'password' },
  database_unavailable: { key: 'auth.error.databaseUnavailable' },
  cross_site: { key: 'auth.error.crossSite' },
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Sign-in form, or (mode="first_run") the form that creates the first account with the one-time code. From sign-in,
 * "Forgot password?" switches to the recovery form (new password with the recovery code from the office computer).
 */
export function AuthForm({ mode: initialMode, next }: { mode: 'login' | 'first_run'; next?: string }) {
  const t = useT();
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
    if (newPassword && data.password !== data.confirm) return fail({ text: t('auth.error.passwordsDiffer'), field: 'confirm' });
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
        setNotice(t('auth.passwordChanged'));
        return;
      }
      if (res.ok) {
        setStatus('success');
        window.location.assign(safeNextPath(next));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
      if (body.error === 'paused') return fail({ text: t('auth.error.paused', { seconds: body.retryAfter ?? 60 }) });
      const known = MESSAGES[body.error ?? ''];
      fail(known ? { text: t(known.key), field: known.field } : { text: t('auth.error.generic') });
    } catch {
      fail({ text: t('auth.error.offline') });
    }
  }

  const invalid = (name: Field) => (error?.field === name ? { 'aria-invalid': true, 'aria-describedby': 'auth-error' } : {});

  return (
    <>
      {!first && (
        <>
          <h1 ref={headingRef} tabIndex={-1} className="text-[1.375rem] leading-tight font-semibold tracking-tight outline-none">
            {recover ? t('auth.title.reset') : t('auth.title.signIn')}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {recover ? t('auth.lead.reset') : t('auth.lead.signIn')}
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
            <p>{t('auth.recover.where')}</p>
            <ol className="space-y-2">
              <li>
                {t('auth.recover.step1')}
                <CommandLine command="npm run recovery-code -- rotate" />
              </li>
              <li>
                {t('auth.recover.step2')}
                <CommandLine command="npm run recovery-code -- show" />
              </li>
            </ol>
          </div>
        )}
        {first && (
          <FormField label={t('auth.field.oneTimeCode')} name="code" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" className="font-mono tracking-wider" {...invalid('code')} />
        )}
        <FormField label={t('auth.field.username')} name="username" autoComplete="username" autoCapitalize="none" {...invalid('username')} />
        {recover && (
          <FormField label={t('auth.field.recoveryCode')} name="code" autoComplete="off" placeholder="XXXX-XXXX-…" autoCapitalize="characters" className="font-mono tracking-wider" {...invalid('code')} />
        )}
        <FormField
          label={recover ? t('auth.field.newPassword') : t('auth.field.password')}
          name="password"
          type="password"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 12 : undefined}
          {...invalid('password')}
        />
        {newPassword && <FormField label={t('auth.field.repeatPassword')} name="confirm" type="password" autoComplete="new-password" {...invalid('confirm')} />}
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
              {first ? t('auth.busy.creating') : recover ? t('auth.busy.changing') : t('auth.busy.signingIn')}
            </>
          ) : status === 'success' ? (
            <>
              <Check aria-hidden />
              {t('auth.done')}
            </>
          ) : first ? (
            t('auth.submit.create')
          ) : recover ? (
            t('auth.submit.change')
          ) : (
            t('auth.submit.signIn')
          )}
        </Button>
        {!first && (
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => switchMode(recover ? 'login' : 'recover')}
          >
            {recover ? t('auth.backToSignIn') : t('auth.forgot')}
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
  const t = useT();
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
        <span aria-live="polite">{state === 'copied' ? t('common.copied') : state === 'failed' ? t('common.selectText') : t('common.copy')}</span>
      </Button>
    </div>
  );
}
