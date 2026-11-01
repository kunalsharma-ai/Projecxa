import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PROJEXA · Sampledge',
  description: 'Research project management and fieldwork automation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
