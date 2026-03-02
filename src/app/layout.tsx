import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MainLayout } from "@/components/layout/MainLayout";
import { SSEProvider } from "@/providers/SSEProvider";
import { PrivyProvider } from "@/providers/PrivyProvider";
import { PositionsProvider } from "@/providers/PositionsProvider";
import { SpotPricesProvider } from "@/providers/SpotPricesProvider";
import { AppInitializer } from "@/components/AppInitializer";
// import { BotCommandListener } from "@/components/BotCommandListener";
import { SignalRequestListener } from "@/components/SignalRequestListener";
// import { BotProvider } from "@/components/providers/BotProvider";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trading Terminal",
  description: "Advanced Trading Interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased dark`}
        suppressHydrationWarning
      >
        <PrivyProvider>
          <AppInitializer />
          <SSEProvider>
            <SpotPricesProvider>
              <PositionsProvider>
                {/* <BotProvider> */}
                  {/* <BotCommandListener /> */}
                  <SignalRequestListener />
                  <MainLayout>{children}</MainLayout>
                {/* </BotProvider> */}
              </PositionsProvider>
            </SpotPricesProvider>
          </SSEProvider>
        </PrivyProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          richColors
          closeButton
          visibleToasts={5}
          toastOptions={{
            style: {
              background: '#0E0F11',
              border: '1px solid #1E1F22',
              color: '#FAFAFA',
            },
          }}
        />
      </body>
    </html>
  );
}
