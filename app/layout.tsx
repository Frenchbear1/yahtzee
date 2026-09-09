import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Yahtzee',applicationName:'Yahtzee',description:'Your personal Yahtzee score sheet. Quick scoring, shared family tables, and every game night remembered.',icons:{icon:[{url:'/favicon.svg',type:'image/svg+xml'},{url:'/icons/favicon-32.png',sizes:'32x32',type:'image/png'}],apple:[{url:'/apple-touch-icon.png',sizes:'180x180',type:'image/png'}]},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Yahtzee',statusBarStyle:'default'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#245748'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
