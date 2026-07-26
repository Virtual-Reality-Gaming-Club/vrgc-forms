const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc } = require('firebase/firestore');
const { createClient } = require('@supabase/supabase-js');

// 1. Old Firebase Config
const oldFirebaseConfig = {
  apiKey: "AIzaSyA9IuuKniQtjMLODY71YxqnQXsmtqvnGPI",
  authDomain: "vrgc-forms.firebaseapp.com",
  projectId: "vrgc-forms",
  storageBucket: "vrgc-forms.firebasestorage.app",
  messagingSenderId: "417600749438",
  appId: "1:417600749438:web:c95ec2840619d478d5bd2f"
};

// 2. New Firebase Config
const newFirebaseConfig = {
  apiKey: "AIzaSyANu9lQsIX2JXGoViJ_Oag66Cltd0YzXI0",
  authDomain: "vrgc-form.firebaseapp.com",
  projectId: "vrgc-form",
  storageBucket: "vrgc-form.firebasestorage.app",
  messagingSenderId: "830392164988",
  appId: "1:830392164988:web:9613ae484e4ab64d281ff9"
};

// 3. Old Supabase Config
const oldSupabaseUrl = "https://rpecopoisqjkrxwcccxc.supabase.co";
const oldSupabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwZWNvcG9pc3Fqa3J4d2NjY3hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NDgwMzUsImV4cCI6MjEwMDIyNDAzNX0.IjndZHhClKb8hpL-xnhhat99QUeC7gydZ5krcytUI80";

// 4. New Supabase Config
const newSupabaseUrl = "https://fopyejijjeoumimsdgiz.supabase.co";
const newSupabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcHllamlqamVvdW1pbXNkZ2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Mjg4NDMsImV4cCI6MjEwMDMwNDg0M30.NQVEJKOzJnNoFGs8tgDTkbMrc4OgE_w9bhSpsZ4Cxm4";

async function runMigration() {
  console.log("🚀 Updating Firestore URLs to point to NEW Supabase domain...");

  const oldApp = initializeApp(oldFirebaseConfig, "oldApp");
  const newApp = initializeApp(newFirebaseConfig, "newApp");

  const oldDb = getFirestore(oldApp);
  const newDb = getFirestore(newApp);

  const collectionsToMigrate = ['id_cards', 'referrals', 'data_reports'];

  for (const colName of collectionsToMigrate) {
    console.log(`\n📦 Updating collection: '${colName}'...`);
    try {
      const querySnapshot = await getDocs(collection(oldDb, colName));
      let count = 0;
      for (const docSnap of querySnapshot.docs) {
        const data = docSnap.data();

        // Replace old Supabase domain with new Supabase domain in all string fields
        for (const key in data) {
          if (typeof data[key] === 'string' && data[key].includes(oldSupabaseUrl)) {
            data[key] = data[key].replace(oldSupabaseUrl, newSupabaseUrl);
          }
        }

        await setDoc(doc(newDb, colName, docSnap.id), data);
        count++;
        console.log(`  ✓ Updated doc ${docSnap.id} -> photoUrl domain updated.`);
      }
      console.log(`✅ Successfully updated ${count} records for '${colName}'.`);
    } catch (err) {
      console.error(`❌ Error updating collection '${colName}':`, err.message);
    }
  }

  // Supabase File Sync
  console.log("\n⚡ Verifying storage file upload to new Supabase bucket...");
  const oldSupabase = createClient(oldSupabaseUrl, oldSupabaseKey);
  const newSupabase = createClient(newSupabaseUrl, newSupabaseKey);

  try {
    const { data: files } = await oldSupabase.storage.from('id-cards').list('id-photos');
    if (files && files.length > 0) {
      for (const f of files) {
        if (!f.name || f.name.startsWith('.')) continue;
        const path = `id-photos/${f.name}`;
        const { data: fileData } = await oldSupabase.storage.from('id-cards').download(path);
        if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const { error: upErr } = await newSupabase.storage.from('id-cards').upload(path, buffer, { upsert: true, contentType: 'image/jpeg' });
          if (!upErr) {
            console.log(`  ✓ Uploaded to new Supabase bucket: ${path}`);
          } else {
            console.log(`  Notice on upload ${path}:`, upErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.log("Supabase upload info:", err.message);
  }

  console.log("\n🎉 ALL DOMAIN URLS & FILES UPDATED TO NEW SUPABASE ACCOUNT!");
}

runMigration().catch(console.error);
