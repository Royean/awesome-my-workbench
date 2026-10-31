import type { Metadata } from 'next';
export const metadata:Metadata={title:'知衡 · 健康工作台',description:'私人的就医、锻炼、饮食和健康记录工作台',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}
