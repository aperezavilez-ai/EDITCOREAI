const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5ODQ5MzMyLCJleHAiOjIxMDUyMDkzMzJ9.3LsN9Eis_cCkPT9sWJQwM9RmreAqM8-7Io0Uv2RqkdQ";

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
