import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { CONFIG } from "@/lib/config";
import { authenticateRequest } from "@/lib/server/auth";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

async function generateUniqueTicketId(): Promise<string> {
  // Generate cryptographically secure ticket ID: VRGC-SUP-XXXXXX (6 digits)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateId = `VRGC-SUP-${crypto.randomInt(100000, 1000000)}`;
    const docSnap = await adminDb.collection("support_tickets").doc(candidateId).get();
    if (!docSnap.exists) {
      return candidateId;
    }
  }
  // High-entropy fallback if 5 consecutive collisions occur
  const entropy = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `VRGC-SUP-${Date.now().toString().slice(-4)}${entropy}`;
}

async function isAuthorizedToManageTickets(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Authoritative server-side configuration lists (Admin & Super Admin)
  if (
    CONFIG.ADMIN_EMAILS.includes(normalized) ||
    CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)
  ) {
    return true;
  }

  // 2. Dynamic Firestore admins / super_admins collections
  try {
    const adminDoc = await adminDb.collection("admins").doc(normalized).get();
    if (adminDoc.exists) return true;

    const superDoc = await adminDb.collection("super_admins").doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn("[Support API] Admin authorization check notice:", err);
  }

  return false;
}

export async function POST(req: Request) {
  let ticketId = "VRGC-SUP-PENDING";
  try {
    const body = await req.json().catch(() => ({}));
    const { fullName, contactInfo, regNo, category, message } = body;

    if (
      !fullName ||
      !contactInfo ||
      !message ||
      typeof fullName !== "string" ||
      typeof contactInfo !== "string" ||
      typeof message !== "string" ||
      !fullName.trim() ||
      !contactInfo.trim() ||
      !message.trim()
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Generate authoritative ticket ID server-side (ignore any client-supplied ticketId)
    ticketId = await generateUniqueTicketId();

    const formattedRegNo = regNo ? String(regNo).trim().toUpperCase() : "Not provided";
    const nowIso = new Date().toISOString();

    // 1. Always record ticket in Firebase Firestore
    try {
      await adminDb.collection("support_tickets").doc(ticketId).set({
        ticketId,
        fullName: fullName.trim(),
        contactInfo: contactInfo.trim(),
        regNo: formattedRegNo,
        category: category || "general",
        message: message.trim(),
        status: "unsolved",
        solvedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      console.log(`[Support Desk] Saved ticket ${ticketId} to Firestore.`);
    } catch (dbErr) {
      console.error("[Support Desk] Firestore save error:", dbErr);
    }

    // 2. Proactively sweep and purge any solved tickets older than 12 hours from Firebase
    try {
      const nowMs = Date.now();
      const snap = await adminDb
        .collection("support_tickets")
        .where("status", "==", "solved")
        .get();
      const expiredRefs: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.solvedAt) {
          const solvedMs = new Date(data.solvedAt).getTime();
          if (!isNaN(solvedMs) && (nowMs - solvedMs) >= TWELVE_HOURS_MS) {
            expiredRefs.push(d.ref);
          }
        }
      });
      if (expiredRefs.length > 0) {
        const batch = adminDb.batch();
        expiredRefs.forEach((ref) => batch.delete(ref));
        await batch.commit();
        console.log(`[Support Desk API] Purged ${expiredRefs.length} expired ticket(s) from Firebase.`);
      }
    } catch (purgeErr) {
      console.warn("[Support Desk API] Auto-sweep notice:", purgeErr);
    }

    // 3. Format Message Body for Email / Formspree notification
    const formattedText = `
--------------------------------------------------
🚨 VRGC TECHNICAL SUPPORT TICKET: [${ticketId}]
--------------------------------------------------

ASSIGNED TO: Technical Support Desk
CATEGORY   : ${(category || "general").toUpperCase()}

--- USER DETAILS ---
FULL NAME : ${fullName}
REG / ROLL: ${formattedRegNo}
CONTACT   : ${contactInfo}

--- ISSUE DESCRIPTION ---
${message}

--------------------------------------------------
Automated message sent via VRGC Forms Technical Support Desk
`;

    // 4. Optional: Dispatch email notification via Formspree if configured
    const formspreeUrl = process.env.FORMSPREE_URL;
    if (formspreeUrl) {
      try {
        const formspreeResponse = await fetch(formspreeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            ticketId,
            name: fullName,
            email: contactInfo,
            regNo: formattedRegNo,
            category,
            message: formattedText,
            _replyto: contactInfo,
            _subject: `[${ticketId}] Support Ticket: ${(category || "GENERAL").toUpperCase()} - ${fullName}`,
          }),
        });

        if (!formspreeResponse.ok) {
          console.warn("[Support Desk] Formspree dispatch non-ok:", await formspreeResponse.text());
        }
      } catch (fsErr) {
        console.warn("[Support Desk] Formspree dispatch failed, ticket is saved in Firestore:", fsErr);
      }
    }

    return NextResponse.json({
      success: true,
      ticketId,
      message: "Your support ticket has been received and logged successfully!",
    });
  } catch (error: any) {
    console.error("Error in support API route:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process support request" },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to manually delete a support ticket from Firebase by ticketId.
 * Requires authenticated Administrator or Super Administrator credentials.
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get("ticketId")?.trim().toUpperCase();

    if (!ticketId) {
      return NextResponse.json({ error: "Missing ticketId parameter" }, { status: 400 });
    }

    // 1. Cryptographically verify Firebase ID token in Authorization header
    const { user, errorResponse } = await authenticateRequest(req);
    if (errorResponse) {
      return errorResponse;
    }

    // 2. Authorize caller identity against authoritative admin lists
    const isAuthorized = await isAuthorizedToManageTickets(user.email);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Forbidden: Only authorized administrators can delete support tickets." },
        { status: 403 }
      );
    }

    // Delete direct doc
    await adminDb.collection("support_tickets").doc(ticketId).delete().catch(() => {});

    // Also query and delete matching ticketId
    const snap = await adminDb.collection("support_tickets").where("ticketId", "==", ticketId).get();
    if (!snap.empty) {
      const batch = adminDb.batch();
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      message: `Ticket ${ticketId} permanently deleted from Firebase.`,
    });
  } catch (error: any) {
    console.error("Error deleting support ticket via API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete ticket" },
      { status: 500 }
    );
  }
}
