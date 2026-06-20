import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import OpenAI from "jsr:@openai/openai"

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
})

// Initialize Supabase Client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

Deno.serve(async (req) => {
  try {
    const { messageContent, conversationId, organizationId } = await req.json()

    if (!messageContent || !conversationId) {
       return new Response("Missing required fields", { status: 400 })
    }

    // 1. Fetch conversation history for context (optional but recommended)
    // For MVP, we will just analyze the single latest message
    
    // 2. Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost-effective model
      messages: [
        { 
          role: "system", 
          content: `You are an AI assistant for a sales CRM. Analyze the incoming customer WhatsApp message.
          
          Respond ONLY with a JSON object in this exact format:
          {
            "intent": "What the user wants (e.g., Pricing Inquiry, Support, Meeting Request)",
            "sentiment": "Positive/Neutral/Negative",
            "urgency": "low/medium/high",
            "suggested_reply": "A professional, concise suggested reply for the sales rep to send back."
          }` 
        },
        { role: "user", content: messageContent }
      ],
      response_format: { type: "json_object" }
    })

    const analysis = completion.choices[0].message.content
    
    if (!analysis) throw new Error("No response from OpenAI")
      
    const parsedAnalysis = JSON.parse(analysis)

    // 3. Store the insight in Supabase
    const { error: dbError } = await supabase
      .from('ai_insights')
      .insert({
        conversation_id: conversationId,
        organization_id: organizationId,
        intent: parsedAnalysis.intent,
        sentiment: parsedAnalysis.sentiment,
        urgency: parsedAnalysis.urgency,
        suggested_reply: parsedAnalysis.suggested_reply
      })

    if (dbError) {
      console.error("Database Error:", dbError)
      throw dbError
    }

    return new Response(
      JSON.stringify({ success: true, insight: parsedAnalysis }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err) {
    console.error(err)
    return new Response(String(err?.message ?? err), { status: 500 })
  }
})
