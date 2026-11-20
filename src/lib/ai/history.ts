import "server-only";
import type { Admin, Job } from "./jobs";
import { PublicError, uuid } from "./server";
import type { GenerationHistoryPage } from "@/lib/generation-history";
const pageSize = 12;
type HistoryRow = Pick<
  Job,
  | "id"
  | "user_id"
  | "project_id"
  | "status"
  | "snapshot"
  | "created_at"
  | "result_path"
  | "description"
  | "caption"
>;
function readCursor(value: string | null) {
  if (!value) return null;
  try {
    if (value.length > 220 || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw new Error("Invalid cursor");
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof cursor.id !== "string" ||
      !uuid.test(cursor.id) ||
      typeof cursor.time !== "string" ||
      new Date(cursor.time).toISOString() !== cursor.time
    )
      throw new Error("Invalid cursor");
    return { id: cursor.id, time: cursor.time };
  } catch {
    throw new PublicError(
      400,
      "The history page could not be read. Refresh your saved versions.",
    );
  }
}
export async function listGenerationHistory(
  admin: Admin,
  userId: string,
  projectId: string,
  cursorValue: string | null,
): Promise<GenerationHistoryPage> {
  const cursor = readCursor(cursorValue);
  let query = admin
    .from("generations")
    .select(
      "id,user_id,project_id,status,snapshot,created_at,result_path,description,caption",
    )
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.time},and(created_at.eq.${cursor.time},id.lt.${cursor.id})`,
    );
  const { data, error } = await query;
  if (error)
    throw new PublicError(
      503,
      "Your saved versions could not be loaded. Please try again.",
    );
  const allRows = (data || []) as HistoryRow[];
  const rows = allRows.slice(0, pageSize);
  // The admin client bypasses RLS; verify scope again before signing any photo.
  for (const row of rows) {
    if (row.user_id !== userId || row.project_id !== projectId)
      throw new PublicError(500, "The saved versions could not be verified.");
    if (
      row.result_path &&
      (!row.result_path.startsWith(`${userId}/${projectId}/`) ||
        row.result_path.includes(".."))
    )
      throw new PublicError(500, "A saved preview could not be verified.");
  }
  const paths = rows.flatMap((row) =>
    row.result_path ? [row.result_path] : [],
  );
  const { data: signed } = paths.length
    ? await admin.storage.from("product-images").createSignedUrls(paths, 300)
    : { data: null };
  const urls = new Map(
    signed
      ?.filter((image) => !image.error)
      .map((image) => [image.path, image.signedUrl]),
  );
  const last = rows.at(-1);
  const nextCursor =
    allRows.length > pageSize && last
      ? Buffer.from(
          JSON.stringify({
            id: last.id,
            time: new Date(last.created_at).toISOString(),
          }),
        ).toString("base64url")
      : null;
  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      productName: row.snapshot.name,
      scene: row.snapshot.scene,
      ratio: row.snapshot.ratio,
      hasCopy: Boolean(row.description && row.caption),
      imageUrl: row.result_path ? urls.get(row.result_path) || null : null,
    })),
    nextCursor,
  };
}
