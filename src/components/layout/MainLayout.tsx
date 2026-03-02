import { Header } from "./Header"

interface MainLayoutProps {
    children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
    return (
        <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
            <Header />
            <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
        </div>
    )
}
