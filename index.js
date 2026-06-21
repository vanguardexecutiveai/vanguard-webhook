const express = require('express');
const app = express();

app.use(express.json());

// ============================================================
// VANGUARD EXECUTIVE AI - WEBHOOK SERVER
// ============================================================
// This server receives end-of-call reports from Vapi,
// extracts lead information, sends you an SMS via Twilio,
// and creates a contact in GoHighLevel.
// ============================================================

// ---------- YOUR SETTINGS (CHANGE THESE) ----------
const CONFIG = {
  // Twilio (for SMS notifications to YOU)
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || 'YOUR_TWILIO_ACCOUNT_SID',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || 'YOUR_TWILIO_AUTH_TOKEN',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '+1XXXXXXXXXX', // Your Twilio number
  YOUR_PHONE_NUMBER: process.env.YOUR_PHONE_NUMBER || '+1XXXXXXXXXX', // YOUR cell phone

  // GoHighLevel
  GHL_API_KEY: process.env.GHL_API_KEY || 'YOUR_GHL_API_KEY', // Private Integration Token
  GHL_LOCATION_ID: process.env.GHL_LOCATION_ID || 'YOUR_GHL_LOCATION_ID', // Sub-account Location ID

  // Server
  PORT: process.env.PORT || 3000
};
// ---------------------------------------------------

// Initialize Twilio (lazy - only when actually sending)
const twilioLib = require('twilio');
let twilioClient = null;

function getTwilioClient() {
  if (!twilioClient) {
    if (!CONFIG.TWILIO_ACCOUNT_SID.startsWith('AC')) {
      console.warn('[TWILIO] Account SID not configured - SMS notifications disabled');
      return null;
    }
    twilioClient = twilioLib(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

// ============================================================
// MAIN WEBHOOK ENDPOINT - Receives ALL Vapi events
// ============================================================
app.post('/webhook', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(200).json({ status: 'ok' });
    }

    console.log(`[${new Date().toISOString()}] Received event: ${message.type}`);

    // We only care about end-of-call reports
    if (message.type === 'end-of-call-report') {
      await handleEndOfCallReport(message);
    }

    // Always respond 200 so Vapi doesn't retry
    res.status(200).json({ status: 'received' });

  } catch (error) {
    console.error('[ERROR]', error.message);
    // Still return 200 - don't let errors cause Vapi retries
    res.status(200).json({ status: 'error', message: error.message });
  }
});

// ============================================================
// HANDLE END-OF-CALL REPORT
// ============================================================
async function handleEndOfCallReport(message) {
  console.log('[CALL ENDED] Processing end-of-call report...');

  // Extract data from the call
  const callData = extractCallData(message);

  console.log('[EXTRACTED]', JSON.stringify(callData, null, 2));

  // Step 1: Send YOU an SMS with the lead info
  await sendSmsNotification(callData);

  // Step 2: Create contact in GoHighLevel
  await createGhlContact(callData);

  console.log('[DONE] Lead processed successfully.');
}

// ============================================================
// EXTRACT LEAD DATA FROM TRANSCRIPT
// ============================================================
function extractCallData(message) {
  const transcript = message.artifact?.transcript || '';
  const messages = message.artifact?.messages || [];
  const call = message.call || {};

  // Get caller's phone number from the call object
  const callerPhone = call.customer?.number || 'Unknown';

  // Parse the transcript to find lead info
  const leadInfo = parseTranscript(transcript, messages);

  return {
    phone: callerPhone,
    name: leadInfo.name || 'Unknown Caller',
    email: leadInfo.email || '',
    preferredTime: leadInfo.preferredTime || 'Not specified',
    propertyInterest: leadInfo.propertyInterest || 'Not specified',
    budget: leadInfo.budget || 'Not specified',
    preApproved: leadInfo.preApproved || 'Not specified',
    timeline: leadInfo.timeline || 'Not specified',
    qualification: leadInfo.qualification || 'UNKNOWN',
    callDuration: message.call?.duration || 0,
    endedReason: message.endedReason || 'unknown',
    summary: leadInfo.summary || transcript.substring(0, 500),
    fullTranscript: transcript
  };
}

