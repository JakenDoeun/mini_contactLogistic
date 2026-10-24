import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NAV } from '@/components/shell/nav';
import { serverT } from '@/lib/i18n-server';

export default async function NotBuiltPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const item = NAV.find((n) => n.href === `/${section}` && !n.built);
  if (!item) notFound();

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">{await serverT(item.label)}</h1>
      <p className="mt-3 text-muted-foreground">
        {await serverT('notBuilt.text')}
      </p>
      <Link href="/import-arrivals" className="mt-4 inline-block text-primary underline-offset-4 hover:underline">
        {await serverT('notBuilt.link')}
      </Link>
    </div>
  );
}
