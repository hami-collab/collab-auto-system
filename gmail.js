import { google } from 'googleapis'
import dotenv from 'dotenv'
dotenv.config()

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
)

let storedTokens = null


// ==============================
// GET GOOGLE AUTH URL
// ==============================
export function getAuthUrl() {
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly'
    ],
  })
}


// ==============================
// SET CREDENTIALS
// ==============================
export async function setCredentials(code) {
  const { tokens } = await oAuth2Client.getToken(code)

  oAuth2Client.setCredentials(tokens)
  storedTokens = tokens

  return tokens
}


// ==============================
// SEND FIRST OUTREACH
// ==============================
export async function sendFirstOutreachEmail(toEmail) {

  if (!storedTokens) {
    throw new Error('Gmail not connected. Run /auth/google first.')
  }

  oAuth2Client.setCredentials(storedTokens)

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client })

  const subject = "Collaboration Opportunity 🚀"
  const message = `
Hi,

I hope you're doing well.

I’d love to explore a potential collaboration opportunity with you.
We believe your audience would be a great fit for our brand.

Let me know if you're interested and I can send over more details.

Best regards,
Your Name
`

  const rawMessage = [
    `From: me`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    message
  ].join('\n')

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage
    },
  })

  return {
    messageId: response.data.id,
    threadId: response.data.threadId
  }
}


// ==============================
// SEND FOLLOW UP (SAME THREAD)
// ==============================
export async function sendFollowUp(threadId, toEmail, followUpNumber) {

  if (!storedTokens) {
    throw new Error('Gmail not connected.')
  }

  oAuth2Client.setCredentials(storedTokens)

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client })

  let messageBody = ""

  if (followUpNumber === 1) {
    messageBody = `
Hi again,

Just wanted to follow up in case my previous email got buried.

Would love to collaborate if you're open to it.

Looking forward to your thoughts!
`
  }

  if (followUpNumber === 2) {
    messageBody = `
Final follow-up 🙂

I completely understand if now isn’t the right time.

If you're interested, I'd still be happy to collaborate.

Wishing you all the best!
`
  }

  const rawMessage = [
    `To: ${toEmail}`,
    `Subject: Re: Collaboration Opportunity 🚀`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    messageBody
  ].join('\n')

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId: threadId
    },
  })
}


// ==============================
// CHECK FOR REPLY
// ==============================
export async function checkForReply(threadId) {

  if (!storedTokens) {
    throw new Error('Gmail not connected.')
  }

  oAuth2Client.setCredentials(storedTokens)

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client })

  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId
  })

  const messages = thread.data.messages

  if (messages.length > 1) {
    return true
  }

  return false
}