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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