// ============================================================
// PARSE TRANSCRIPT FOR KEY INFORMATION
// ============================================================
function parseTranscript(transcript, messages) {
  const info = {};
  const lowerTranscript = transcript.toLowerCase();

  // --- Extract Name ---
  // Look for patterns like "my name is X" or "this is X" or "I'm X"
  const namePatterns = [
    /my name is ([a-zA-Z]+ ?[a-zA-Z]*)/i,
    /this is ([a-zA-Z]+ ?[a-zA-Z]*)/i,
    /i'm ([a-zA-Z]+ ?[a-zA-Z]*)/i,
    /call me ([a-zA-Z]+ ?[a-zA-Z]*)/i,
    /it's ([a-zA-Z]+ ?[a-zA-Z]*)/i,
    /name's ([a-zA-Z]+ ?[a-zA-Z]*)/i
  ];

  for (const pattern of namePatterns) {
    const match = transcript.match(pattern);
    if (match && match[1]) {
      // Filter out common false positives
      const name = match[1].trim();
      const falsePositives = ['calling', 'looking', 'interested', 'wondering', 'trying', 'here', 'just', 'not'];
      if (!falsePositives.includes(name.toLowerCase())) {
        info.name = name;
        break;
      }
    }
  }

  // --- Extract Email ---
  const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const emailMatch = transcript.match(emailPattern);
  if (emailMatch) {
    info.email = emailMatch[1];
  }

  // --- Extract Preferred Time ---
  const timePatterns = [
    /(?:how about|let's do|i'd like|prefer|available|free|works for me)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at|around|about)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at|around|about)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /(?:at|around|about)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)/i,
    /(?:how about|let's do|i'd like)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)?)/i
  ];

  for (const pattern of timePatterns) {
    const match = transcript.match(pattern);
    if (match) {
      info.preferredTime = match[0].trim();
      break;
    }
  }

  // --- Extract Budget ---
  const budgetPatterns = [
    /budget.*?(\$[\d,]+(?:k)?(?:\s*(?:to|-)\s*\$[\d,]+(?:k)?)?)/i,
    /(\$[\d,]+(?:k)?(?:\s*(?:to|-)\s*\$[\d,]+(?:k)?)?)\s*(?:range|budget|max|maximum)/i,
    /(?:around|about|up to|no more than)\s*(\$[\d,]+(?:k)?)/i,
    /(\d{3}(?:,\d{3})*(?:k)?)\s*(?:dollars|range|budget)/i
  ];

  for (const pattern of budgetPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      info.budget = match[1] || match[0];
      break;
    }
  }

  // --- Extract Pre-Approval Status ---
  if (lowerTranscript.includes('pre-approved') || lowerTranscript.includes('preapproved') || lowerTranscript.includes('pre approved')) {
    if (lowerTranscript.includes('yes') || lowerTranscript.includes('i am') || lowerTranscript.includes("i'm pre")) {
      info.preApproved = 'Yes';
    } else if (lowerTranscript.includes('not yet') || lowerTranscript.includes('no') || lowerTranscript.includes('working on')) {
      info.preApproved = 'No';
    }
  }

  // --- Extract Timeline ---
  const timelinePatterns = [
    /(?:looking to|want to|need to|hoping to).*?(?:buy|purchase|move|close).*?(immediately|asap|this month|next month|within \d+ (?:days|weeks|months)|in \d+ (?:days|weeks|months)|\d+ (?:days|weeks|months))/i,
    /timeline.*?(immediately|asap|this month|next month|within \d+ (?:days|weeks|months)|in \d+ (?:days|weeks|months)|\d+-\d+ (?:days|weeks|months))/i,
    /(just browsing|just looking|no rush|not in a hurry|taking my time)/i
  ];

  for (const pattern of timelinePatterns) {
    const match = transcript.match(pattern);
    if (match) {
      info.timeline = match[1] || match[0];
      break;
    }
  }

  // --- Determine Qualification Level ---
  let score = 0;
  if (info.preApproved === 'Yes') score += 3;
  if (info.budget) score += 2;
  if (info.timeline && !info.timeline.toLowerCase().includes('browsing') && !info.timeline.toLowerCase().includes('no rush')) score += 2;
  if (info.preferredTime) score += 1;
  if (info.name) score += 1;

  if (score >= 6) info.qualification = 'HOT';
  else if (score >= 3) info.qualification = 'WARM';
  else info.qualification = 'COLD';

  // --- Build Summary ---
  info.summary = buildSummary(info, transcript);

  return info;
}

