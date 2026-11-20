import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (name) => {
    if (name === "server-only") return {};
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency ${name}`);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const server = load("src/lib/ai/server.ts", { "@supabase/supabase-js": {} });
const merge = load("src/lib/generation-history.ts").mergeGenerationHistory;
const owner = "11111111-1111-4111-8111-111111111111";
const project = "22222222-2222-4222-8222-222222222222";
function row(index = 1) {
  const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
  return {
    id,
    user_id: owner,
    project_id: project,
    status: "succeeded",
    created_at: new Date(Date.UTC(2026, 10, 19, 12, 0, index)).toISOString(),
    snapshot: {
      name: "Test product",
      scene: "studio",
      ratio: "1:1",
      facts: "Private product facts",
    },
    description: "Private draft copy",
    caption: "Private caption",
    result_path: `${owner}/${project}/generated-${id}.png`,
  };
}
function harness(options = {}) {
  const calls = [];
  const rows = options.rows || [row()];
  const query = {
    select(value) {
      calls.push(["select", value]);
      return this;
    },
    eq(key, value) {
      calls.push(["eq", key, value]);
      return this;
    },
    order(key, value) {
      calls.push(["order", key, value]);
      return this;
    },
    limit(value) {
      calls.push(["limit", value]);
      return this;
    },
    or(value) {
      calls.push(["or", value]);
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error: options.error }).then(
        resolve,
        reject,
      );
    },
  };
  const admin = {
    from(table) {
      calls.push(["from", table]);
      return query;
    },
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return {
          async createSignedUrls(paths, ttl) {
            calls.push(["signed", paths, ttl]);
            return {
              data: options.thumbnailError
                ? null
                : paths.map((value) => ({
                    path: value,
                    signedUrl: "https://example.invalid/private-thumbnail",
                    error: null,
                  })),
            };
          },
        };
      },
    },
  };
  const api = load("src/lib/ai/history.ts", { "./server": server });
  return { api, admin, calls };
}
test("history is scoped to the verified account and requested project", async () => {
  const { api, admin, calls } = harness();
  await api.listGenerationHistory(admin, owner, project, null);
  assert.ok(
    calls.some(
      (call) => call[0] === "eq" && call[1] === "user_id" && call[2] === owner,
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "eq" && call[1] === "project_id" && call[2] === project,
    ),
  );
  assert.deepEqual(
    calls
      .filter((call) => call[0] === "order")
      .map((call) => [call[1], call[2].ascending]),
    [
      ["created_at", false],
      ["id", false],
    ],
  );
});
test("history returns only 12 rows and a cursor anchored to the last visible row", async () => {
  const rows = Array.from({ length: 13 }, (_, i) => row(13 - i));
  const { api, admin, calls } = harness({ rows });
  const result = await api.listGenerationHistory(admin, owner, project, null);
  assert.equal(result.items.length, 12);
  const cursor = JSON.parse(
    Buffer.from(result.nextCursor, "base64url").toString(),
  );
  assert.equal(cursor.id, rows[11].id);
  assert.equal(cursor.time, rows[11].created_at);
  assert.equal(calls.find((call) => call[0] === "limit")[1], 13);
  assert.equal(calls.find((call) => call[0] === "signed")[1].length, 12);
});
test("pagination uses a strict timestamp and identity boundary for equal timestamps", async () => {
  const last = row();
  const cursor = Buffer.from(
    JSON.stringify({ id: last.id, time: last.created_at }),
  ).toString("base64url");
  const { api, admin, calls } = harness();
  await api.listGenerationHistory(admin, owner, project, cursor);
  assert.equal(
    calls.find((call) => call[0] === "or")[1],
    `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`,
  );
});
test("forged and oversized cursors fail before a database request", async () => {
  const { api, admin, calls } = harness();
  for (const value of [
    "bad-cursor!",
    "x".repeat(221),
    Buffer.from(
      JSON.stringify({ id: row().id, time: "2026-01-01),user_id.neq.fake" }),
    ).toString("base64url"),
  ])
    await assert.rejects(
      api.listGenerationHistory(admin, owner, project, value),
      /history page/,
    );
  assert.equal(calls.length, 0);
});
test("a foreign account row is rejected before signing any preview", async () => {
  const { api, admin, calls } = harness({
    rows: [{ ...row(), user_id: "other-owner" }],
  });
  await assert.rejects(
    api.listGenerationHistory(admin, owner, project, null),
    /could not be verified/,
  );
  assert.ok(!calls.some((call) => call[0] === "signed"));
});
test("a photo outside the owner project folder is never signed", async () => {
  const { api, admin, calls } = harness({
    rows: [{ ...row(), result_path: `${owner}/different-project/private.png` }],
  });
  await assert.rejects(
    api.listGenerationHistory(admin, owner, project, null),
    /preview could not be verified/,
  );
  assert.ok(!calls.some((call) => call[0] === "signed"));
});
test("history exposes safe summaries, not copy, facts, paths or provider metadata", async () => {
  const { api, admin, calls } = harness();
  const result = await api.listGenerationHistory(admin, owner, project, null);
  assert.equal(result.items[0].hasCopy, true);
  assert.equal(calls.find((call) => call[0] === "signed")[2], 300);
  assert.equal(result.nextCursor, null);
  for (const name of [
    "snapshot",
    "description",
    "caption",
    "user_id",
    "result_path",
    "prediction_id",
  ])
    assert.ok(!(name in result.items[0]));
});
test("missing thumbnail links still leave earlier copy and status accessible", async () => {
  const { api, admin } = harness({ thumbnailError: true });
  const result = await api.listGenerationHistory(admin, owner, project, null);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].imageUrl, null);
  assert.equal(result.items[0].hasCopy, true);
});
test("a query failure is reported instead of appearing as an empty history", async () => {
  const { api, admin } = harness({ error: { message: "offline" } });
  await assert.rejects(
    api.listGenerationHistory(admin, owner, project, null),
    /could not be loaded/,
  );
});
test("history merges newly-created results without duplicates and keeps newest first", () => {
  const entries = [row(1), row(2), row(3)].map((value) => ({
    id: value.id,
    status: value.status,
    createdAt: value.created_at,
    imageUrl: null,
  }));
  const result = merge([entries[0], entries[1]], [entries[1], entries[2]]);
  assert.deepEqual(
    result.map((value) => value.id),
    [entries[2].id, entries[1].id, entries[0].id],
  );
});
test("a late history response cannot revert a completed version to in-progress", () => {
  const entry = {
    id: row().id,
    createdAt: row().created_at,
    status: "succeeded",
    imageUrl: "saved-image",
  };
  const result = merge(
    [entry],
    [{ ...entry, status: "processing", imageUrl: null }],
  );
  assert.equal(result[0].status, "succeeded");
  assert.equal(result[0].imageUrl, "saved-image");
});
test("the history route rejects unauthenticated requests without reading storage", async () => {
  let read = false;
  const api = load("src/app/api/generations/history/route.ts", {
    "@/lib/ai/server": {
      ...server,
      authenticated: async () => {
        throw new server.PublicError(401, "Sign in");
      },
    },
    "@/lib/ai/history": {
      listGenerationHistory() {
        read = true;
      },
    },
  });
  const response = await api.GET(
    new Request(
      `http://localhost/api/generations/history?projectId=${project}`,
    ),
  );
  assert.equal(response.status, 401);
  assert.equal(read, false);
});
test("opening the history route only lists saved versions; it cannot reserve or generate", async () => {
  let inputs;
  const api = load("src/app/api/generations/history/route.ts", {
    "@/lib/ai/server": {
      ...server,
      authenticated: async () => ({ admin: "verified-client", userId: owner }),
    },
    "@/lib/ai/history": {
      async listGenerationHistory(...args) {
        inputs = args;
        return { items: [], nextCursor: null };
      },
    },
  });
  const response = await api.GET(
    new Request(
      `http://localhost/api/generations/history?projectId=${project}`,
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(inputs, ["verified-client", owner, project, null]);
  assert.match(response.headers.get("cache-control"), /no-store/);
});
