import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme';
import { BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'SampTrek · Sampledge',
  description: 'SampTrek by Sampledge. Projects on track: research project management and fieldwork automation.',
  applicationName: 'SampTrek',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme engine sets attributes and CSS variables on <html> before hydration.
    <html lang="en" data-theme="neon" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
