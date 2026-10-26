import test from "node:test";
import assert from "node:assert/strict";
import { resolveBrowserSupabaseUrl } from "../src/lib/browser-supabase-url.mjs";

test("LAN browser uses the host device for a loopback Supabase URL", () => {
  assert.equal(
    resolveBrowserSupabaseUrl("http://127.0.0.1:54321", "http://192.168.1.25:3000"),
    "http://192.168.1.25:54321/",
  );
});

test("localhost browser keeps the configured Supabase URL", () => {
  assert.equal(
    resolveBrowserSupabaseUrl("http://127.0.0.1:54321", "http://localhost:3000"),
    "http://127.0.0.1:54321/",
  );
});

test("hosted Supabase URLs are never rewritten", () => {
  assert.equal(
    resolveBrowserSupabaseUrl("https://project.supabase.co", "http://192.168.1.25:3000"),
    "https://project.supabase.co/",
  );
});
