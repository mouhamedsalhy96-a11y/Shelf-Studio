import type { Draft } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase/browser";

const bucket = "product-images";
const fields =
  "id,user_id,name,facts,scene,ratio,channel,source_path,updated_at";
export type ProjectSummary = Omit<Draft, "image"> & {
  ownerId: string;
  sourcePath: string;
  thumbnailUrl: string;
};
type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  facts: string;
  scene: Draft["scene"];
  ratio: Draft["ratio"];
  channel: Draft["channel"];
  source_path: string;
  updated_at: string;
};
function summary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    ownerId: row.user_id,
    name: row.name,
    facts: row.facts,
    scene: row.scene,
    ratio: row.ratio,
    channel: row.channel,
    sourcePath: row.source_path,
    updatedAt: new Date(row.updated_at).getTime(),
    thumbnailUrl: "",
    imageName:
      row.source_path.split("/").at(-1)?.split("--").slice(1).join("--") ||
      "product-photo",
  };
}
function assertOwnedPath(ownerId: string, projectId: string, path: string) {
  if (!path.startsWith(`${ownerId}/${projectId}/`) || path.includes("..")) {
    throw new Error("This project’s photo could not be verified.");
  }
}
async function requireOwner(ownerId: string) {
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user || data.user.id !== ownerId)
    throw new Error("Please sign in again before accessing account projects.");
}
export async function listAccountProjects(
  ownerId: string,
): Promise<ProjectSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(fields)
    .eq("user_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error)
    throw new Error(
      "Your account projects could not be loaded. Please try again.",
    );
  const projects = (data as ProjectRow[]).map(summary);
  for (const project of projects)
    assertOwnedPath(ownerId, project.id, project.sourcePath);
  if (!projects.length) return [];
  const { data: images } = await supabase.storage.from(bucket).createSignedUrls(
    projects.map((project) => project.sourcePath),
    300,
  );
  const urls = new Map(
    images
      ?.filter((item) => !item.error)
      .map((item) => [item.path, item.signedUrl]),
  );
  // A missing thumbnail must not hide an otherwise accessible project.
  return projects.map((project) => ({
    ...project,
    thumbnailUrl: urls.get(project.sourcePath) || "",
  }));
}
export async function openAccountProject(
  ownerId: string,
  projectId: string,
): Promise<Draft> {
  await requireOwner(ownerId);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(fields)
    .eq("id", projectId)
    .eq("user_id", ownerId)
    .single();
  if (error || !data)
    throw new Error(
      "This project could not be opened. Refresh your saved projects and try again.",
    );
  const project = summary(data as ProjectRow);
  assertOwnedPath(ownerId, project.id, project.sourcePath);
  const { data: image, error: imageError } = await supabase.storage
    .from(bucket)
    .download(project.sourcePath);
  if (imageError || !image)
    throw new Error(
      "The product photo could not be downloaded. Please try again.",
    );
  return {
    id: project.id,
    name: project.name,
    facts: project.facts,
    scene: project.scene,
    ratio: project.ratio,
    channel: project.channel,
    image,
    imageName: project.imageName,
    updatedAt: project.updatedAt,
  };
}
export async function saveAccountProject(
  ownerId: string,
  draft: Draft,
): Promise<ProjectSummary> {
  if (!draft.name.trim() || draft.name.trim().length > 100)
    throw new Error("Add a product name before saving to your account.");
  if (draft.facts.length > 1500)
    throw new Error("Keep product details under 1,500 characters.");
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(draft.image.type) ||
    !draft.image.size ||
    draft.image.size > 8388608
  ) {
    throw new Error("Choose a JPG, PNG or WebP image under 8 MB.");
  }
  await requireOwner(ownerId);
  const supabase = getSupabase();
  const safeName =
    draft.imageName
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/\.{2,}/g, ".")
      .slice(-100) || "product-photo";
  const path = `${ownerId}/${draft.id}/${crypto.randomUUID()}--${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, draft.image, {
      contentType: draft.image.type,
      upsert: false,
      cacheControl: "300",
    });
  if (uploadError)
    throw new Error(
      "The photo could not be uploaded. Your existing project has not been changed.",
    );
  const { data, error } = await supabase
    .from("projects")
    .upsert(
      {
        id: draft.id,
        user_id: ownerId,
        name: draft.name.trim(),
        facts: draft.facts.trim(),
        scene: draft.scene,
        ratio: draft.ratio,
        channel: draft.channel,
        source_path: path,
      },
      { onConflict: "id" },
    )
    .select(fields)
    .single();
  // A network error can occur after commit. Keep the new object in this case,
  // rather than risk deleting the photo of a successfully committed project.
  if (error || !data)
    throw new Error(
      "We couldn’t confirm the save. Check Saved projects before trying again.",
    );
  // Do not delete an older version here: another tab may still be editing it.
  // Obsolete uploads can be reconciled against source_path by a later cleanup job.
  const project = summary(data as ProjectRow);
  const { data: signed } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 300);
  return { ...project, thumbnailUrl: signed?.signedUrl || "" };
}
