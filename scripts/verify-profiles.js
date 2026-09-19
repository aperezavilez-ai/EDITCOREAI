const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5ODQ5MzMyLCJleHAiOjIxMDUyMDkzMzJ9.3LsN9Eis_cCkPT9sWJQwM9RmreAqM8-7Io0Uv2RqkdQ";

async function checkAdminProfile() {
  const url = "https://supabase.gafcore.com/editcore-ai/rest/v1";
  
  // Consultar perfiles
  const res = await fetch(`${url}/profiles?select=*`, {
    headers: { apikey: key, Authorization: "Bearer " + key }
  });
  console.log("Profiles Status:", res.status);
  const data = await res.json();
  console.log("Current Profiles in GafCore:", data);
}
checkAdminProfile();
