import type { Metadata } from "next";
import "./globals.css";
import { AgentProvider } from "@/components/AgentProvider";

export const metadata: Metadata = {
  title: "Intelligence Workbench",
  description:
    "A research console built on LangChain Managed Deep Agents and CopilotKit.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/*
          Reading INTELLIGENCE_API_KEY here (server-side, presence only, never
          the value) lets the client-side runner toggle know whether "cloud"
          means anything before the user ever sends a message — route.ts falls
          back to the local runner regardless, so this is purely so the toggle
          doesn't claim a mode that isn't actually configured.
        */}
        <AgentProvider intelligenceAvailable={Boolean(process.env.INTELLIGENCE_API_KEY)}>
          {children}
        </AgentProvider>
      </body>
    </html>
  );
}
