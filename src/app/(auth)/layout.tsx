import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary/40 px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 text-2xl font-bold tracking-tight">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          C
        </span>
        Clevar
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
