import { Heebo, Space_Grotesk } from "next/font/google";
import "./globals.css";

const bodyFont = Heebo({
  subsets: ["latin", "hebrew"],
  variable: "--font-body"
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

export const metadata = {
  title: "דשבורד מגמות",
  description: "דשבורד חי למגמות חיפוש, מגמות X וההימור החם בפולימרקט."
};

export default function RootLayout({ children }) {
  return (
    <html dir="rtl" lang="he">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        {children}
      </body>
    </html>
  );
}
