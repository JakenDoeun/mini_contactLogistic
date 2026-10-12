'use client';

import { useState } from 'react';
import { Check, Copy, MessageSquare, Phone, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  composeMessage,
  eligibleForMessage,
  formatPhone,
  isValidPhone,
  normalizePhone,
  smsInFlight,
  smsScope,
  telegramLink,
  type ContactEvent,
  type Outcome,
  type Parcel,
} from '@/lib/parcel-logic';
import { queueSms, recordOutcome } from '@/lib/mock/parcel-service';
import { useSettings } from '@/lib/mock/use-settings';
import { cn } from '@/lib/utils';
import { SmsBadge } from './parcel-status';

const OUTCOMES: { channel: 'call' | 'telegram' | 'flag'; outcome: Outcome; label: string; saved: string }[] = [
  { channel: 'call', outcome: 'answered', label: 'Reached customer', saved: 'Saved: call reached the customer.' },
  { channel: 'call', outcome: 'no-answer', label: 'No answer', saved: 'Saved: call not answered.' },
  { channel: 'telegram', outcome: 'messaged', label: 'Sent on Telegram', saved: 'Saved: message sent on Telegram.' },
  { channel: 'flag', outcome: 'follow-up', label: 'Mark for follow-up', saved: 'Saved: marked for follow-up until someone reaches the customer.' },
];

/** Contact for everyone on one phone line. `parcel` supplies the name used in the greeting. */
export function ContactPanel({ parcel, group, events }: { parcel: Parcel; group: Parcel[]; events: ContactEvent[] }) {
  const templates = useSettings()?.templates;
  const [resend, setResend] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [note, setNote] = useState('');

  const eligible = eligibleForMessage(group, events);
  const codes = (resend ? group : eligible).map((p) => p.code);
  const notifiedBefore = group.length - eligible.length;
  const inFlight = smsInFlight(codes, events);
  const queued = events.find((e) => e.id === queuedId);
  const phone = normalizePhone(parcel.phone);

  const draftKey = `${parcel.recipient}|${codes.join(',')}|${templates?.single}|${templates?.combined}`;
  const [draft, setDraft] = useState({ key: draftKey, text: composeMessage(parcel.recipient, codes, templates) });
  // A different parcel set means a different message; edits to the old one no longer apply.
  if (draft.key !== draftKey) setDraft({ key: draftKey, text: composeMessage(parcel.recipient, codes, templates) });

  if (!isValidPhone(parcel.phone)) {
    return (
      <section aria-labelledby="contact-heading" className="rounded-md border bg-card px-4 py-4 sm:px-5">
        <h3 id="contact-heading" tabIndex={-1} className="scroll-mt-4 font-semibold outline-none">
          Contact
        </h3>
        <p className="mt-1 text-muted-foreground">
          Add a phone number above to message or call. Until then this parcel is left out of messages and phone groups.
        </p>
      </section>
    );
  }

  function send() {
    if (resend && !confirming) return setConfirming(true);
    setConfirming(false);
    setResend(false);
    setQueuedId(queueSms(parcel.phone, codes, draft.text).id);
  }

  return (
    <section aria-labelledby="contact-heading" className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-5">
        <h3 id="contact-heading" tabIndex={-1} className="scroll-mt-4 font-semibold outline-none">
          Contact {formatPhone(parcel.phone)}
        </h3>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{codes.length === 0 ? 'Nothing new to message' : smsScope(codes.length)}</p>
          <Badge variant="info">Simulated</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {codes.length === 0
            ? 'Every parcel on this number was messaged or reached already.'
            : notifiedBefore > 0 && !resend
              ? `${notifiedBefore} parcel${notifiedBefore === 1 ? ' was' : 's were'} messaged before, so ${notifiedBefore === 1 ? 'it is' : 'they are'} left out.`
              : 'One SMS, linked to every parcel it lists.'}
        </p>

        {codes.length > 0 && (
          <>
            <label htmlFor="sms-preview" className="mt-3 block text-xs text-muted-foreground">
              Message preview, edit before sending
            </label>
            <textarea
              id="sms-preview"
              value={draft.text}
              onChange={(e) => setDraft({ key: draftKey, text: e.target.value })}
              rows={4}
              className="mt-1 w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
            <p className="mt-1 text-right font-mono text-xs text-muted-foreground">{draft.text.length} characters</p>
          </>
        )}

        {notifiedBefore > 0 && (
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
            <input
              type="checkbox"
              checked={resend}
              onChange={(e) => {
                setResend(e.target.checked);
                setConfirming(false);
              }}
              className="size-4 accent-primary"
            />
            Include parcels that were already messaged
          </label>
        )}

        {confirming ? (
          <div role="alert" className="mt-3 rounded-md bg-warning-tint p-3 text-sm text-warning">
            <p className="font-medium">This customer has been messaged about some of these parcels already. Send again?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={send}>
                Send again
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={send} disabled={codes.length === 0 || inFlight || !draft.text.trim()}>
              <Send aria-hidden />
              Queue SMS
            </Button>
            {inFlight && <span className="text-sm text-muted-foreground">An SMS for these parcels is already waiting at the gateway.</span>}
          </div>
        )}

        <p aria-live="polite" className="text-sm">
          {queued && (
            <span className="mt-3 flex flex-wrap items-center gap-2">
              <SmsBadge status={queued.smsStatus!} />
              {queued.result}
            </span>
          )}
        </p>
      </div>

      <div className="border-t px-4 py-4 sm:px-5">
        <p className="font-medium">Or reach them directly</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`tel:${phone}`}>
              <Phone aria-hidden />
              Call
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={telegramLink(parcel.phone)} target="_blank" rel="noreferrer">
              <MessageSquare aria-hidden />
              Open Telegram
            </a>
          </Button>
          <CopyMessage text={draft.text || composeMessage(parcel.recipient, group.map((p) => p.code), templates)} />
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs text-muted-foreground">Record what happened, for {group.length === 1 ? 'this parcel' : `all ${group.length} parcels on this number`}</legend>
          <label htmlFor="contact-note" className="mt-1.5 block text-xs text-muted-foreground">
            Note (optional), saved with the attempt
          </label>
          <Input
            id="contact-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={160}
            placeholder="e.g. Number incorrect, or Will come on Friday"
            className="mt-1"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <Button
                key={o.outcome}
                size="sm"
                variant="outline"
                onClick={() => {
                  recordOutcome(parcel.phone, group.map((p) => p.code), o.channel, o.outcome, note.trim() || undefined);
                  setSaved(o.saved);
                  setNote('');
                }}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <p aria-live="polite" className={cn('text-sm text-success', saved && 'mt-2')}>
            {saved}
          </p>
        </fieldset>
      </div>
    </section>
  );
}

function CopyMessage({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="outline"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setState('copied');
            setTimeout(() => setState('idle'), 2000);
          },
          () => setState('failed'),
        )
      }
    >
      {state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy blocked, select the text' : 'Copy message'}</span>
    </Button>
  );
}
