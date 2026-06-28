import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, requireApprovedRole } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    const auth = await requireApprovedRole(req, ['admin', 'manager', 'director'])
    if (auth instanceof Response) return auth

    const { to, subject, body, attachmentBase64, attachmentName, attachmentType } = await req.json()

    // Validate required fields
    if (!to || !subject || !body) {
      return jsonResponse(req, { error: 'Missing required fields: to, subject, body' }, 400)
    }

    const recipients = Array.isArray(to) ? to : [to]

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalidEmails = recipients.filter((email: string) => !emailRegex.test(email))
    if (invalidEmails.length > 0) {
      return jsonResponse(req, { error: `Invalid email addresses: ${invalidEmails.join(', ')}` }, 400)
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'

    if (!RESEND_API_KEY) {
      return jsonResponse(req, { error: 'RESEND_API_KEY not configured' }, 500)
    }

    const payload: Record<string, unknown> = {
      from: FROM_EMAIL,
      to: recipients,
      subject,
      html: body,
    }

    if (attachmentBase64 && attachmentName) {
      payload.attachments = [{
        filename: attachmentName,
        content: attachmentBase64,
        type: attachmentType || 'application/pdf',
      }]
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.message || `Resend API error: ${res.status}`)
    }

    // Audit log via Supabase service role
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (supabaseUrl && supabaseServiceKey) {
        const client = createClient(supabaseUrl, supabaseServiceKey)
        await client.from('audit_log').insert({
          action: 'email_report_sent',
          details: {
            to: recipients,
            subject,
            has_attachment: !!attachmentBase64,
            attachment_name: attachmentName || null,
            resend_id: data.id,
          },
          created_at: new Date().toISOString(),
        })
      }
    } catch (_auditErr) {
      // Non-fatal: audit log failure should not block email delivery response
    }

    return jsonResponse(req, { success: true, id: data.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonResponse(req, { error: message }, 500)
  }
})
