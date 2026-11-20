import { authenticated, failure, PublicError, uuid } from "@/lib/ai/server";
import { ownedJob } from "@/lib/ai/jobs";
export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const { admin, userId } = await authenticated(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !uuid.test(id))
      throw new PublicError(400, "Choose a generated image.");
    const job = await ownedJob(admin, userId, id);
    if (
      !job.result_path ||
      !job.result_path.startsWith(`${userId}/${job.project_id}/`)
    )
      throw new PublicError(404, "This image is not ready to download.");
    const { data, error } = await admin.storage
      .from("product-images")
      .download(job.result_path);
    if (error || !data)
      throw new PublicError(
        503,
        "The saved image could not be downloaded. Please try again.",
      );
    return new Response(await data.arrayBuffer(), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition":
          'attachment; filename="shelf-studio-generated.png"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
