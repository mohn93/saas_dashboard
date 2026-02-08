import Link from "next/link";

export default function ProductNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h2 className="text-2xl font-bold">Product Not Found</h2>
      <p className="mt-2 text-muted-foreground">
        The product you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="mt-4 text-sm font-medium text-primary hover:underline"
      >
        Go back to Overview
      </Link>
    </div>
  );
}
