// Order matters: tokens first, then element defaults, frame, shared components and screens.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/features/operations.css";
import "./styles/features/catalog.css";
import "./styles/features/source-audit.css";
import "./styles/features/analysis.css";
import "./styles/features/e2e.css";
import AuthGate from "../components/AuthGate";
import I18nProvider from "../components/I18nProvider";
import { productName } from "../lib/brand";

export const metadata = {
  title: `${productName} | Eletra`,
  description: "Gestão integrada de operações e importações da Eletra." // i18n-ignore: server-rendered metadata
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><I18nProvider><AuthGate>{children}</AuthGate></I18nProvider></body>
    </html>
  );
}
