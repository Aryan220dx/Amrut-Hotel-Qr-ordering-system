import QRCode from "qrcode";

/** @param {string} inviteLink */
export function createInviteQrDataUrl(inviteLink) {
  return QRCode.toDataURL(inviteLink, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
  });
}

/** @param {string} value */
export function isLocalInviteUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
