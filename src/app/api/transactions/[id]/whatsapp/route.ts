import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServiceRoleClient();
    
    const authData = request.headers.get('x-auth-data');
    if (!authData) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { store_id } = JSON.parse(authData);
    const { phone } = await request.json();
    
    // Get the id from params (Next.js 15 has params as Promise)
    const { id } = await params;

    // Update transaction with WhatsApp phone number
    const { data, error } = await supabase
      .from("transactions")
      .update({
        whatsapp_sent_to: phone,
        whatsapp_sent_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("store_id", store_id)
      .select()
      .single();

    if (error) {
      console.error("Update error:", error);
      return NextResponse.json({ error: "Failed to update transaction", details: error }, { status: 500 });
    }

    return NextResponse.json({ transaction: data });
  } catch (error: any) {
    console.error("Error saving WhatsApp phone:", error);
    return NextResponse.json({ 
      error: "Failed to save WhatsApp phone", 
      details: error?.message || String(error) 
    }, { status: 500 });
  }
}