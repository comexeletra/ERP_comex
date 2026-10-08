export type PurchaseRequestOperationalData = {
  scNumber?: string | null;
  scDate?: string | null;
  requester?: string | null;
  approvalDate?: string | null;
  commercialPlanReceivedDate?: string | null;
};

export function purchaseRequestOperationalFields(choice?: PurchaseRequestOperationalData) {
  return {
    scNumber: choice?.scNumber ?? "",
    scDate: choice?.scDate ?? "",
    requester: choice?.requester ?? "",
    scApprovalDate: choice?.approvalDate ?? "",
    commercialPlanReceivedDate: choice?.commercialPlanReceivedDate ?? "",
  };
}
