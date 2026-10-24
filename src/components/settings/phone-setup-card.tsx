'use client';

import { useEffect, useState } from 'react';
import { QrCode } from '@/components/shared/qr-code';
import { fetchBranchAddresses } from '@/lib/branch-address';
import { BranchReadiness } from './branch-readiness';
import { useT } from '@/lib/i18n-react';

/** A QR code for the phone setup page at the branch's Tailscale https address, to show on the office screen. */
export function PhoneSetupCard() {
  const t = useT();
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetchBranchAddresses().then(({ setup }) => setUrl(setup));
  }, []);

  return (
    <section aria-labelledby="phone-setup-heading" className="rounded-md border bg-card px-5 py-5 sm:px-6">
      <h2 id="phone-setup-heading" className="text-base font-semibold">
        {t('phoneCard.title')}
      </h2>
      <p className="mt-0.5 text-muted-foreground">
        {t('phoneCard.lead')}
      </p>
      <BranchReadiness />
      {url === null ? (
        <p className="mt-4 rounded-md bg-secondary px-4 py-3 text-sm">
          {t('phoneCard.noAddress')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {url ? <QrCode url={url} /> : <div className="size-[200px] shrink-0 rounded-md border bg-white" />}
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>{t('phoneCard.step1')}</li>
            <li>{t('phoneCard.step2')}</li>
            <li>{t('phoneCard.step3')}</li>
            {url && (
              <li className="list-none pt-1 text-sm text-muted-foreground">
                {t.rich('phoneCard.orType', { url: <span className="font-mono text-foreground break-all">{url}</span> })}
              </li>
            )}
          </ol>
        </div>
      )}
    </section>
  );
}
