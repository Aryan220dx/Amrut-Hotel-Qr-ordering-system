"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createInviteQrDataUrl, isLocalInviteUrl } from "@/lib/invite-qr.mjs";
import styles from "./staff.module.css";

export default function InviteQr({ inviteLink }: { inviteLink: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let active = true;

    void createInviteQrDataUrl(inviteLink)
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrError(true);
      });

    return () => { active = false; };
  }, [inviteLink]);

  const downloadQr = () => {
    if (!qrDataUrl) return;
    const download = document.createElement("a");
    download.href = qrDataUrl;
    download.download = "hotel-amrut-guest-invite.png";
    download.click();
  };

  return (
    <section className={styles.qrBlock} aria-label="Guest invite QR code">
      <h3 className={styles.qrHeading}>Scan to join</h3>
      {qrDataUrl ? (
        <div className={styles.qrPreview}>
          <Image
            src={qrDataUrl}
            alt="QR code for the current guest invite"
            width={256}
            height={256}
            unoptimized
          />
        </div>
      ) : qrError ? (
        <p className={styles.error} role="alert">Could not generate the invite QR code. You can still use the invite link above.</p>
      ) : (
        <p className={styles.status} role="status" aria-live="polite">Generating QR code…</p>
      )}
      <button className="outline-button" disabled={!qrDataUrl} onClick={downloadQr} type="button">
        Download QR
      </button>
      {isLocalInviteUrl(inviteLink) && (
        <p className={styles.note}>
          This QR works only on this computer. Phone testing needs a network-reachable app and Supabase URL.
        </p>
      )}
    </section>
  );
}
