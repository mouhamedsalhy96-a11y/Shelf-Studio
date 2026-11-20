import {
  authenticated,
  failure,
  json,
  PublicError,
  uuid,
} from "@/lib/ai/server";
import { listGenerationHistory } from "@/lib/ai/history";
export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const { admin, userId } = await authenticated(request);
    const search = new URL(request.url).searchParams;
    const projectId = search.get("projectId");
    if (!projectId || !uuid.test(projectId))
      throw new PublicError(400, "Choose a saved account project.");
    return json(
      await listGenerationHistory(
        admin,
        userId,
        projectId,
        search.get("cursor"),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
