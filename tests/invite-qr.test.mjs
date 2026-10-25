import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { buildInviteLink } from "../src/lib/staff-demo.mjs";
import { createInviteQrDataUrl, isLocalInviteUrl } from "../src/lib/invite-qr.mjs";

test("invite QR generation uses the complete fragment URL and returns a PNG", async () => {
  const token = "a".repeat(43);
  const inviteLink = buildInviteLink("http://localhost:3000", token);
  const [segment] = QRCode.create(inviteLink).segments;

  assert.equal(Buffer.from(segment.data).toString("utf8"), inviteLink);

  const pngDataUrl = await createInviteQrDataUrl(inviteLink);
  assert.match(pngDataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(
    Buffer.from(pngDataUrl.split(",")[1], "base64").subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});

test("local invite URLs are identified for the phone-testing note", () => {
  assert.equal(isLocalInviteUrl("http://localhost:3000/join#token=test"), true);
  assert.equal(isLocalInviteUrl("http://127.0.0.1:3000/join#token=test"), true);
  assert.equal(isLocalInviteUrl("https://amrut.example/join#token=test"), false);
  assert.equal(isLocalInviteUrl("not a URL"), false);
});
