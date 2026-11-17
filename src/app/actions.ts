"use server";

import { revalidatePath } from "next/cache";
import { runAnalyst, type AnalystResult } from "@/lib/agents/analyst";
import { getOwner } from "@/lib/queries";

export async function runAnalystAction(_prev: AnalystResult | null): Promise<AnalystResult> {
  const owner = await getOwner();
  if (!owner) return { ok: false, error: "No user found. Run the database setup first." };
  const result = await runAnalyst(owner.id, 90);
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/insights");
  }
  return result;
}
