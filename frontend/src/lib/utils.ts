import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind CSS classes safely, resolving any conflicts using tailwind-merge.
 * @param inputs - Array of class values to be merged.
 * @returns A single string of merged class names.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats monetary numbers according to currency code (supporting GHS, USD, EUR, GBP, NGN, KES, ZAR, JPY).
 */
export function formatMoney(amount: number, currency: string = "GHS"): string {
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: currency || "GHS",
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "GHS"} ${amount.toFixed(2)}`;
  }
}
