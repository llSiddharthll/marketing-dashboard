/**
 * Dashboard home.
 *
 * The heading and chrome come from the shared layout, so this page renders only
 * its view. Being a real route means it can be linked, bookmarked and reached
 * with the browser's back button — none of which worked when every section was
 * a `activeTab` string in client state.
 */

import { DashboardHomeView } from '@/components/dashboard/DashboardHomeView';

export default function Page() {
  return <DashboardHomeView />;
}
