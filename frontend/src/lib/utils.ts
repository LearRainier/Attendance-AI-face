import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function to12Hour(timeStr: string): string {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  const hour = parseInt(parts[0] ?? "0", 10);
  const min = parts[1] ?? "00";
  const ampm = hour >= 12 ? "PM" : "AM";
  const formattedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${formattedHour}:${min} ${ampm}`;
}
