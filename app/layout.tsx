import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const sourceSans = localFont({
  src: "./fonts/source-sans-3-variable.ttf",
  weight: "200 900",
  display: "swap",
  variable: "--font-source-sans",
});
const lora = localFont({
  src: "./fonts/lora-variable.ttf",
  display: "swap",
  weight: "400 700",
  variable: "--font-lora",
});
export const metadata: Metadata = {
  title: "Flexo - Scheduling workspace",
  description:
    "Private, local production scheduling. Powered by simulated annealing.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sourceSans.variable} ${lora.variable}`}>
      <body>{children}</body>
    </html>
  );
}
