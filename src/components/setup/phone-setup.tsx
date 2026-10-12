'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, Download, Loader, ScanBarcode, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchBranchAddresses, trustsBranchCertificate, type BranchMode } from '@/lib/branch-address';
import { cn } from '@/lib/utils';

type Platform = 'iphone' | 'android';
type Check = 'idle' | 'checking' | 'ok' | 'failed';

function detectPlatform(): { platform: Platform; notSafari: boolean } {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return { platform: ios ? 'iphone' : 'android', notSafari: ios && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) };
}

const STEPS: Record<Platform, { title: string; body: React.ReactNode }[]> = {
  iphone: [
    { title: 'Download the certificate', body: 'Tap the button below, then tap Allow. Safari says the profile was downloaded.' },
    {
      title: 'Install it',
      body: (
        <>
          Open the <b>Settings</b> app. Near the top, tap <b>Profile Downloaded</b>, then <b>Install</b>. Enter your passcode and tap
          <b> Install</b> again.
        </>
      ),
    },
    {
      title: 'Turn on trust',
      body: (
        <>
          In Settings go to <b>General › About</b>, scroll to the bottom, tap <b>Certificate Trust Settings</b> and turn on
          <b> Caddy Local Authority</b>. This step is easy to miss.
        </>
      ),
    },
    { title: 'Come back and check', body: 'Return to this page and tap Check my phone.' },
  ],
  android: [
    { title: 'Download the certificate', body: 'Tap the button below in Chrome. It is saved to Downloads.' },
    {
      title: 'Install it',
      body: (
        <>
          Open <b>Settings</b> and search for <b>CA certificate</b>. Tap <b>Install a certificate › CA certificate</b>, tap
          <b> Install anyway</b>, and choose <b>branch-ca.crt</b>. Android warns that the network may be monitored: that is its standard
          message for any added certificate.
        </>
      ),
    },
    { title: 'Come back and check', body: 'Return to this page in Chrome and tap Check my phone.' },
  ],
};

// Tailscale: the certificate is publicly trusted, so the only setup is joining the branch tailnet.
const TAILSCALE_STEPS: Record<Platform, { title: string; body: React.ReactNode }[]> = {
  iphone: [
    { title: 'Install Tailscale', body: <>Get the <b>Tailscale</b> app from the App Store.</> },
    {
      title: 'Sign in to the branch network',
      body: 'Use the account the branch admin gave you. If the app says the device needs approval, ask the admin to approve it.',
    },
    { title: 'Turn it on', body: <>In the Tailscale app, switch it on until it shows <b>Connected</b>. It works on any Wi-Fi or mobile data.</> },
    { title: 'Come back and check', body: 'Return to this page and tap Check my phone.' },
  ],
  android: [
    { title: 'Install Tailscale', body: <>Get the <b>Tailscale</b> app from Google Play.</> },
    {
      title: 'Sign in to the branch network',
      body: 'Use the account the branch admin gave you. If the app says the device needs approval, ask the admin to approve it.',
    },
    {
      title: 'Turn it on',
      body: (
        <>
          Switch it on and allow the VPN connection Android asks about, until it shows <b>Connected</b>.
        </>
      ),
    },
    { title: 'Come back and check', body: 'Return to this page and tap Check my phone.' },
  ],
};

