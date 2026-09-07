import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Andala AI — Visual Employee",
  description: "An AI graphic designer that thinks before it prompts."
};

export const viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the marketing page adds `m-js` to <html> via an
    // inline pre-paint script so scroll-reveal motion is opt-in; that attribute
    // legitimately differs between the server HTML and the first client render.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
