import "./styles.css";
import AuthGate from "../components/AuthGate";
import I18nProvider from "../components/I18nProvider";

export const metadata = {
  title: "TMS - Supply Chain | Eletra",
  description: "Gestão integrada de operações e importações da Eletra." // i18n-ignore: server-rendered metadata
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><I18nProvider><AuthGate>{children}</AuthGate></I18nProvider></body>
    </html>
  );
}
