/* Contract tests use a fake Supabase transport. No keys, emails or paid API calls. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

const owner = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const draft = () => ({
  id: projectId,
  name: "Test bottle",
  facts: "30 ml glass",
  scene: "studio",
  ratio: "1:1",
  channel: "Website",
  image: new Blob(["test-image"], { type: "image/jpeg" }),
  imageName: "bottle.jpg",
  updatedAt: 1,
});
const row = () => ({
  id: projectId,
  user_id: owner,
  name: "Test bottle",
  facts: "30 ml glass",
  scene: "studio",
  ratio: "1:1",
  channel: "Website",
  source_path: `${owner}/${projectId}/version--bottle.jpg`,
  updated_at: "2026-11-19T12:00:00Z",
});
function harness(options = {}) {
  const calls = [];
  let payload;
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
      return Promise.resolve({
        data: options.rows || [row()],
        error: options.listError,
      });
    },
    upsert(value, settings) {
      payload = value;
      calls.push(["upsert", value, settings]);
      return this;
    },
    single() {
      calls.push(["single"]);
      return Promise.resolve({
        data: options.readRow || (payload ? { ...row(), ...payload } : row()),
        error: options.writeError,
      });
    },
  };
  const storage = {
    async upload(filePath, image, settings) {
      calls.push(["upload", filePath, image, settings]);
      return { error: options.uploadError };
    },
    async download(filePath) {
      calls.push(["download", filePath]);
      return {
        data: options.downloadError ? null : draft().image,
        error: options.downloadError,
      };
    },
    async createSignedUrls(paths, ttl) {
      calls.push(["signedUrls", paths, ttl]);
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
    async createSignedUrl(value, ttl) {
      calls.push(["signedUrl", value, ttl]);
      return {
        data: options.thumbnailError
          ? null
          : { signedUrl: "https://example.invalid/private-thumbnail" },
      };
    },
    async remove() {
      calls.push(["remove"]);
      return { error: null };
    },
  };
  const client = {
    auth: {
      async getUser() {
        calls.push(["getUser"]);
        return {
          data: {
            user: options.wrongOwner ? { id: "other-account" } : { id: owner },
          },
          error: null,
        };
      },
    },
    from(table) {
      calls.push(["from", table]);
      return query;
    },
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return storage;
      },
    },
  };
  const filename = path.resolve("src/lib/account-projects.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (name) => {
    assert.equal(name, "@/lib/supabase/browser");
    return { getSupabase: () => client };
  };
  loaded._compile(compiled, filename);
  return { api: loaded.exports, calls };
}
test("saving rejects a changed account before upload or database access", async () => {
  const { api, calls } = harness({ wrongOwner: true });
  await assert.rejects(api.saveAccountProject(owner, draft()), /sign in again/);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["getUser"],
  );
});
test("an upload failure never updates the existing project", async () => {
  const { api, calls } = harness({ uploadError: { message: "offline" } });
  await assert.rejects(
    api.saveAccountProject(owner, draft()),
    /existing project has not been changed/,
  );
  assert.ok(!calls.some((call) => call[0] === "upsert"));
});
test("an uncertain database response retains the upload for a safe retry", async () => {
  const { api, calls } = harness({
    writeError: { message: "connection lost after commit" },
  });
  await assert.rejects(
    api.saveAccountProject(owner, draft()),
    /couldn’t confirm/,
  );
  assert.ok(calls.some((call) => call[0] === "upload"));
  assert.ok(!calls.some((call) => call[0] === "remove"));
});
test("saving uses a versioned owner path and updates the same project identity", async () => {
  const { api, calls } = harness();
  const saved = await api.saveAccountProject(owner, draft());
  const upload = calls.find((call) => call[0] === "upload");
  const update = calls.find((call) => call[0] === "upsert");
  assert.ok(upload[1].startsWith(`${owner}/${projectId}/`));
  assert.equal(upload[3].upsert, false);
  assert.equal(update[1].id, projectId);
  assert.equal(update[1].user_id, owner);
  assert.equal(update[1].source_path, upload[1]);
  assert.equal(saved.sourcePath, upload[1]);
  assert.ok(calls.indexOf(upload) < calls.indexOf(update));
});
test("private thumbnail failure does not turn a successful save into a failed save", async () => {
  const { api } = harness({ thumbnailError: true });
  const saved = await api.saveAccountProject(owner, draft());
  assert.equal(saved.id, projectId);
  assert.equal(saved.thumbnailUrl, "");
});
test("the gallery filters ownership and uses five-minute private thumbnails", async () => {
  const { api, calls } = harness();
  const projects = await api.listAccountProjects(owner);
  assert.ok(
    calls.some(
      (call) => call[0] === "eq" && call[1] === "user_id" && call[2] === owner,
    ),
  );
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 100));
  assert.equal(calls.find((call) => call[0] === "signedUrls")[2], 300);
  assert.equal(projects[0].imageName, "bottle.jpg");
});
test("opening refuses a photo path outside the project owner folder", async () => {
  const { api, calls } = harness({
    readRow: { ...row(), source_path: "other-account/private.jpg" },
  });
  await assert.rejects(
    api.openAccountProject(owner, projectId),
    /could not be verified/,
  );
  assert.ok(!calls.some((call) => call[0] === "download"));
});
test("opening downloads the original with authenticated storage access", async () => {
  const { api, calls } = harness();
  const opened = await api.openAccountProject(owner, projectId);
  assert.equal(opened.image.type, "image/jpeg");
  assert.equal(opened.name, "Test bottle");
  assert.ok(
    calls.some(
      (call) => call[0] === "download" && call[1] === row().source_path,
    ),
  );
});
test("validation rejects unsupported files and unnamed projects before any network call", async () => {
  const { api, calls } = harness();
  await assert.rejects(
    api.saveAccountProject(owner, { ...draft(), name: " " }),
    /product name/,
  );
  await assert.rejects(
    api.saveAccountProject(owner, {
      ...draft(),
      image: new Blob(["bad"], { type: "text/html" }),
    }),
    /JPG/,
  );
  assert.equal(calls.length, 0);
});
test("a failed gallery query is surfaced instead of appearing as an empty library", async () => {
  const { api } = harness({ listError: { message: "offline" } });
  await assert.rejects(api.listAccountProjects(owner), /could not be loaded/);
});
