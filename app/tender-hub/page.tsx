import type { Metadata } from 'next';
import TenderHub from './TenderHub';
import { tenderHubEnabled } from './feature-access';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'EstimaPro — Local Tender Hub', robots: { index: false, follow: false } };
export default function Page() {
    if (!tenderHubEnabled())
        return <main style={{ padding: 32 }}><h1>Tender Hub disabled</h1><p>Enable Estimation and Tender Hub in Settings → Modules &amp; Features.</p><a href="/">Open existing application</a></main>;
    return <TenderHub />;
}
