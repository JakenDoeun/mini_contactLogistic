import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { AuthForm } from '@/components/auth/auth-form';
import { ParcelJourney } from '@/components/auth/parcel-journey';
import { safeNextPath } from '@/lib/safe-next';
import { ensureFirstRunCode } from '@/server/auth/accounts';
import { dbOrNull } from '@/server/auth/guard';
import { pageUser } from '@/server/auth/page';
import { resolveDataDir } from '@/server/db/paths';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await pageUser();
  if (user && user !== 'unavailable') redirect(safeNextPath(next));
  const db = user === 'unavailable' ? null : dbOrNull();
  const firstRun = db ? ensureFirstRunCode(db, resolveDataDir()) !== null : false;

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Product identity: what the console does, shown as the parcel's journey. */}
      <section className="bg-sidebar px-5 pt-6 pb-5 text-white lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-12">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-[#9aa3f5] font-mono text-[11px] font-bold text-sidebar" aria-hidden>
              CB
            </span>
            Campus Branch
          </p>
          <p className="mt-5 hidden max-w-md text-[2rem] leading-[1.15] font-semibold tracking-tight text-balance lg:block">
            Every parcel, from scan to message.
          </p>
          <p className="mt-3 hidden max-w-md text-[15px] leading-relaxed text-sidebar-foreground lg:block">
            The branch console for arrivals, customer phones and SMS notices.
          </p>
        </div>
        <div className="mx-auto mt-4 w-full max-w-[340px] sm:max-w-[380px] lg:mt-10 lg:max-w-[520px]">
          <ParcelJourney />
        </div>
        <p className="mt-10 hidden text-xs text-sidebar-foreground lg:block">Internal use · reachable only on the branch network</p>
      </section>

      <section className="flex items-start justify-center px-4 py-8 sm:items-center lg:px-10">
        <div className="w-full max-w-[400px] rounded-2xl border bg-card p-6 shadow-[0_1px_2px_rgba(20,33,58,0.05),0_16px_40px_-20px_rgba(20,33,58,0.25)] sm:p-8">
          {!db ? (
            <>
              <h1 className="text-[1.375rem] leading-tight font-semibold tracking-tight">Sign in</h1>
              <p role="alert" className="mt-4 text-sm text-destructive">
                The branch database is not ready. Ask the office to run <code>npm run db:migrate</code> and start the app again.
              </p>
            </>
          ) : firstRun ? (
            <>
              <h1 className="text-[1.375rem] leading-tight font-semibold tracking-tight">Create the first account</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                No account exists yet. On the office computer, run <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[12px]">npm run first-run-code</code> in
                the project folder and type the code below. It works once.
              </p>
              <AuthForm mode="first_run" next={next} />
            </>
          ) : (
            // The form owns its heading: it switches between sign-in and password recovery in the browser.
            <AuthForm mode="login" next={next} />
          )}
          <p className="mt-6 flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden />
            Private to the branch. Sessions end after 7 days unused.
          </p>
        </div>
      </section>
    </main>
  );
}
