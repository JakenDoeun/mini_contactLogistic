'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BranchOrigin, Check, CheckState, TailscaleStatus } from '@/lib/tailscale';

type Status = { tailscale: TailscaleStatus; origin: BranchOrigin; checks: Check[] };
type Tone = 'success' | 'warning' | 'destructive' | 'neutral';

/** Whether phones can reach the console securely right now, over Tailscale HTTPS (docs/deploy-tailscale.md). */
export function BranchReadiness() {
  const [status, setStatus] = useState<Status | 'checking' | 'failed'>('checking');

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      const res = await fetch('/api/branch-status', { cache: 'no-store' });
      setStatus(res.ok ? await res.json() : 'failed');
    } catch {
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const s = typeof status === 'object' ? status : null;
  const ready = !!s && s.checks.every((c) => c.state === 'ok');
  const problems = s?.checks.filter((c) => c.state === 'fail' || c.state === 'warn').length ?? 0;
  const loading = status === 'checking';

  return (
    <div className="mt-4 rounded-md border">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          Ready for phones?
          {s && !loading && (
            <Badge variant={ready ? 'success' : 'warning'}>{ready ? 'Yes, over Tailscale HTTPS' : `${problems} to fix`}</Badge>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={check} disabled={status === 'checking'}>
          <RefreshCw aria-hidden className={status === 'checking' ? 'animate-spin' : undefined} />
          Check again
        </Button>
      </div>
      <ul aria-live="polite" className="divide-y text-sm">
        {loading && !s ? (
          <Row label="Checking Tailscale" badge={null} loading>
            {null}
          </Row>
        ) : (
          s?.checks.map((c) => (
            <Row key={c.id} label={c.label} badge={CHECK_BADGE[c.state]} loading={loading}>
              <span className={c.id === 'magicdns' && c.state === 'ok' ? 'font-mono break-all text-foreground' : undefined}>{c.detail}</span>
              {c.fix && <span className="mt-1 block text-foreground">{c.fix}</span>}
            </Row>
          ))
        )}
      </ul>
      {status === 'failed' && <p className="border-t px-4 py-2.5 text-sm text-destructive">Could not check. Reload the page and try again.</p>}
    </div>
  );
}

const CHECK_BADGE: Record<CheckState, [string, Tone]> = {
  ok: ['OK', 'success'],
  warn: ['Check', 'warning'],
  fail: ['Needs fixing', 'destructive'],
  skip: ['Waiting', 'neutral'],
};

function Row({
  label,
  badge,
  loading,
  children,
}: {
  label: string;
  badge: [string, Tone] | null;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        {loading ? <Badge>Checking…</Badge> : badge && <Badge variant={badge[1]}>{badge[0]}</Badge>}
      </div>
      {!loading && <div className="mt-1 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{children}</div>}
    </li>
  );
}
