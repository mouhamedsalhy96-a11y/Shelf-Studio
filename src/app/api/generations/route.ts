import {
  authenticated,
  failure,
  json,
  PublicError,
  readBody,
  uuid,
} from "@/lib/ai/server";
import {
  generateCopy,
  imagePrompt,
  predictionRequest,
} from "@/lib/ai/providers";
import {
  ownedJob,
  publicJob,
  refreshJob,
  remainingAttempts,
  sourcePath,
  updateJob,
  type Job,
} from "@/lib/ai/jobs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { admin, userId } = await authenticated(request);
    const search = new URL(request.url).searchParams;
    const id = search.get("id");
    const projectId = search.get("projectId");
    let job: Job | null = null;
    if (id && uuid.test(id)) job = await ownedJob(admin, userId, id);
    else if (!id && projectId && uuid.test(projectId)) {
      const { data, error } = await admin
        .from("generations")
        .select("*")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error)
        throw new PublicError(
          503,
          "Generation is temporarily unavailable. Please try again later.",
        );
      job = data as Job | null;
    } else throw new PublicError(400, "Choose a saved account project.");
    if (job) job = await refreshJob(admin, job);
    return json({
      job: job ? await publicJob(admin, job) : null,
      remaining: await remainingAttempts(admin, userId),
      enabled: process.env.AI_GENERATION_ENABLED === "true",
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { admin, userId } = await authenticated(request);
    const body = await readBody(request);
    if (
      typeof body.projectId !== "string" ||
      !uuid.test(body.projectId) ||
      typeof body.requestKey !== "string" ||
      !uuid.test(body.requestKey)
    )
      throw new PublicError(400, "Choose a saved project and a valid request.");
    if (process.env.AI_GENERATION_ENABLED !== "true")
      throw new PublicError(
        503,
        "AI generation is switched off until setup is complete.",
      );
    if (!process.env.OPENAI_API_KEY || !process.env.REPLICATE_API_TOKEN)
      throw new PublicError(503, "The AI providers are not configured yet.");
    const { data: reservation, error } = await admin.rpc("reserve_generation", {
      p_user_id: userId,
      p_project_id: body.projectId,
      p_request_key: body.requestKey,
    });
    if (error) {
      const limits: Record<string, string> = {
        USER_LIMIT:
          "You’ve used today’s three attempts. Try again after midnight UTC.",
        GLOBAL_LIMIT:
          "The studio’s shared daily limit has been reached. Try again after midnight UTC.",
        COOLDOWN: "Wait one minute between generation attempts.",
        IN_PROGRESS:
          "You already have an active generation. Open it and check its status.",
      };
      const limit = Object.keys(limits).find((code) =>
        error.message.includes(code),
      );
      if (limit) throw new PublicError(429, limits[limit]);
      if (error.message.includes("PROJECT_NOT_FOUND"))
        throw new PublicError(404, "Save this project to your account first.");
      if (error.message.includes("FACTS_REQUIRED"))
        throw new PublicError(
          400,
          "Add verified product details and save the project before generating.",
        );
      throw new PublicError(
        503,
        "Generation is temporarily unavailable. Please try again later.",
      );
    }
    if (!reservation?.job?.id)
      throw new PublicError(503, "A generation could not be reserved safely.");
    let job = reservation.job as Job;
    if (!reservation.created)
      return json({
        job: await publicJob(admin, job),
        remaining: await remainingAttempts(admin, userId),
        enabled: true,
      });
    try {
      const path = sourcePath(job);
      const { data: photo, error: photoError } = await admin.storage
        .from("product-images")
        .createSignedUrl(path, 600);
      if (photoError || !photo?.signedUrl)
        throw new PublicError(
          502,
          "The original photo could not be opened. Save the project again before trying another attempt.",
        );
      const copy = await generateCopy(job.snapshot);
      job = await updateJob(admin, job, {
        description: copy.description,
        caption: copy.caption,
        warnings: copy.warnings,
      });
      const prediction = await predictionRequest(
        "models/black-forest-labs/flux-kontext-pro/predictions",
        {
          input: {
            input_image: photo.signedUrl,
            prompt: imagePrompt(job.snapshot),
            aspect_ratio: job.snapshot.ratio,
            output_format: "png",
            safety_tolerance: 2,
            prompt_upsampling: false,
          },
        },
      );
      job = await updateJob(admin, job, {
        status: "processing",
        prediction_id: prediction.id,
      });
    } catch (providerError) {
      job = await updateJob(admin, job, {
        status: "failed",
        error_message:
          providerError instanceof PublicError
            ? providerError.message
            : "Generation did not complete or could not be confirmed. This attempt counts toward the daily limit. Any available copy is kept below.",
      });
    }
    return json({
      job: await publicJob(admin, job),
      remaining: await remainingAttempts(admin, userId),
      enabled: true,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const { admin, userId } = await authenticated(request);
    const body = await readBody(request);
    if (
      typeof body.id !== "string" ||
      !uuid.test(body.id) ||
      typeof body.description !== "string" ||
      !body.description.trim() ||
      body.description.length > 1600 ||
      typeof body.caption !== "string" ||
      !body.caption.trim() ||
      body.caption.length > 500
    )
      throw new PublicError(
        400,
        "Keep the description under 1,600 characters and the caption under 500 characters.",
      );
    let job = await ownedJob(admin, userId, body.id);
    if (["creating", "processing"].includes(job.status))
      throw new PublicError(
        409,
        "Wait until generation finishes before saving copy edits.",
      );
    job = await updateJob(admin, job, {
      description: body.description.trim(),
      caption: body.caption.trim(),
    });
    return json({
      job: await publicJob(admin, job),
      remaining: await remainingAttempts(admin, userId),
      enabled: process.env.AI_GENERATION_ENABLED === "true",
    });
  } catch (error) {
    return failure(error);
  }
}
