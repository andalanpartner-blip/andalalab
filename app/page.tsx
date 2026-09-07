import type { Metadata } from "next";
import { Marketing } from "../components/marketing/Marketing";
import "../components/marketing/motion.css";

/**
 * The public marketing experience (`/`). A presentation layer only — it holds
 * no product logic and never exposes the private workspace. Every CTA points to
 * `/login`, which is the existing authenticated entry point (no public signup).
 *
 * The authenticated home is `/dashboard`; `/project/[id]` is the workspace.
 * Both remain private behind the existing middleware + route guards.
 */

const DESCRIPTION =
  "Andala AI Visual Employee is an AI graphic designer that thinks before it prompts — strategy, concept and design decisions before generation, with a human approving every visual.";

export const metadata: Metadata = {
  title: "Andala AI Visual Employee — your creative partner from brief to final",
  description: DESCRIPTION,
  applicationName: "Andala AI Visual Employee",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Andala AI Visual Employee",
    description: DESCRIPTION,
    siteName: "Andala",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Andala AI Visual Employee",
    description: DESCRIPTION
  }
};

export default function Home() {
  return (
    <>
      {/* Sets `.m-js` before paint so scroll-reveal motion is opt-in and the
          page is fully readable with JavaScript disabled. */}
      <script
        dangerouslySetInnerHTML={{
          __html: "document.documentElement.classList.add('m-js')"
        }}
      />
      <Marketing />
    </>
  );
}
