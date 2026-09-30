const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!key) {
  console.error("Falta SUPABASE_ANON_KEY: node --env-file=.env.local scripts/test-supabase-key.js");
  process.exit(1);
}

async function testSupabase() {
  const urls = [
    "https://supabase.gafcore.com",
    "https://supabase.gafcore.com/editcore-ai",
    "https://supabase.gafcore.com/rest/v1"
  ];

  for (const u of urls) {
    try {
      const res = await fetch(`${u}/rest/v1/profiles?select=*`, {
        headers: { apikey: key, Authorization: "Bearer " + key }
      });
      console.log(`URL ${u} -> Status: ${res.status}`);
      if (res.status === 200) {
        const data = await res.json();
        console.log("Profiles in database:", data);
      }
    } catch (e) {
      console.log(`Error on ${u}:`, e.message);
    }
  }
}
testSupabase();
