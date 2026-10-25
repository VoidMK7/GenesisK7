import type {Metadata} from 'next';import './globals.css';
export const metadata:Metadata={title:'NovaTrade AI — Market Intelligence',description:'Evidence-first, multi-market research and analysis. Analysis only.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
