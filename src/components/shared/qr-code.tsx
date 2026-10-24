'use client';

import { useEffect, useRef } from 'react';
import { BrowserQRCodeSvgWriter } from '@zxing/browser';
import { useT } from '@/lib/i18n-react';

/** A QR code for `url`, drawn as SVG. White behind it whatever the theme: QR readers need dark-on-light. */
export function QrCode({ url }: { url: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const svg = new BrowserQRCodeSvgWriter().write(url, 200, 200);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('phoneCard.qr', { url }));
    box.current?.replaceChildren(svg);
  }, [url, t]);
  return <div ref={box} className="size-[200px] shrink-0 rounded-md border bg-white" />;
}
