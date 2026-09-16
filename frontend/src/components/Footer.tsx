import { cn } from "@/lib/utils";

interface FooterProps {
  className?: string;
}

export function Footer({ className }: FooterProps) {
  return (
    <footer
      className={cn(
        "shrink-0 border-t border-border/40 py-3.5 px-6 text-center text-xs text-muted-foreground select-none",
        className
      )}
    >
      Made with <span className="text-red-500 inline-block">❤️</span> by Lear & Dan
    </footer>
  );
}
