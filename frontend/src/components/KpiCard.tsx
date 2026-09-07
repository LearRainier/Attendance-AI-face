import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
}

export function KpiCard({ label, value, icon: Icon }: KpiCardProps) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="flex flex-row items-center justify-between px-5 pt-0">
        <CardDescription>{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-5 pb-0">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
      </CardContent>
    </Card>
  );
}
