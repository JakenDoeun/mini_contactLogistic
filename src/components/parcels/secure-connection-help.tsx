'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, ShieldAlert, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchBranchAddresses } from '@/lib/branch-address';

/**
 * Shown when the page is not a secure context, so the camera cannot work. It explains the fix;
 * it never tries to get around the browser's rule.
 */
export function SecureConnectionHelp() {
  // Addresses are only known in the browser.
  const [where, setWhere] = useState<{ here: string; secure: string | null; setup: string | null } | null>(null);
  useEffect(() => {
    fetchBranchAddresses().then((a) => setWhere({ here: window.location.origin, ...a }));
  }, []);

  return (
    <div role="alert" className="rounded-md bg-warning-tint px-4 py-3 text-sm text-warning">
      <p className="flex items-start gap-2 font-medium">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        Camera scanning needs the branch&apos;s secure address
      </p>
      <div className="mt-1 space-y-3 pl-6 text-foreground">
        <p>
          {where && (
            <>
              This page is open at <span className="font-mono break-all">{where.here}</span>.{' '}
            </>
          )}
          Phone browsers only allow the camera on <span className="font-mono">https://</span> pages, so it stays off here. Typing the tracking
          code still works.
        </p>
        <div className="flex flex-wrap gap-2">
          {where?.secure && (
            <Button asChild size="sm">
              <a href={`${where.secure}/scan`}>
                Open the secure address
                <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            {/* Relative fallback: the app serves /setup wherever it runs. */}
            <a href={where?.setup ?? '/setup'}>
              <Smartphone aria-hidden />
              First time? Set up this phone
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
