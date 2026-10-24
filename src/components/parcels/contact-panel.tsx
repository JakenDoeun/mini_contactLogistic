'use client';

import { useId, useState } from 'react';
import { CircleCheck, MessageSquare, Phone, PhoneMissed, ScanBarcode, Send, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  composeMessage,
  eligibleForMessage,
  eventsFor,
  isValidPhone,
  normalizePhone,
  smsInFlight,
  smsLink,
  smsStatusOf,
  telegramLink,
  type ContactEvent,
  type Outcome,
  type Parcel,
} from '@/lib/parcel-logic';
import { queueSms, recordOutcome } from '@/lib/parcel-service';
import { useSettings } from '@/lib/settings-service';
import { cn, formatTime } from '@/lib/utils';
import { SmsBadge } from './parcel-status';
import { useT, type MessageKey } from '@/lib/i18n-react';

/** The contact actions for everyone on one phone line: one SMS button, then Call and Telegram in their own part. */
export function ContactPanel({ parcel, group, events }: { parcel: Parcel; group: Parcel[]; events: ContactEvent[] }) {
  const t = useT();
  const templates = useSettings()?.templates;
  const [again, setAgain] = useState(false); // staff chose to message parcels that were messaged before
  const [editing, setEditing] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const eligible = eligibleForMessage(group, events);
  const codes = (again ? group : eligible).map((p) => p.code);
  const before = group.length - eligible.length;
  const inFlight = smsInFlight(codes, events);
  const queued = events.find((e) => e.id === queuedId);

  const draftKey = `${parcel.recipient}|${codes.join(',')}|${templates?.single}|${templates?.combined}`;
  const [draft, setDraft] = useState({ key: draftKey, text: composeMessage(parcel.recipient, codes, parcel.arrivalDate, templates) });
  // A different parcel set means a different message; edits to the old one no longer apply.
  if (draft.key !== draftKey) setDraft({ key: draftKey, text: composeMessage(parcel.recipient, codes, parcel.arrivalDate, templates) });
  const message = draft.text || composeMessage(parcel.recipient, group.map((p) => p.code), parcel.arrivalDate, templates);

  if (!isValidPhone(parcel.phone)) {
    return <p className="text-muted-foreground">{t('contact.addPhoneFirst')}</p>;
  }

  async function send() {
    setSending(true);
    setSendError('');
    try {
      setQueuedId(await queueSms(parcel.phone, codes, draft.text, { again }));
      setAgain(false);
      setEditing(false);
    } catch (e) {
      setSendError(t('contact.notSent', { error: (e as Error).message }));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {codes.length > 0 && (
        <div>
          {editing ? (
            <>
              <label htmlFor="sms-preview" className="text-xs text-muted-foreground">
                {t('contact.messageFor', { count: codes.length })}
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
                <span>{t('settings.sms.characters', { count: draft.text.length })}</span>
                <button type="button" onClick={() => setEditing(false)} className="min-h-11 font-medium text-primary sm:min-h-8">
                  {t('contact.done')}
                </button>
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('contact.messageFor', { count: codes.length })}</span>
                <button type="button" onClick={() => setEditing(true)} className="min-h-11 font-medium text-primary sm:min-h-8">
                  {t('contact.editMessage')}
                </button>
              </p>
              <p className="rounded-md bg-secondary px-3 py-2.5 text-sm whitespace-pre-line">{draft.text}</p>
            </>
          )}
          {again && (
            <p className="mt-2 text-sm text-warning">
              {before === group.length ? t('contact.againAll') : t('contact.againSome', { count: before })}
            </p>
          )}
        </div>
      )}

      {codes.length > 0 && (
        <Button onClick={send} disabled={inFlight || sending || !draft.text.trim()} className="self-start">
          <Send aria-hidden />
          {sending ? t('common.saving') : t(again ? 'contact.sendAgain' : 'contact.send', { count: codes.length })}
        </Button>
      )}

      {inFlight && <p className="-mt-2 text-sm text-muted-foreground">{t('contact.inFlight')}</p>}
      {before > 0 && !again && !inFlight && (
        <button type="button" onClick={() => setAgain(true)} className="-mt-2 min-h-11 self-start text-sm font-medium text-primary sm:min-h-8">
          {eligible.length > 0
            ? t('contact.include', { count: before })
            : group.some((p) => smsStatusOf(p.code, events) !== 'not-sent')
              ? t('contact.resend')
              : t('contact.anyway')}
        </button>
      )}
      {again && (
        <button type="button" onClick={() => setAgain(false)} className="-mt-2 min-h-11 self-start text-sm font-medium text-primary sm:min-h-8">
          {t('contact.cancelAgain')}
        </button>
      )}

      <div aria-live="polite" className="text-sm empty:hidden">
        {queued && (
          <p className="flex flex-wrap items-center gap-2">
            <SmsBadge status={queued.smsStatus!} />
            {queued.result}
          </p>
        )}
        {sendError && <p className="text-destructive">{sendError}</p>}
      </div>

      <DirectContact parcel={parcel} group={group} events={events} message={message} stops={eligible.length} />
    </div>
  );
}

