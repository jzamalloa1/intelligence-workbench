import type { Metadata } from "next";
import "./globals.css";
import { SessionGate } from "@/components/SessionGate";

export const metadata: Metadata = {
  title: "Intelligence Workbench",
  description:
    "A research console built on LangChain Managed Deep Agents and CopilotKit.",
};

const THEME_CLASS_SCRIPT = `(() => {
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const theme = root.dataset.theme;
    root.classList.toggle("dark", theme ? theme === "dark" : media.matches);
  };
  apply();
  media.addEventListener("change", apply);
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          CopilotKit's chat has `dark:` styles keyed to a `.dark` class. Keep it
          on <html> in step with the theme — an explicit data-theme wins, else
          the system setting — before first paint, so there's no light flash.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_CLASS_SCRIPT }} />
      </head>
      <body className="antialiased">
        {/*
          Reading INTELLIGENCE_API_KEY here (server-side, presence only, never
          the value) lets the client-side runner toggle know whether "cloud"
          means anything before the user ever sends a message — route.ts falls
          back to the local runner regardless, so this is purely so the toggle
          doesn't claim a mode that isn't actually configured.
        */}
        <SessionGate intelligenceAvailable={Boolean(process.env.INTELLIGENCE_API_KEY)}>
          {children}
        </SessionGate>
      </body>
    </html>
  );
}
