import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const QUALTRICS_API_TOKEN = Deno.env.get("QUALTRICS_API_TOKEN");
const QUALTRICS_SURVEY_ID = Deno.env.get("QUALTRICS_SURVEY_ID");
const QUALTRICS_DATACENTER = Deno.env.get("QUALTRICS_DATACENTER");
const SYLLABUS_LINK = Deno.env.get("SYLLABUS_LINK") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";

// Define headers once to use everywhere (Fixes the CORS error)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req: Request): Promise<Response> => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 2. Enforce POST Method
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // 3. Parse Body securely
  let body: { query: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  // 4. Check for API Key
  if (!OPENAI_API_KEY) {
    return new Response("Missing OpenAI API key. Check Deno Environment Variables.", { status: 500, headers: corsHeaders });
  }

  // 5. Load Syllabus
  const syllabus = await Deno.readTextFile("syllabus.md").catch(() =>
    "Error loading syllabus."
  );

  const messages = [
    {
      role: "system",
      content: "You are an accurate assistant. Always include a source URL if possible."
    },
    {
      role: "system",
      content: `Here is important context from syllabus.md:\n${syllabus}`,
    },
    {
      role: "user",
      content: body.query,
    },
  ];

  // 6. Call OpenAI
  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      max_tokens: 1500,
    }),
  });

  const openaiJson = await openaiResponse.json();
  const baseResponse = openaiJson?.choices?.[0]?.message?.content || "No response from OpenAI";
  const result = `${baseResponse}\n\nThere may be errors in my responses; always refer to the course web page: ${SYLLABUS_LINK}`;

  // 7. Qualtrics Logging (Wrapped in try/catch to prevent crashing)
  let qualtricsStatus = "Qualtrics not called (Check Env Vars)";
  
  if (QUALTRICS_API_TOKEN && QUALTRICS_SURVEY_ID && QUALTRICS_DATACENTER) {
    try {
      const qualtricsPayload = {
        values: {
          responseText: result,
          queryText: body.query,
        },
      };

      const qt = await fetch(`https://${QUALTRICS_DATACENTER}.qualtrics.com/API/v3/surveys/${QUALTRICS_SURVEY_ID}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-TOKEN": QUALTRICS_API_TOKEN,
        },
        body: JSON.stringify(qualtricsPayload),
      });

      qualtricsStatus = `Qualtrics status: ${qt.status}`;
    } catch (e) {
      console.error(e);
      qualtricsStatus = "Qualtrics connection failed";
    }
  }

  // 8. Return Final Response
  // I changed '' to '[System Log:]' so it is forced to be visible in the browser
  return new Response(`${result}\n\n[System Log: ${qualtricsStatus}]`, {
    headers: {
      "Content-Type": "text/plain",
      ...corsHeaders,
    },
  });
});
