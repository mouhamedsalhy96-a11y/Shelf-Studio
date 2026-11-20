import "server-only";
import type { adminClient } from "./server";
import { PublicError } from "./server";
import { downloadResult, predictionRequest, type Snapshot } from "./providers";
export type Admin = ReturnType<typeof adminClient>;
export type Job = {
  id: string;
  user_id: string;
  project_id: string;
  request_key: string;
  snapshot: Snapshot;
  status: "creating" | "processing" | "succeeded" | "failed";
  description: string;
  caption: string;
  warnings: string[];
  prediction_id: string | null;
  result_path: string | null;
  error_message: string | null;
  created_at: string;
};
export async function ownedJob(
  admin: Admin,
  userId: string,
  id: string,
): Promise<Job> {
  const { data, error } = await admin
    .from("generations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new PublicError(
      503,
      "Saved generations are temporarily unavailable. Please try again later.",
    );
  if (!data)
    throw new PublicError(
      404,
      "This generation could not be found in your account.",
    );
  return data as Job;
}
export async function updateJob(
  admin: Admin,
  job: Job,
  patch: Partial<Job>,
): Promise<Job> {
  const { data, error } = await admin
    .from("generations")
    .update(patch)
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .select("*")
    .single();
  if (error || !data)
    throw new PublicError(
      503,
      "We couldn’t confirm the saved generation status. Check its status again.",
    );
  return data as Job;
}
export function sourcePath(job: Job) {
  const path = job.snapshot.source_path;
  if (
    typeof path !== "string" ||
    !path.startsWith(`${job.user_id}/${job.project_id}/`) ||
    path.includes("..")
  )
    throw new PublicError(400, "Save a valid product photo before generating.");
  return path;
}
export async function refreshJob(admin: Admin, job: Job): Promise<Job> {
  if (!["creating", "processing"].includes(job.status)) return job;
  if (Date.now() - new Date(job.created_at).getTime() > 5 * 60 * 1000) {
    return updateJob(admin, job, {
      status: "failed",
      error_message:
        "This attempt did not finish in time. It still counts toward the daily limit. Any available copy is kept below.",
    });
  }
  if (!job.prediction_id) return job;
  const prediction = await predictionRequest(
    `predictions/${encodeURIComponent(job.prediction_id)}`,
  );
  if (prediction.id !== job.prediction_id)
    throw new PublicError(502, "The image response could not be verified.");
  if (
    ["failed", "canceled", "cancelled", "aborted"].includes(prediction.status)
  ) {
    return updateJob(admin, job, {
      status: "failed",
      error_message:
        "Image generation did not complete. Any available copy is kept below. This attempt counts toward the daily limit.",
    });
  }
  if (prediction.status !== "succeeded") return job;
  const bytes = await downloadResult(prediction.output);
  const path = `${job.user_id}/${job.project_id}/generated-${job.id}.png`;
  const { error } = await admin.storage
    .from("product-images")
    .upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "300",
    });
  if (error)
    throw new PublicError(
      503,
      "Your image is ready, but private storage could not save it yet. Check status again to retry saving without generating another image.",
    );
  return updateJob(admin, job, {
    status: "succeeded",
    result_path: path,
    error_message: null,
  });
}
export async function publicJob(admin: Admin, job: Job) {
  let imageUrl: string | null = null;
  if (job.result_path) {
    if (!job.result_path.startsWith(`${job.user_id}/${job.project_id}/`))
      throw new PublicError(500, "The stored image could not be verified.");
    const { data } = await admin.storage
      .from("product-images")
      .createSignedUrl(job.result_path, 300);
    imageUrl = data?.signedUrl || null;
  }
  const { data: original } = await admin.storage
    .from("product-images")
    .createSignedUrl(sourcePath(job), 300);
  return {
    originalUrl: original?.signedUrl || null,
    id: job.id,
    requestKey: job.request_key,
    projectId: job.project_id,
    status: job.status,
    description: job.description,
    caption: job.caption,
    warnings: job.warnings,
    imageUrl,
    error: job.error_message,
    createdAt: job.created_at,
    productName: job.snapshot.name,
    scene: job.snapshot.scene,
    ratio: job.snapshot.ratio,
  };
}
export async function remainingAttempts(admin: Admin, userId: string) {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const { count, error } = await admin
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", midnight.toISOString());
  return error || count === null ? null : Math.max(0, 3 - count);
}