// 'pick' is a call or message made outside the app, from another phone: staff say which first. 'sms' is an SMS sent
// from this device's own messaging app, outside the gateway phone (Phase 12).
type Asked = 'call' | 'telegram' | 'sms' | 'pick';
const ASK = {
  call: {
    question: 'contact.ask.call',
    options: [
      { outcome: 'answered', label: 'contact.ask.reached', Icon: CircleCheck, primary: true },
      { outcome: 'no-answer', label: 'contact.ask.noAnswer', Icon: PhoneMissed, primary: false },
    ],
    dismiss: 'contact.ask.didntCall',
  },
  telegram: {
    question: 'contact.ask.telegram',
    options: [{ outcome: 'messaged', label: 'contact.ask.yesSent', Icon: CircleCheck, primary: true }],
    dismiss: 'contact.ask.notSent',
  },
  sms: {
    question: 'contact.ask.sms',
    options: [{ outcome: 'messaged', label: 'contact.ask.yesSent', Icon: CircleCheck, primary: true }],
    dismiss: 'contact.ask.notSent',
  },
} as const;
const CHANNEL_OF = { call: 'call', telegram: 'telegram', sms: 'other' } as const;
// A segment of the compact group. On phones: an even quarter of the row, icon over a small label, 44 px tall, so four
// always fit; from sm: icon beside the label, a quieter 36 px.
const SEGMENT =
  'inline-flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none sm:min-h-9 sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0 sm:text-sm';
const DONE: Record<Outcome, [MessageKey, typeof Phone, string]> = {
  answered: ['contact.done.answered', CircleCheck, 'text-success'],
  'no-answer': ['contact.done.noAnswer', PhoneMissed, 'text-warning'],
  messaged: ['contact.done.messaged', MessageSquare, 'text-foreground'],
};

/**
 * Call, Telegram and an SMS from this device happen outside the app, so the card asks what happened right after, one
 * question at a time, and shows the latest answer so staff see at a glance whether someone already called.
 * Also used for each customer on Notifications › Contact by hand (Phase 12).
 */
