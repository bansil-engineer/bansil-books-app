export type CandidateMatchMethod = 
  | "EXACT_ITEM_ID"
  | "APPROVED_ALIAS"
  | "OWNER_APPROVED_MAPPING"
  | "ACTIVE_BOM_COMPONENT"
  | "DESCRIPTION_FAMILY_SIMILARITY"
  | "QUANTITY_RATIO_ONLY";

export interface MismatchItem {
  itemId: string;
  itemName: string;
  sku: string | null;
  description: string | null;
  uom: string | null;
  mismatchQty: number;
  customerId: string;
  customerName: string;
  // V2 Added Fields
  taxableValue: number | null;
  gstInclusiveAmount: number | null; // Always UNKNOWN/null from verified source currently
  rate: number | null;
}

export interface CandidateItem {
  itemId: string;
  itemName: string;
  sku: string | null;
  description: string | null;
  uom: string | null;
  availableQty: number;
  matchMethod: CandidateMatchMethod;
  // V2 Added Fields
  taxableValue: number | null;
  gstInclusiveAmount: number | null;
  rate: number | null;
  customerId: string;
}

export interface SuggestionGroup {
  groupId: string;
  targetType: "TECHNICAL_RELATIONSHIP" | "QUANTITY_ONLY_POSSIBILITY";
  candidates: CandidateItem[];
  coverageQty: number;
  coveragePercent: number;
  residualQty: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  warnings: string[];
  evidenceFingerprint: string;
  reviewerDecision?: {
    status: "APPROVE" | "REJECT" | "HOLD" | "NEED_EVIDENCE";
    isStale: boolean;
    timestamp: string;
  };
}
