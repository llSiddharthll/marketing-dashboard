/**
 * Layout shared by every signed-in section.
 *
 * The `(dashboard)` route group means these pages share this chrome without the
 * word "dashboard" appearing in any URL. Putting the shell here rather than in
 * each page means the sidebar and header are not re-mounted on navigation, so
 * client state — a collapsed sidebar, a search term, the write queue — survives
 * moving between sections.
 */

import { AppShell } from '@/components/layout/AppShell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
