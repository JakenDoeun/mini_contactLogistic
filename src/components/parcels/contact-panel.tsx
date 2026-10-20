'use client';

import { useState } from 'react';
import { MessageSquare, Phone, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  composeMessage,
  eligibleForMessage,
  isValidPhone,
  normalizePhone,
  smsInFlight,
  smsStatusOf,
  telegramLink,
  type ContactEvent,
  type Outcome,
  type Parcel,
} from '@/lib/parcel-logic';
import { queueSms, recordOutcome } from '@/lib/mock/parcel-service';
import { useSettings } from '@/lib/mock/use-settings';
import { SmsBadge } from './parcel-status';

// 'record' is a call or Telegram message made outside the app, from another phone or typed in by hand.
type Asked = 'call' | 'telegram' | 'record';
const CALL = [
  { channel: 'call', outcome: 'answered', label: 'Reached', saved: 'Saved: call reached the customer.' },
  { channel: 'call', outcome: 'no-answer', label: 'No answer', saved: 'Saved: call not answered.' },
] as const;
const TELEGRAM = [{ channel: 'telegram', outcome: 'messaged', label: 'Sent on Telegram', saved: 'Saved: message sent on Telegram.' }] as const;
const OUTCOMES: Record<Asked, readonly { channel: 'call' | 'telegram'; outcome: Outcome; label: string; saved: string }[]> = {
  call: CALL,
  telegram: TELEGRAM,
  record: [...CALL, ...TELEGRAM],
};
const QUESTION: Record<Asked, string> = { call: 'How did the call go?', telegram: 'Did you send it?', record: 'What happened?' };

const parcels = (n: number) => `${n} parcel${n === 1 ? '' : 's'}`;

/**
 * The contact actions for everyone on one phone line, kept short: one SMS button, Call and Telegram.
 * What happened is asked only after a call or a Telegram message, so the card is not a wall of buttons.
 */
export function ContactPanel({ parcel, group, events }: { parcel: Parcel; group: Parcel[]; events: ContactEvent[] }) {
  const templates = useSettings()?.templates;
  const [again, setAgain] = useState(false); // staff chose to message parcels that were messaged before
  const [editing, setEditing] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [said, setSaid] = useState('');

  const eligible = eligibleForMessage(group, events);
  const codes = (again ? group : eligible).map((p) => p.code);
  const before = group.length - eligible.length;
  const inFlight = smsInFlight(codes, events);
  const queued = events.find((e) => e.id === queuedId);

  const draftKey = `${parcel.recipient}|${codes.join(',')}|${templates?.single}|${templates?.combined}`;
  const [draft, setDraft] = useState({ key: draftKey, text: composeMessage(parcel.recipient, codes, templates) });
  // A different parcel set means a different message; edits to the old one no longer apply.
  if (draft.key !== draftKey) setDraft({ key: draftKey, text: composeMessage(parcel.recipient, codes, templates) });
  const message = draft.text || composeMessage(parcel.recipient, group.map((p) => p.code), templates);

  if (!isValidPhone(parcel.phone)) {
    return <p className="text-muted-foreground">Add a phone number above to message or call. Until then this parcel is left out of messages.</p>;
  }

  function send() {
    setQueuedId(queueSms(parcel.phone, codes, draft.text).id);
    setAgain(false);
    setEditing(false);
  }

  function telegram() {
    setAsked('telegram');
    // t.me cannot carry the text, so it goes on the clipboard on the way out.
    navigator.clipboard.writeText(message).then(
      () => setSaid('Message copied. Paste it into the chat.'),
      () => setSaid('Copy was blocked. Select the message above and copy it.'),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {codes.length > 0 && (
        <div>
          {editing ? (
            <>
              <label htmlFor="sms-preview" className="text-xs text-muted-foreground">
                Message for {parcels(codes.length)}
              </label>
              <textarea
                id="sms-preview"
                value={draft.text}
                onChange={(e) => setDraft({ key: draftKey, text: e.target.value })}
                rows={4}
                autoFocus
                className="mt-1 w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-base sm:text-sm"
              />
              <p className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{draft.text.length} characters</span>
                <button type="button" onClick={() => setEditing(false)} className="min-h-11 font-medium text-primary sm:min-h-8">
                  Done
                </button>
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Message for {parcels(codes.length)}</span>
                <button type="button" onClick={() => setEditing(true)} className="min-h-11 font-medium text-primary sm:min-h-8">
                  Edit message
                </button>
              </p>
              <p className="rounded-md bg-secondary px-3 py-2.5 text-sm">{draft.text}</p>
            </>
          )}
          {again && (
            <p className="mt-2 text-sm text-warning">
              {before === group.length ? 'All of these were' : `${before} of these ${before === 1 ? 'was' : 'were'}`} messaged before. The customer gets
              them again.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {codes.length > 0 && (
          <Button onClick={send} disabled={inFlight || !draft.text.trim()} className="h-11 sm:h-10">
            <Send aria-hidden />
            {again ? 'Send again' : 'Send SMS'} · {parcels(codes.length)}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button asChild variant="outline" className="h-11 sm:h-10">
            <a href={`tel:${normalizePhone(parcel.phone)}`} onClick={() => setAsked('call')}>
              <Phone aria-hidden />
              Call
            </a>
          </Button>
          <Button asChild variant="outline" className="h-11 sm:h-10">
            <a href={telegramLink(parcel.phone)} target="_blank" rel="noreferrer" onClick={telegram}>
              <MessageSquare aria-hidden />
              Telegram
            </a>
          </Button>
        </div>
      </div>

      {inFlight && <p className="-mt-2 text-sm text-muted-foreground">An SMS for these parcels is already waiting at the gateway.</p>}
      {before > 0 && !again && !inFlight && (
        <button type="button" onClick={() => setAgain(true)} className="-mt-2 min-h-11 self-start text-sm font-medium text-primary sm:min-h-8">
          {eligible.length > 0
            ? `Include the ${before} messaged or reached before`
            : group.some((p) => smsStatusOf(p.code, events) !== 'not-sent')
              ? 'Send the SMS again'
              : 'Send an SMS anyway'}
        </button>
      )}
      {again && (
        <button type="button" onClick={() => setAgain(false)} className="-mt-2 min-h-11 self-start text-sm font-medium text-primary sm:min-h-8">
          Cancel sending again
        </button>
      )}

      {!asked && (
        <button type="button" onClick={() => setAsked('record')} className="-mt-2 min-h-11 self-start text-sm font-medium text-primary sm:min-h-8">
          Called or messaged already? Record it
        </button>
      )}

      {asked && (
        <fieldset className="rounded-md bg-secondary px-3 py-3">
          <legend className="sr-only">What happened</legend>
          <p aria-hidden className="text-sm font-medium">
            {QUESTION[asked]}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {OUTCOMES[asked].map((o) => (
              <Button
                key={o.outcome}
                size="sm"
                variant="outline"
                className="bg-card"
                onClick={() => {
                  recordOutcome(parcel.phone, group.map((p) => p.code), o.channel, o.outcome);
                  setSaid(o.saved);
                  setAsked(null);
                }}
              >
                {o.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setAsked(null)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}

      <div aria-live="polite" className="text-sm empty:hidden">
        {queued && (
          <p className="flex flex-wrap items-center gap-2">
            <SmsBadge status={queued.smsStatus!} />
            {queued.result}
          </p>
        )}
        {said && <p className="text-success">{said}</p>}
      </div>

      <p className="text-xs text-muted-foreground">Simulated: no SMS leaves this device until the gateway is connected.</p>
    </div>
  );
}
