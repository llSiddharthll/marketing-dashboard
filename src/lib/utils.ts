import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities
 * (the last one wins) so a caller can override a primitive's default classes
 * without fighting specificity. Standard shadcn/ui helper.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
