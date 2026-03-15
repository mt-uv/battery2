import "./globals.css"

export const metadata = {
  title: "Na-ion Cathode Voltage",
  description: "UMA + ASE relaxation voltage screening",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
