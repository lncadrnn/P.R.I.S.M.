import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "PRISM",
  description: "Progressive Real-Time Identification of Synthetic Media and Disinformation on Social Media Platforms.",
  keywords: ["PRISM", "AI-Generated Media Detection", "Synthetic Media Forensics", "Disinformation Detection", "CNN-ViT Hybrid", "Taglish NLP", "Social Media Shield"],
  authors: [
    { name: "Lance Adrian D. Acal" },
    { name: "Jericho G. Delos Reyes" },
    { name: "Lee Adrian D. Noroña" },
    { name: "Christian B. Valenzuela" }
  ],
  icons: {
    icon: "/prism_tab_logo.png",
    shortcut: "/prism_tab_logo.png",
    apple: "/prism_tab_logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-theme-bg text-theme-text overflow-x-hidden selection:bg-[#3CC4DB]/30 selection:text-slate-900">
        {children}
      </body>
    </html>
  );
}