export function PhoneSetup() {
  const [origin, setOrigin] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>('android');
  const [notSafari, setNotSafari] = useState(false);
  const [check, setCheck] = useState<Check>('idle');
  const [mode, setMode] = useState<BranchMode>('lan');
  const tailscale = mode === 'tailscale';

  async function runCheck(o = origin) {
    if (!o) return;
    setCheck('checking');
    setCheck((await trustsBranchCertificate(o)) ? 'ok' : 'failed');
  }

  useEffect(() => {
    const d = detectPlatform();
    setPlatform(d.platform);
    setNotSafari(d.notSafari);
    fetchBranchAddresses().then(({ secure: o, mode: m }) => {
      setOrigin(o);
      setMode(m);
      // Already opened securely: with Tailscale, opening the branch address at all proves the phone is connected.
      if (window.location.protocol === 'https:' && (m === 'lan' || window.location.origin === o)) return setCheck('ok');
      // Typing just the office address lands here; a phone that is already set up goes straight on.
      if (o && new URLSearchParams(window.location.search).has('auto')) {
        trustsBranchCertificate(o).then((ok) => (ok ? window.location.replace(`${o}/scan`) : setCheck('idle')));
      }
    });
  }, []);

  const steps = (tailscale ? TAILSCALE_STEPS : STEPS)[platform];

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <p className="text-sm text-muted-foreground">Campus Branch · Parcel operations</p>
      <h1 className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight">Set up this phone</h1>
      <p className="mt-2 text-muted-foreground">
        {tailscale
          ? 'Do this once per phone. Afterwards the phone opens the console securely and its camera can scan parcel barcodes.'
          : 'Do this once per phone, on the branch Wi-Fi. Afterwards the phone camera can scan parcel barcodes. It takes about two minutes.'}
      </p>

      {check === 'ok' ? (
        <Ready origin={origin} tailscale={tailscale} />
      ) : (
        <>
          <div role="group" aria-label="Phone type" className="mt-6 grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
            {(['iphone', 'android'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={platform === p}
                onClick={() => setPlatform(p)}
                className={cn('h-11 rounded-sm text-sm font-medium', platform === p ? 'bg-card text-foreground' : 'text-muted-foreground')}
              >
                {p === 'iphone' ? 'iPhone or iPad' : 'Android'}
              </button>
            ))}
          </div>

          {!tailscale && notSafari && platform === 'iphone' && (
            <p role="alert" className="mt-4 rounded-md bg-warning-tint px-4 py-3 text-sm text-warning">
              Open this page in <b>Safari</b>. iPhones only install certificates from Safari.
            </p>
          )}

          <ol className="mt-6 space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="mt-0.5 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{s.body}</p>
                  {i === 0 && !tailscale && (
                    <Button asChild className="mt-3 h-12 w-full">
                      {/* No download attribute: iPhone Safari must open it to offer the profile install. */}
                      <a href="/branch-ca.crt">
                        <Download aria-hidden />
                        Download certificate
                      </a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-md border bg-card p-4">
            <Button className="h-12 w-full" onClick={() => runCheck()} disabled={!origin || check === 'checking'}>
              {check === 'checking' ? <Loader className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {check === 'checking' ? 'Checking…' : 'Check my phone'}
            </Button>
            <div aria-live="polite" className="text-sm">
              {check === 'failed' && (
                <p className="mt-3 flex items-start gap-2 text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Not set up yet.{' '}
                    {tailscale
                      ? 'Check that Tailscale shows Connected on this phone and that the admin approved it. The office computer must be on.'
                      : platform === 'iphone'
                        ? 'Most often the last switch is off: Settings › General › About › Certificate Trust Settings.'
                        : 'Check that the certificate was installed as a CA certificate, and that you are using Chrome.'}{' '}
                    {!tailscale && 'Also make sure the phone is on the branch Wi-Fi.'}
                  </span>
                </p>
              )}
              {!origin && (
                <p className="mt-3 text-muted-foreground">
                  No secure address yet. Open this page from the office computer&apos;s address (not localhost), and make sure Caddy is
                  running there.
                </p>
              )}
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Stuck? Ask the branch admin. Typing tracking codes works without this setup.</p>
        </>
      )}
    </main>
  );
}

function Ready({ origin, tailscale }: { origin: string | null; tailscale: boolean }) {
  return (
    <div className="mt-6 rounded-md border bg-card p-5">
      <p className="flex items-center gap-2 font-semibold text-success">
        <CircleCheck className="size-5" aria-hidden />
        This phone is ready
      </p>
      <p className="mt-1 text-muted-foreground">
        {tailscale ? 'Connected through the branch Tailscale network. ' : ''}The camera can now scan parcel barcodes. Allow the camera when the
        browser asks.
      </p>
      {origin && (
        <Button asChild className="mt-4 h-12 w-full">
          <a href={`${origin}/scan`}>
            <ScanBarcode aria-hidden />
            Open Scan Parcel
          </a>
        </Button>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        Tip: once it opens, add it to the Home Screen. iPhone: Share › Add to Home Screen. Android: the ⋮ menu › Add to Home screen.
      </p>
    </div>
  );
}
