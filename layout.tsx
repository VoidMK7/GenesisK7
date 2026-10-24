import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'NovaTrade — Intelligent Trading Workspace', description: 'Research-first trading workspace with market monitoring, strategy testing and risk controls.', applicationName: 'NovaTrade' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#080b12' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
