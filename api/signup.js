// /api/signup — receives the capture form, triggers the Twilio Studio welcome flow.
//
// Works in a plain static Vercel project: any file in /api becomes a serverless
// function automatically. No framework needed.
//
// ── Setup (Vercel dashboard → lof-site project → Settings → Environment Variables) ──
//   TWILIO_ACCOUNT_SID     from Twilio Console home
//   TWILIO_AUTH_TOKEN      from Twilio Console home
//   VENUE_208_FLOW_SID     the Studio Flow SID (starts with FW...) once the flow exists
//   VENUE_208_FROM_NUMBER  208's Twilio number in E.164, e.g. +19125551234
//
// Until those are set, this function runs in DEMO MODE: it validates and logs the
// signup and returns success, so the page works end-to-end before Twilio is live.
// Check Vercel → project → Logs to see the captured payloads while demoing.

// Map venue IDs (from the page's VENUE.id) to their Twilio config.
// Adding Fish Bar later = add one entry here + two env vars.
const VENUES = {
  '208-wine-bar': {
    flowSid: process.env.VENUE_208_FLOW_SID,
    fromNumber: process.env.VENUE_208_FROM_NUMBER,
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const b = req.body || {};

  // Minimal server-side validation — never trust the client alone.
  const phoneOk = typeof b.phone === 'string' && /^\+1\d{10}$/.test(b.phone);
  const nameOk = typeof b.firstName === 'string' && b.firstName.trim().length > 0;
  if (!phoneOk || !nameOk || b.consent !== true) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  const venue = VENUES[b.venueId];
  if (!venue) {
    return res.status(400).json({ error: 'Unknown venue' });
  }

  // The consent record. In demo mode it lives in Vercel's function logs;
  // once you add storage (a Google Sheet, Airtable, or DB), write it there too.
  // Keeping consentText + consentTimestamp per signup is your TCPA paper trail.
  const record = {
    venueId: b.venueId,
    firstName: b.firstName.trim(),
    phone: b.phone,
    staffName: b.staffName || null,
    visitType: b.visitType || null,       // 'first' | 'regular'
    local: typeof b.local === 'boolean' ? b.local : null,
    zip: b.zip || null,
    consentText: b.consentText || null,
    consentTimestamp: b.consentTimestamp || new Date().toISOString(),
    page: b.page || null,
    receivedAt: new Date().toISOString(),
  };
  console.log('LOF signup:', JSON.stringify(record));

  const { flowSid, fromNumber } = venue;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  // DEMO MODE — Twilio not wired yet. Page still completes.
  if (!sid || !token || !flowSid || !fromNumber) {
    return res.status(200).json({ ok: true, mode: 'demo' });
  }

  // LIVE MODE — kick off the Studio Flow for this patron.
  // Studio REST API: POST /v2/Flows/{FlowSid}/Executions
  // Everything in Parameters is available inside the flow as {{flow.data.xxx}}
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({
      To: record.phone,
      From: fromNumber,
      Parameters: JSON.stringify({
        firstName: record.firstName,
        visitType: record.visitType,
        staffName: record.staffName,
        local: record.local,
        venueId: record.venueId,
      }),
    });

    const twilioRes = await fetch(
      `https://studio.twilio.com/v2/Flows/${flowSid}/Executions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    );

    if (!twilioRes.ok) {
      const detail = await twilioRes.text();
      console.error('Twilio Studio error:', twilioRes.status, detail);
      return res.status(502).json({ error: 'Message service error' });
    }

    return res.status(200).json({ ok: true, mode: 'live' });
  } catch (err) {
    console.error('Signup handler error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
