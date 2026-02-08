import { ProductConfig, ProductSlug } from "@/lib/types";

export const products: ProductConfig[] = [
  {
    slug: "somara",
    name: "Somara",
    color: "#6366f1", // indigo
    gaPropertyId: process.env.GA_PROPERTY_ID_SOMARA || "",
    hasBusinessMetrics: false,
    hasSomaraMetrics: true,
  },
  {
    slug: "ulink",
    name: "ULink",
    color: "#f59e0b", // amber
    gaPropertyId: process.env.GA_PROPERTY_ID_ULINK || "",
    hasBusinessMetrics: true,
    hasSomaraMetrics: false,
  },
  {
    slug: "pushfire",
    name: "PushFire",
    color: "#ef4444", // red
    gaPropertyId: process.env.GA_PROPERTY_ID_PUSHFIRE || "",
    hasBusinessMetrics: false,
    hasSomaraMetrics: false,
  },
];

export function getProduct(slug: string): ProductConfig | undefined {
  return products.find((p) => p.slug === slug);
}

export function isValidProductSlug(slug: string): slug is ProductSlug {
  return products.some((p) => p.slug === slug);
}
