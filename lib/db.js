// /lib/db.js
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE, // server-side only
  { auth: { persistSession: false } }
);

export async function upsertCustomer(email){
  await supabase.from("customers").upsert({ email }).select().single();
}

export async function createLicense({ email, order_id, plan="pro" }){
  const { data, error } = await supabase
    .from("licenses")
    .insert({ email, order_id, plan, status:"active" })
    .select()
    .single();
  if(error) throw error;
  return data; // {id, email, ...}
}

export async function getLicenseById(id){
  const { data, error } = await supabase.from("licenses").select("*").eq("id", id).single();
  if(error) throw error;
  return data;
}

export async function getActiveLicenseByEmailAndId(email, id){
  const { data, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("id", id)
    .eq("email", email)
    .eq("status","active")
    .single();
  if(error) throw error;
  return data;
}

export async function createWidget({ id, license_id, email, db_id, bio_db_id }){
  const { data, error } = await supabase
    .from("widgets")
    .insert({ id, license_id, email, db_id, bio_db_id })
    .select()
    .single();
  if(error) throw error;
  return data;
}
