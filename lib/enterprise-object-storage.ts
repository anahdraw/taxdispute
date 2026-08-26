import path from "node:path";

export type ObjectStorageReadiness = {
  selected: "local_private" | "vercel_blob" | "s3_compatible";
  status: "ready_local" | "ready_production" | "partial" | "gap";
  privateByDefault: boolean;
  configured: boolean;
  note: string;
};

export function objectStorageReadiness(env: Record<string, string | undefined> = process.env): ObjectStorageReadiness {
  const selected = String(env.TDP_OBJECT_STORAGE || "local_private").trim().toLowerCase();
  if (selected === "vercel_blob") {
    const configured = Boolean(env.BLOB_READ_WRITE_TOKEN);
    return { selected: "vercel_blob", status: configured ? "partial" : "gap", privateByDefault: true, configured, note: configured ? "Private Vercel Blob upload exists; retention, replication, and restore automation remain external." : "BLOB_READ_WRITE_TOKEN is missing." };
  }
  if (selected === "s3_compatible") {
    const configured = Boolean(env.TDP_S3_ENDPOINT && env.TDP_S3_BUCKET && env.TDP_S3_REGION);
    return { selected: "s3_compatible", status: "gap", privateByDefault: true, configured, note: configured ? "Endpoint metadata exists, but the S3 adapter and credential provider are intentionally not implemented yet." : "S3-compatible endpoint/bucket/region and adapter are not configured." };
  }
  const outsideProject = Boolean(env.TDP_PRIVATE_STORAGE_ROOT && !path.resolve(env.TDP_PRIVATE_STORAGE_ROOT).startsWith(`${process.cwd()}${path.sep}`));
  return { selected: "local_private", status: "ready_local", privateByDefault: true, configured: true, note: outsideProject ? "Private filesystem root is outside the repository." : "Local encrypted-disk policy and off-host replication are still operator responsibilities." };
}
