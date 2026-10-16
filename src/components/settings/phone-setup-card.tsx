'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeSvgWriter } from '@zxing/browser';
import { fetchBranchAddresses } from '@/lib/branch-address';
import { BranchReadiness } from './branch-readiness';

/** A QR code for the phone setup page at the branch's Tailscale https address, to show on the office screen. */
export function PhoneSetupCard() {
  const qr = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetchBranchAddresses().then(({ setup }) => setUrl(setup));
  }, []);

  // The QR box only exists once the address is known.
  useEffect(() => {
    if (!url || !qr.current) return;
    const svg = new BrowserQRCodeSvgWriter().write(url, 200, 200);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `QR code for ${url}`);
    qr.current.replaceChildren(svg);
  }, [url]);

  return (
    <section aria-labelledby="phone-setup-heading" className="rounded-md border bg-card px-5 py-5 sm:px-6">
      <h2 id="phone-setup-heading" className="text-base font-semibold">
        Set up a staff phone
      </h2>
      <p className="mt-0.5 text-muted-foreground">
        Phones reach the console through this branch&apos;s Tailscale network, with a normal trusted certificate. Nothing to install apart
        from the Tailscale app.
      </p>
      <BranchReadiness />
      {url === null ? (
        <p className="mt-4 rounded-md bg-secondary px-4 py-3 text-sm">
          No phone address yet: the setup code appears here once Tailscale Serve shares the app (or BRANCH_URL is set). Fix the
          checks above, then reload.
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {/* White behind the code whatever the theme: QR readers need dark-on-light. */}
          <div ref={qr} className="size-[200px] shrink-0 rounded-md border bg-white" />
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Install the Tailscale app on the phone and sign in to this branch&apos;s tailnet. An admin may need to approve the phone.</li>
            <li>Turn Tailscale on. It works on any network, not only the branch Wi-Fi.</li>
            <li>Open the phone&apos;s Camera app, point it at this code, and tap the link.</li>
            {url && (
              <li className="list-none pt-1 text-sm text-muted-foreground">
                Or type <span className="font-mono text-foreground break-all">{url}</span>
              </li>
            )}
          </ol>
        </div>
      )}
    </section>
  );
}
