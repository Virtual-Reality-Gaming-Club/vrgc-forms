const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, serverTimestamp } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
}
loadEnv();

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || ""
};

async function initFirestoreCollections() {
  console.log(`🔥 Initializing Firestore collections for Firebase project: '${firebaseConfig.projectId}'...`);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // 1. Initialize `payments` collection (Non-destructive check)
  console.log("\n📦 Checking 'payments' collection...");
  try {
    const paymentsRef = collection(db, 'payments');
    const paymentsSnap = await getDocs(paymentsRef);
    console.log(`  Existing documents in 'payments': ${paymentsSnap.size}`);

    if (paymentsSnap.size === 0) {
      console.log("  Creating initial sample payment in 'payments' collection...");
      const sampleDocId = 'initial_membership_fee_2026';
      await setDoc(doc(db, 'payments', sampleDocId), {
        user_email: 'vrgc@vitbhopal.ac.in',
        title: 'VRGC Membership Fee 2026',
        description: 'Annual club membership fee covering VR lab access, discord perks, and workshop priority.',
        category: 'Club Fee',
        amount: 500,
        currency: 'INR',
        status: 'Pending',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        source: 'vrgc-forms',
      });
      console.log(`  ✅ Successfully created document '${sampleDocId}' in 'payments' collection!`);
    } else {
      console.log("  ✅ 'payments' collection already contains data. No existing records modified.");
    }
  } catch (err) {
    console.error("  ❌ Error accessing 'payments' collection:", err.message);
  }

  // 2. Initialize `invoices` collection (Non-destructive check)
  console.log("\n🧾 Checking 'invoices' collection...");
  try {
    const invoicesRef = collection(db, 'invoices');
    const invoicesSnap = await getDocs(invoicesRef);
    console.log(`  Existing documents in 'invoices': ${invoicesSnap.size}`);

    if (invoicesSnap.size === 0) {
      console.log("  Creating initial invoice log in 'invoices' collection...");
      const sampleInvoiceId = 'initial_invoice_log_2026';
      await setDoc(doc(db, 'invoices', sampleInvoiceId), {
        payment_id: 'initial_membership_fee_2026',
        user_email: 'vrgc@vitbhopal.ac.in',
        payment_title: 'VRGC Membership Fee 2026',
        amount: 500,
        currency: 'INR',
        status: 'Pending',
        payment_method: 'Razorpay Online',
        error_description: '',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        source: 'vrgc-forms',
      });
      console.log(`  ✅ Successfully created document '${sampleInvoiceId}' in 'invoices' collection!`);
    } else {
      console.log("  ✅ 'invoices' collection already contains data. No existing records modified.");
    }
  } catch (err) {
    console.error("  ❌ Error accessing 'invoices' collection:", err.message);
  }

  console.log("\n🎉 Firestore 'payments' and 'invoices' collections initialized successfully!");
}

initFirestoreCollections().catch(console.error);
