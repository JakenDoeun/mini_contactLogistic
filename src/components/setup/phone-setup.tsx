'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, Loader, ScanBarcode, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchBranchAddresses, reachesBranch } from '@/lib/branch-address';
import { useT } from '@/lib/i18n-react';
import { cn } from '@/lib/utils';

type Platform = 'iphone' | 'android';
type Check = 'idle' | 'checking' | 'ok' | 'failed';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iphone' : 'android';
}

// The certificate is publicly trusted, so the only setup is joining the branch tailnet.
function steps(platform: Platform, t: ReturnType<typeof useT>): { title: string; body: React.ReactNode }[] {
  const connected = <b>{t('setup.step.connected')}</b>;
  return [
    { title: t('setup.step.install'), body: t.rich(platform === 'iphone' ? 'setup.step.installIphone' : 'setup.step.installAndroid', { app: <b>Tailscale</b> }) },
    { title: t('setup.step.signIn'), body: t('setup.step.signInText') },
    { title: t('setup.step.turnOn'), body: t.rich(platform === 'iphone' ? 'setup.step.turnOnIphone' : 'setup.step.turnOnAndroid', { connected }) },
    { title: t('setup.step.check'), body: t('setup.step.checkText') },
  ];
}

export function PhoneSetup() {
  const t = useT();
  const [origin, setOrigin] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>('android');
  const [check, setCheck] = useState<Check>('idle');

  async function runCheck(o = origin) {
    if (!o) return;
    setCheck('checking');
    setCheck((await reachesBranch(o)) ? 'ok' : 'failed');
  }

  useEffect(() => {
    setPlatform(detectPlatform());
    fetchBranchAddresses().then(({ secure: o }) => {
      setOrigin(o);
      // Opening the branch address at all proves the phone is connected to the tailnet.
      if (window.location.origin === o) setCheck('ok');
    });
  }, []);

  const list = steps(platform, t);

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <p className="text-sm text-muted-foreground">
        {t('brand.name')} · {t('brand.tagline')}
      </p>
      <h1 className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight">{t('setup.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('setup.lead')}</p>

      {check === 'ok' ? (
        <Ready origin={origin} />
      ) : (
        <>
          <div role="group" aria-label={t('setup.phoneType')} className="mt-6 grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
            {(['iphone', 'android'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={platform === p}
                onClick={() => setPlatform(p)}
                className={cn('h-11 rounded-sm text-sm font-medium', platform === p ? 'bg-card text-foreground' : 'text-muted-foreground')}
              >
                {p === 'iphone' ? t('setup.iphone') : t('setup.android')}
              </button>
            ))}
          </div>

          <ol className="mt-6 space-y-5">
            {list.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="mt-0.5 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-md border bg-card p-4">
            <Button className="h-12 w-full" onClick={() => runCheck()} disabled={!origin || check === 'checking'}>
              {check === 'checking' ? <Loader className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {check === 'checking' ? t('setup.checking') : t('setup.checkMyPhone')}
            </Button>
            <div aria-live="polite" className="text-sm">
              {check === 'failed' && (
                <p className="mt-3 flex items-start gap-2 text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{t('setup.notSetUp')}</span>
                </p>
              )}
              {!origin && (
                <p className="mt-3 text-muted-foreground">{t('setup.noAddress')}</p>
              )}
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t('setup.stuck')}</p>
        </>
      )}
    </main>
  );
}

function Ready({ origin }: { origin: string | null }) {
  const t = useT();
  return (
    <div className="mt-6 rounded-md border bg-card p-5">
      <p className="flex items-center gap-2 font-semibold text-success">
        <CircleCheck className="size-5" aria-hidden />
        {t('setup.ready')}
      </p>
      <p className="mt-1 text-muted-foreground">{t('setup.readyText')}</p>
      {origin && (
        <Button asChild className="mt-4 h-12 w-full">
          <a href={`${origin}/scan`}>
            <ScanBarcode aria-hidden />
            {t('setup.openScan')}
          </a>
        </Button>
      )}
      <p className="mt-4 text-sm text-muted-foreground">{t('setup.tip')}</p>
    </div>
  );
}
