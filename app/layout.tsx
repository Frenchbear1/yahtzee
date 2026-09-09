import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Yahtzee Table — Every roll counts',description:'Your personal Yahtzee score sheet. Quick scoring, shared family tables, and every game night remembered.',icons:{icon:'/favicon.svg',apple:'/apple-touch-icon.png'},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Yahtzee Table',statusBarStyle:'default'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
