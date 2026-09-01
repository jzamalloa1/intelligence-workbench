import type { Metadata } from "next";
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { INSPECTOR_ENABLED } from "@/lib/config";

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
          useSingleEndpoint={false} matches the catch-all route at
          /api/copilotkit/[[...slug]] — the runtime serves several sub-paths
          (run, connect, threads) rather than one.
        */}
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          agent="workbench"
          useSingleEndpoint={false}
          enableInspector={INSPECTOR_ENABLED}
        >
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