export function DirectContact({
  parcel,
  group,
  events,
  message,
  stops,
  compact = false,
  onVerify,
  verifying = false,
  actionsOpen = false,
}: {
  parcel: Parcel;
  group: Parcel[];
  events: ContactEvent[];
  message: string;
  /** Parcels whose SMS a reached call would stop. */
  stops: number;
  /** In a list of customers (Contact by hand): no top rule, the heading for screen readers only. */
  compact?: boolean;
  /** Compact only: a Verify segment that opens the row's optional parcel check (owner, 2026-10-23). */
  onVerify?: () => void;
  verifying?: boolean;
  /** Compact on phones: the actions show only when the row is opened (the row owns the toggle). */
  actionsOpen?: boolean;
}) {
  const t = useT();
  const [asked, setAsked] = useState<Asked | null>(null);
  const [copied, setCopied] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const id = useId(); // several cards can share one page (Contact by hand)
  const last = eventsFor(parcel.code, events).find((e) => e.channel !== 'sms' && e.outcome);

  function telegram() {
    setAsked('telegram');
    // t.me cannot carry the text, so it goes on the clipboard on the way out.
    navigator.clipboard.writeText(message).then(
      () => setCopied(t('contact.copied')),
      () => setCopied(t('contact.copyBlocked')),
    );
  }

  async function answer(outcome: Outcome) {
    setSaving(true);
    setSaveError('');
    try {
      await recordOutcome(parcel.phone, group.map((p) => p.code), CHANNEL_OF[asked as keyof typeof CHANNEL_OF], outcome);
      setAsked(null);
      setCopied('');
    } catch (e) {
      setSaveError(t('common.notSaved', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  const ask = asked && asked !== 'pick' ? ASK[asked] : null;
  const [doneLabel, DoneIcon, doneTone] = !last
    ? []
    : last.channel === 'other'
      ? (['contact.done.other', Smartphone, 'text-foreground'] as const)
      : DONE[last.outcome!];

  return (
    <section aria-labelledby={`${id}-heading`} className={compact ? undefined : 'border-t pt-4'}>
      {/* In a list (compact) the row itself says when a call went unanswered; here only the parcel page shows it. */}
      <div className={compact ? 'sr-only' : 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'}>
        <h3 id={`${id}-heading`} className={compact ? undefined : 'text-sm font-medium'}>
          {t('contact.heading')}
        </h3>
        <p aria-live="polite" className="text-sm">
          {last ? (
            <span className={`inline-flex items-center gap-1.5 ${doneTone}`}>
              {DoneIcon && <DoneIcon className="size-4" aria-hidden />}
              {doneLabel && t(doneLabel)}
              <span className="font-mono text-xs text-muted-foreground">{formatTime(last.at, t.locale)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('contact.notContacted')}</span>
          )}
        </p>
      </div>

      {!asked && compact && (
        // One slim connected group per row, so a long list reads as phone numbers, not as rows of buttons.
        <div
          role="group"
          aria-label={t('contact.group', { phone: parcel.phone })}
          className={cn(
            'w-full divide-x overflow-hidden rounded-md border bg-card sm:inline-flex sm:w-auto',
            actionsOpen ? 'grid' : 'hidden', // phones: only when the row is opened; from sm always
            onVerify ? 'grid-cols-4' : 'grid-cols-3',
          )}
        >
          <a href={`tel:${normalizePhone(parcel.phone)}`} onClick={() => setAsked('call')} className={SEGMENT}>
            <Phone className="size-4" aria-hidden />
            {t('contact.call')}
          </a>
          <a href={telegramLink(parcel.phone)} target="_blank" rel="noreferrer" onClick={telegram} className={SEGMENT}>
            <MessageSquare className="size-4" aria-hidden />
            {t('contact.telegram')}
          </a>
          <a href={smsLink(parcel.phone, message)} onClick={() => setAsked('sms')} className={SEGMENT}>
            <Smartphone className="size-4" aria-hidden />
            {t('contact.sms')}
          </a>
          {onVerify && (
            <button type="button" aria-pressed={verifying} onClick={onVerify} className={cn(SEGMENT, verifying && 'bg-secondary')}>
              <ScanBarcode className="size-4" aria-hidden />
              {t('contact.verify')}
            </button>
          )}
        </div>
      )}

      {!asked && !compact && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:flex">
            <Button asChild variant="outline">
              <a href={`tel:${normalizePhone(parcel.phone)}`} onClick={() => setAsked('call')}>
                <Phone aria-hidden />
                {t('contact.call')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={telegramLink(parcel.phone)} target="_blank" rel="noreferrer" onClick={telegram}>
                <MessageSquare aria-hidden />
                {t('contact.telegram')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={smsLink(parcel.phone, message)} onClick={() => setAsked('sms')}>
                <Smartphone aria-hidden />
                {t('contact.sms')}
              </a>
            </Button>
          </div>
          <button type="button" onClick={() => setAsked('pick')} className="mt-1 min-h-11 text-left text-sm font-medium text-primary sm:min-h-8">
            {t('contact.otherPhone')}
          </button>
        </>
      )}

      {asked === 'pick' && (
        <div role="group" aria-labelledby={`${id}-pick`} className={cn('rounded-md bg-secondary px-3 py-3', !compact && 'mt-3')}>
          <p id={`${id}-pick`} className="font-medium">
            {t('contact.whatDid')}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:flex">
            <Button variant="outline" autoFocus onClick={() => setAsked('call')}>
              <Phone aria-hidden />
              {t('contact.called')}
            </Button>
            <Button variant="outline" onClick={() => setAsked('telegram')}>
              <MessageSquare aria-hidden />
              {t('contact.telegram')}
            </Button>
            <Button variant="outline" onClick={() => setAsked('sms')}>
              <Smartphone aria-hidden />
              {t('contact.sms')}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAsked(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      )}

      {ask && (
        <div
          role="group"
          aria-labelledby={`${id}-ask`}
          className={compact ? 'rounded-md bg-secondary px-3 py-3' : 'mt-3 rounded-md border-l-4 border-primary bg-secondary px-3 py-3'}
        >
          <p id={`${id}-ask`} className="font-medium">
            {t(ask.question)}
          </p>
          {asked === 'call' && stops > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">{t('contact.stops', { count: stops })}</p>
          )}
          {asked === 'telegram' && copied && <p className="mt-0.5 text-sm text-muted-foreground">{copied}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            {ask.options.map(({ outcome, label, Icon, primary }, i) => (
              <Button key={outcome} variant={primary ? 'default' : 'outline'} autoFocus={i === 0} disabled={saving} onClick={() => answer(outcome)}>
                <Icon aria-hidden />
                {t(label)}
              </Button>
            ))}
          </div>
          {saveError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {saveError}
            </p>
          )}
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAsked(null)}>
            {t(ask.dismiss)}
          </Button>
        </div>
      )}
    </section>
  );
}
