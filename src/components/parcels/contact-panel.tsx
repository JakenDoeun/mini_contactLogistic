'use client';

import { useState } from 'react';
import { CircleCheck, MessageSquare, Phone, PhoneMissed, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  composeMessage,
  eligibleForMessage,
  eventsFor,
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
import { formatTime } from '@/lib/utils';
import { SmsBadge } from './parcel-status';

const parcels = (n: number) => `${n} parcel${n === 1 ? '' : 's'}`;

/** The contact actions for everyone on one phone line: one SMS button, then Call and Telegram in their own part. */
export function ContactPanel({ parcel, group, events }: { parcel: Parcel; group: Parcel[]; events: ContactEvent[] }) {
  const templates = useSettings()?.templates;
  const [again, setAgain] = useState(false); // staff chose to message parcels that were messaged before
  const [editing, setEditing] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);

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

      {codes.length > 0 && (
        <Button onClick={send} disabled={inFlight || !draft.text.trim()} className="self-start">
          <Send aria-hidden />
          {again ? 'Send again' : 'Send SMS'} · {parcels(codes.length)}
        </Button>
      )}

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

      <div aria-live="polite" className="text-sm empty:hidden">
        {queued && (
          <p className="flex flex-wrap items-center gap-2">
            <SmsBadge status={queued.smsStatus!} />
            {queued.result}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Simulated: no SMS leaves this device until the gateway is connected.</p>

      <DirectContact parcel={parcel} group={group} events={events} message={message} stops={eligible.length} />
    </div>
  );
}

// 'pick' is a call or Telegram message made outside the app, from another phone: staff say which first.
type Asked = 'call' | 'telegram' | 'pick';
const ASK = {
  call: {
    question: 'Did the customer answer?',
    options: [
      { outcome: 'answered', label: 'Reached', Icon: CircleCheck, primary: true },
      { outcome: 'no-answer', label: 'No answer', Icon: PhoneMissed, primary: false },
    ],
    dismiss: "Didn't call",
  },
  telegram: {
    question: 'Did you send the message on Telegram?',
    options: [{ outcome: 'messaged', label: 'Yes, sent', Icon: CircleCheck, primary: true }],
    dismiss: 'Not sent',
  },
} as const;
const DONE: Record<Outcome, [string, typeof Phone, string]> = {
  answered: ['Reached by call', CircleCheck, 'text-success'],
  'no-answer': ['Called, no answer', PhoneMissed, 'text-warning'],
  messaged: ['Sent on Telegram', MessageSquare, 'text-foreground'],
};

/**
 * Call and Telegram happen outside the app, so the card asks what happened right after, one question at a time,
 * and shows the latest answer so staff see at a glance whether someone already called.
 */
function DirectContact({
  parcel,
  group,
  events,
  message,
  stops,
}: {
  parcel: Parcel;
  group: Parcel[];
  events: ContactEvent[];
  message: string;
  /** Parcels whose SMS a reached call would stop. */
  stops: number;
}) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [copied, setCopied] = useState('');
  const last = eventsFor(parcel.code, events).find((e) => e.channel !== 'sms' && e.outcome);

  function telegram() {
    setAsked('telegram');
    // t.me cannot carry the text, so it goes on the clipboard on the way out.
    navigator.clipboard.writeText(message).then(
      () => setCopied('Message copied. Paste it into the chat.'),
      () => setCopied('Copy was blocked. Select the message above and copy it.'),
    );
  }

  function answer(outcome: Outcome) {
    recordOutcome(parcel.phone, group.map((p) => p.code), asked === 'telegram' ? 'telegram' : 'call', outcome);
    setAsked(null);
    setCopied('');
  }

  const ask = asked === 'call' || asked === 'telegram' ? ASK[asked] : null;
  const [doneLabel, DoneIcon, doneTone] = last ? DONE[last.outcome!] : [];

  return (
    <section aria-labelledby="direct-heading" className="border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="direct-heading" className="text-sm font-medium">
          Call or Telegram
        </h3>
        <p aria-live="polite" className="text-sm">
          {last ? (
            <span className={`inline-flex items-center gap-1.5 ${doneTone}`}>
              {DoneIcon && <DoneIcon className="size-4" aria-hidden />}
              {doneLabel}
              <span className="font-mono text-xs text-muted-foreground">{formatTime(last.at)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Not called yet</span>
          )}
        </p>
      </div>

      {!asked && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <Button asChild variant="outline">
              <a href={`tel:${normalizePhone(parcel.phone)}`} onClick={() => setAsked('call')}>
                <Phone aria-hidden />
                Call
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={telegramLink(parcel.phone)} target="_blank" rel="noreferrer" onClick={telegram}>
                <MessageSquare aria-hidden />
                Telegram
              </a>
            </Button>
          </div>
          <button type="button" onClick={() => setAsked('pick')} className="mt-1 min-h-11 text-sm font-medium text-primary sm:min-h-8">
            Called or messaged from another phone? Record it
          </button>
        </>
      )}

      {asked === 'pick' && (
        <div role="group" aria-labelledby="pick-question" className="mt-3 rounded-md bg-secondary px-3 py-3">
          <p id="pick-question" className="font-medium">
            What did you do?
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" autoFocus onClick={() => setAsked('call')}>
              <Phone aria-hidden />
              Called
            </Button>
            <Button variant="outline" onClick={() => setAsked('telegram')}>
              <MessageSquare aria-hidden />
              Telegram
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAsked(null)}>
            Cancel
          </Button>
        </div>
      )}

      {ask && (
        <div role="group" aria-labelledby="ask-question" className="mt-3 rounded-md border-l-4 border-primary bg-secondary px-3 py-3">
          <p id="ask-question" className="font-medium">
            {ask.question}
          </p>
          {asked === 'call' && stops > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">Reached stops the SMS for {parcels(stops)}, so nobody is told twice.</p>
          )}
          {asked === 'telegram' && copied && <p className="mt-0.5 text-sm text-muted-foreground">{copied}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            {ask.options.map(({ outcome, label, Icon, primary }, i) => (
              <Button key={outcome} variant={primary ? 'default' : 'outline'} autoFocus={i === 0} onClick={() => answer(outcome)}>
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAsked(null)}>
            {ask.dismiss}
          </Button>
        </div>
      )}
    </section>
  );
}
