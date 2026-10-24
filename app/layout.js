import './globals.css';

export const metadata = { title: 'HCM Lite', description: 'AI-assisted Human Capital Management' };
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
