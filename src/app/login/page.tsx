import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNextPath } from '@/lib/safe-next';
import { ensureFirstRunCode, FIRST_RUN_FILE } from '@/server/auth/accounts';
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-md border bg-card p-6">
        <p className="text-sm text-muted-foreground">Campus Branch</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{firstRun ? 'Create the first account' : 'Sign in'}</h1>
        {!db ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            The branch database is not ready. Ask the office to run <code>npm run db:migrate</code> and start the app again.
          </p>
        ) : firstRun ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              No account exists yet. On the office computer, open <code>{FIRST_RUN_FILE}</code> in the branch data folder and type
              the code below. The code works once.
            </p>
            <AuthForm mode="first_run" next={next} />
          </>
        ) : (
          <AuthForm mode="login" next={next} />
        )}
      </div>
    </main>
  );
}
