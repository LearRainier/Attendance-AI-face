export const DEPARTMENTS = [
  "BSCS",
  "BSA",
  "BSMA",
  "BSBA",
  "BSP",
  "BSSW",
  "ABCOMM",
  "BEED",
  "BSED",
] as const;

export type Department = (typeof DEPARTMENTS)[number];
