export interface CostLineItem {
  service: string;
  resource: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  monthlyTotal: number;
}

export interface CostBreakdown {
  lineItems: CostLineItem[];
  subtotal: number;
  reservedDiscount: number;
  total: number;
  currency: string;
}

export interface CostEstimate {
  provider: string;
  region: string;
  strategies: {
    low: CostBreakdown;
    medium: CostBreakdown;
    high: CostBreakdown;
  };
  generatedAt: Date;
}
