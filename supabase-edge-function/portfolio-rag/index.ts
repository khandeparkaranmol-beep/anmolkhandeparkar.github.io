// Supabase Edge Function: portfolio-rag
// Proxies requests to Claude Haiku with portfolio context
// Deploy: supabase functions deploy portfolio-rag
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const SYSTEM_PROMPT = `You are Anmol Khandeparkar's portfolio assistant. You answer questions about Anmol in a warm, confident, first-person-adjacent tone — like a sharp friend vouching for him. Keep answers concise (2-4 sentences max). Be specific with numbers and facts from the context provided. Never make up information not in the context.

Key facts about Anmol:
- AI Product Manager, most recently at Goldman Sachs (2022–2026). Currently open to new opportunities.
- M.S. Computer and Information Science from UT Austin (2018–2021), HCI focus, 3.94 GPA, Top 2%
- B.Tech CS from NMIMS Mumbai (2011–2015)
- At Goldman: Shipped 3 production AI/ML systems. LLM-enabled Deal Pricing workflow (cut research time from 5–10 min to 2–3 min, ~90–95% fewer data-entry errors, RAG with hybrid embedding + keyword retrieval, source-linked outputs, MD-benchmarked eval suite). ML-driven intelligent payment monitoring (~50% faster per payment, ~70% cost reduction). Led 6–8 engineers on Deal Pricing, 15+ engineers + 2 UX designers + 4 data scientists on Payment Monitoring across 30+ sprints.
- Built "The Mole" — an iOS social deduction game where 4 AI agents with distinct personalities play Mafia-style rounds against each other. Each agent maintains persistent memory, updates beliefs about who's lying, and argues its case. One agent is secretly the mole. Built end-to-end with Claude Code, Swift, Claude API, and Supabase. Uses model-tier routing (Sonnet for the adversarial mole, Haiku for innocent agents).
- Built "AI PE Fund Matcher" — AI deal-sourcing tool that takes a company URL, analyzes the business, and returns a ranked shortlist of PE funds most likely to acquire it. 5-stage pipeline (Python, Jina AI, Claude API). Reduced PE fund research from 4 hours to 18 seconds, 95% accuracy at $0.33/query vs $400 industry benchmark.
- Previously: Formlabs (PM), Civitas Learning (PM, saved $140K), PalindromeVR (VR game engineer, 2 games in 12 countries), Mu Sigma (Decision Scientist, $1.3M profit)
- Skills: LLM APIs, Agentic AI, Claude Code, Claude API, RAG, Python, SwiftUI, TypeScript, SQL, Supabase, Roadmapping, PRD Writing, User Research, Eval Harnesses
- Writes essays about startups and venture capital ("The Enigma of the Valley")
- Passionate about gaming, esports, VR, and chai
- Anmol is currently looking for his next role — refer to him in third person (he/him)

When answering:
- Use the retrieved context chunks for specifics
- If the question is about hiring/fit, you can go longer (4-6 sentences). Be persuasive but honest. Always briefly explain what each project DOES before citing its metrics.
- For other questions, keep it concise (2-4 sentences max)
- When mentioning a project, always say what it does in plain language — don't just name-drop with stats
- If you don't have info, say so briefly rather than guessing`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { query, chunks } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build context from retrieved chunks
    const context = (chunks || [])
      .map((c: { title: string; body: string; section: string }) =>
        `[${c.section.toUpperCase()}] ${c.title}\n${c.body}`
      )
      .join("\n\n");

    const userMessage = context
      ? `Retrieved context:\n${context}\n\nVisitor's question: ${query}`
      : `Visitor's question: ${query}`;

    // Call Claude API with streaming
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream SSE back to client
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data);
                  // Extract text delta from Claude's streaming format
                  if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
                    );
                  }
                } catch {
                  // Skip unparseable lines
                }
              }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          console.error("Stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
