# Vanguard Executive AI - Webhook Server

This is your bulletproof backend server. It receives the end-of-call report from Vapi, parses the transcript to extract lead information (name, time, budget, etc.), sends you an SMS alert via Twilio, and creates the contact directly in GoHighLevel using their API.

**No Make.com. No broken native integrations. No Cal.com errors.**

## How It Works

1. The caller talks to your Vapi agent.
2. The agent collects their info and says "We'll confirm shortly."
3. The call ends. Vapi sends the transcript to this server.
4. This server reads the transcript, pulls out the details, and scores the lead (HOT/WARM/COLD).
5. The server sends you a text message with the summary.
6. The server creates a contact in GoHighLevel with all the extracted data.

## How to Deploy (Takes 5 Minutes)

We are going to deploy this to **Render.com** (it's free and reliable).

### Step 1: Get Your Code Online
1. Create a free account on [GitHub](https://github.com/)
2. Create a new repository called `vanguard-webhook`
3. Upload these 4 files to the repository:
   - `index.js`
   - `package.json`
   - `render.yaml`
   - `README.md`

### Step 2: Deploy to Render
1. Create a free account on [Render.com](https://render.com/)
2. Click **New +** -> **Web Service**
3. Connect your GitHub account and select the `vanguard-webhook` repository
4. Render will automatically detect the settings from `render.yaml`
5. Click **Create Web Service**

### Step 3: Add Your API Keys (Environment Variables)
While it's deploying, click on **Environment** in the left sidebar on Render and add these variables:

| Key | Value | Where to find it |
|-----|-------|------------------|
| `TWILIO_ACCOUNT_SID` | `ACxxxxxxxxxxxx` | Twilio Console Dashboard |
| `TWILIO_AUTH_TOKEN` | `xxxxxxxxxxxxxx` | Twilio Console Dashboard |
| `TWILIO_PHONE_NUMBER` | `+17065551234` | Your Twilio Phone Number |
| `YOUR_PHONE_NUMBER` | `+17065559876` | Your actual cell phone number |
| `GHL_API_KEY` | `pit-xxxxxxxxxxxx` | GHL -> Settings -> Company -> API Key |
| `GHL_LOCATION_ID` | `xxxxxxxxxxxxxx` | GHL -> Settings -> Business Info -> Location ID |

Click **Save Changes**.

### Step 4: Connect to Vapi
1. Once deployed, Render will give you a URL at the top left (e.g., `https://vanguard-webhook-xyz.onrender.com`)
2. Copy that URL and add `/webhook` to the end (e.g., `https://vanguard-webhook-xyz.onrender.com/webhook`)
3. Go to **Vapi Dashboard** -> **Account Settings** (or your Assistant settings)
4. Paste the URL into the **Server URL** field.

## You're Done!
Test it by calling your agent. As soon as you hang up, you should get a text message and see the contact appear in GoHighLevel.
