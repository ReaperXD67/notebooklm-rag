import { NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion } from "@/lib/rag";

export const runtime = "nodejs";
export const maxDuration = 60;

const chatSchema = z.object({
  documentId: z.string().uuid(),
  question: z.string().min(2).max(2000),
  options: z
    .object({
      topK: z.number().int().min(3).max(10).optional(),
      strictMode: z.boolean().optional()
    })
    .optional()
});

export async function POST(request: Request) {
  try {
    const body = chatSchema.parse(await request.json());
    const result = await answerQuestion({
      documentId: body.documentId,
      question: body.question,
      topK: body.options?.topK ?? 6,
      strictMode: body.options?.strictMode ?? true
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected chat failure.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
