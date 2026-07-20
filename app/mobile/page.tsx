import MobileViewer from '../../components/MobileViewer';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Assembly Scheduler v91 Mobile Viewer',
  description: 'Read-only shop-floor mobile viewer with priorities, project health, warnings, and Smart Assign suggestions',
};

export default function MobilePage() {
  return <MobileViewer />;
}
