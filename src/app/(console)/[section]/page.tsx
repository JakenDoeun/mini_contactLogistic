import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NAV } from '@/components/shell/nav';

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
      <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
      <p className="mt-3 text-muted-foreground">
        This page is not built yet. Import Arrivals is ready to use now.
      </p>
      <Link href="/import-arrivals" className="mt-4 inline-block text-primary underline-offset-4 hover:underline">
        Go to Import Arrivals
      </Link>
    </div>
  );
}