// ============================================================
// BUILD A CLEAN SUMMARY
// ============================================================
function buildSummary(info, transcript) {
  let summary = '';
  if (info.name) summary += `Name: ${info.name}\n`;
  if (info.preferredTime) summary += `Preferred Time: ${info.preferredTime}\n`;
  if (info.budget) summary += `Budget: ${info.budget}\n`;
  if (info.preApproved) summary += `Pre-Approved: ${info.preApproved}\n`;
  if (info.timeline) summary += `Timeline: ${info.timeline}\n`;
  if (info.qualification) summary += `Lead Score: ${info.qualification}\n`;

  if (!summary) {
    // If we couldn't extract structured data, use first 300 chars of transcript
    summary = `Call transcript (first 300 chars):\n${transcript.substring(0, 300)}`;
  }

  return summary;
}

// ============================================================
// SEND SMS NOTIFICATION TO YOU
// ============================================================
async function sendSmsNotification(callData) {
  try {
    const smsBody = `🔥 NEW LEAD - ${callData.qualification}

Name: ${callData.name}
Phone: ${callData.phone}
Email: ${callData.email || 'N/A'}
Preferred Time: ${callData.preferredTime}
Budget: ${callData.budget}
Pre-Approved: ${callData.preApproved}
Timeline: ${callData.timeline}
Call Duration: ${Math.round(callData.callDuration / 60)}min

ACTION: Call back within 5 min!`;

    const client = getTwilioClient();
    if (!client) {
      console.log('[SMS] Skipped - Twilio not configured');
      return;
    }

    await client.messages.create({
      body: smsBody,
      from: CONFIG.TWILIO_PHONE_NUMBER,
      to: CONFIG.YOUR_PHONE_NUMBER
    });

    console.log('[SMS] Notification sent to', CONFIG.YOUR_PHONE_NUMBER);
  } catch (error) {
    console.error('[SMS ERROR]', error.message);
    // Don't throw - we still want to create the GHL contact even if SMS fails
  }
}

// ============================================================
// CREATE CONTACT IN GOHIGHLEVEL
// ============================================================
async function createGhlContact(callData) {
  try {
    const contactData = {
      firstName: callData.name.split(' ')[0] || 'Unknown',
      lastName: callData.name.split(' ').slice(1).join(' ') || '',
      phone: callData.phone,
      email: callData.email || undefined,
      locationId: CONFIG.GHL_LOCATION_ID,
      source: 'Vanguard AI Agent',
      tags: [
        'ai-lead',
        `qualification-${callData.qualification.toLowerCase()}`,
        'vapi-inbound'
      ],
      customFields: [
        { key: 'preferred_time', fieldValue: callData.preferredTime },
        { key: 'budget', fieldValue: callData.budget },
        { key: 'pre_approved', fieldValue: callData.preApproved },
        { key: 'timeline', fieldValue: callData.timeline },
        { key: 'lead_score', fieldValue: callData.qualification },
        { key: 'call_transcript', fieldValue: callData.fullTranscript.substring(0, 5000) }
      ].filter(f => f.fieldValue && f.fieldValue !== 'Not specified')
    };

    // Remove undefined fields
    Object.keys(contactData).forEach(key => {
      if (contactData[key] === undefined) delete contactData[key];
    });

    const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.GHL_API_KEY}`,
        'Version': '2021-07-28'
      },
      body: JSON.stringify(contactData)
    });

    const result = await response.json();

    if (response.ok) {
      console.log('[GHL] Contact created:', result.contact?.id);
    } else {
      console.error('[GHL ERROR] Status:', response.status, 'Body:', JSON.stringify(result));
    }
  } catch (error) {
    console.error('[GHL ERROR]', error.message);
  }
}

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================
app.get('/', (req, res) => {
  res.json({
    status: 'live',
    service: 'Vanguard Executive AI - Webhook Server',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(CONFIG.PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   VANGUARD EXECUTIVE AI - WEBHOOK SERVER        ║
  ║   Running on port ${CONFIG.PORT}                          ║
  ║   Ready to receive Vapi end-of-call reports     ║
  ╚══════════════════════════════════════════════════╝
  `);
});
