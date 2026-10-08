import "./styles.css";
import AuthGate from "../components/AuthGate";

export const metadata = {
  title: "TMS - Supply Chain | Eletra",
  description: "Gestão integrada de operações e importações da Eletra."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
