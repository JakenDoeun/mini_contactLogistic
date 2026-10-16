import { Header } from '@/components/shell/header';
import { Brand, SidebarNav } from '@/components/shell/sidebar-nav';
import { requirePageUser } from '@/server/auth/page';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 bg-sidebar lg:block">
        <Brand />
        <SidebarNav />
      </aside>
      <Header username={user.username} />
      <main className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
