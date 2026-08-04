/**
 * Send helpers for Outlook (Microsoft Graph) and Zoho Mail API.
 */
export async function sendViaMicrosoftGraph(
  accessToken: string,
  message: {
    to: string
    subject: string
    html: string
    text: string
    headers?: Record<string, string>
  }
): Promise<{ messageId?: string }> {
  const internetMessageHeaders = Object.entries(message.headers ?? {}).map(([name, value]) => ({
    name,
    value,
  }))

  const body: Record<string, unknown> = {
    message: {
      subject: message.subject,
      body: {
        contentType: 'HTML',
        content: message.html || message.text.replace(/\n/g, '<br/>'),
      },
      toRecipients: [{ emailAddress: { address: message.to } }],
      ...(internetMessageHeaders.length
        ? { internetMessageHeaders }
        : {}),
    },
    saveToSentItems: true,
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Microsoft Graph send failed (${res.status}): ${txt}`)
  }

  // sendMail returns 202 with empty body
  return { messageId: `graph-${Date.now()}` }
}

export async function sendViaZohoMail(
  accessToken: string,
  fromEmail: string,
  message: {
    to: string
    subject: string
    html: string
    text: string
  }
): Promise<{ messageId?: string }> {
  const accountRes = await fetch('https://mail.zoho.com/api/accounts', {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  if (!accountRes.ok) {
    const txt = await accountRes.text()
    throw new Error(`Zoho accounts lookup failed (${accountRes.status}): ${txt}`)
  }
  const accountData = (await accountRes.json()) as {
    data?: Array<{ accountId?: string; sendMailDetails?: Array<{ fromAddress?: string }> }>
  }
  const accounts = accountData.data ?? []
  const matched =
    accounts.find((a) =>
      a.sendMailDetails?.some(
        (d) => d.fromAddress?.toLowerCase() === fromEmail.toLowerCase()
      )
    ) ?? accounts[0]
  const accountId = matched?.accountId
  if (!accountId) throw new Error('No Zoho mail account found for send')

  const res = await fetch(`https://mail.zoho.com/api/accounts/${accountId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fromAddress: fromEmail,
      toAddress: message.to,
      subject: message.subject,
      content: message.html || message.text,
      mailFormat: 'html',
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Zoho send failed (${res.status}): ${txt}`)
  }

  const data = (await res.json()) as { data?: { messageId?: string } }
  return { messageId: data.data?.messageId ?? `zoho-${Date.now()}` }
}
