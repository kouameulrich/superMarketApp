import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SuperGestion — Pilotage retail",
  description:
    "Plateforme SaaS multi-tenant pour la grande distribution : POS, stocks, transferts inter-magasins, achats et analytics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="bg-slate-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
