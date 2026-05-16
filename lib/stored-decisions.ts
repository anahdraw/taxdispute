export type StoredDecisionFile = {
  id: string;
  filename: string;
  pathname: string;
  url: string;
  downloadUrl: string;
  size: number;
  uploadedAt: string;
  status: "uploaded" | "failed";
};
