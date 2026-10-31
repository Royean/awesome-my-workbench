import type { Metadata } from 'next';
export const metadata:Metadata={title:'知衡工作台',description:'健康与更多个人工作台',other:{'mobile-web-app-capable':'yes'},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'知衡',statusBarStyle:'default'},icons:{icon:'/app-icon-192.png',apple:'/app-icon-192.png'}};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f8faf8',interactiveWidget:'resizes-content'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}
