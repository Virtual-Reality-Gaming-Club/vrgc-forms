import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, setDoc, deleteDoc, collection, query, where, getDocs, writeBatch } from "firebase/firestore";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export async function POST(req: Request) {
  let ticketId = "VRGC-SUP-PENDING";
  try {
    const body = await req.json();
    const { fullName, contactInfo, regNo, category, message } = body;
    if (body.ticketId) {
      ticketId = body.ticketId;
    } else {
      ticketId = `VRGC-SUP-${Math.floor(100000 + Math.random() * 900000)}`;
    }

    if (!fullName || !contactInfo || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const formattedRegNo = regNo ? String(regNo).trim().toUpperCase() : "Not provided";
    const nowIso = new Date().toISOString();

    // 1. Always record ticket in Firebase Firestore
    try {
      await setDoc(doc(db, "support_tickets", ticketId), {
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
      const q = query(
        collection(db, "support_tickets"),
        where("status", "==", "solved")
      );
      const snap = await getDocs(q);
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
        const batch = writeBatch(db);
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
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get("ticketId")?.trim().toUpperCase();

    if (!ticketId) {
      return NextResponse.json({ error: "Missing ticketId parameter" }, { status: 400 });
    }

    // Delete direct doc
    await deleteDoc(doc(db, "support_tickets", ticketId)).catch(() => {});

    // Also query and delete matching ticketId
    const q = query(collection(db, "support_tickets"), where("ticketId", "==", ticketId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const batch = writeBatch(db);
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
