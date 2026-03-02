import express from 'express'
import supabase from './supabase.js'
import { 
  getAuthUrl, 
  setCredentials, 
  sendFirstOutreachEmail, 
  checkForReply,
  sendFollowUp
} from './gmail.js'
import cron from 'node-cron'

const app = express()
app.use(express.json())

const PORT = 3000

// ===============================
// FUNCTION: CHECK REPLIES
// ===============================
async function runReplyCheck() {

  const { data: creators } = await supabase
    .from('creators')
    .select('*')
    .eq('replied', false)

  for (const creator of creators) {

    if (!creator.thread_id) continue

    const hasReply = await checkForReply(creator.thread_id)

    if (hasReply) {
      await supabase
        .from('creators')
        .update({
          replied: true,
          status: 'replied'
        })
        .eq('id', creator.id)

      console.log(`Reply detected for: ${creator.creator_email}`)
    }
  }
}


// ===============================
// FUNCTION: RUN FOLLOW UPS
// ===============================
async function runFollowUps() {

  const { data: creators } = await supabase
    .from('creators')
    .select('*')
    .eq('replied', false)

  const now = new Date()

  for (const creator of creators) {

    if (!creator.last_email_sent) continue

    const lastSent = new Date(creator.last_email_sent)
    const diffDays = (now - lastSent) / (1000 * 60 * 60 * 24)

    if (creator.follow_up_count === 0 && diffDays >= 2) {

      await sendFollowUp(
        creator.thread_id,
        creator.creator_email,
        1
      )

      await supabase
        .from('creators')
        .update({
          follow_up_count: 1,
          last_email_sent: now.toISOString()
        })
        .eq('id', creator.id)

      console.log(`Follow-up 1 sent to: ${creator.creator_email}`)
    }

    if (creator.follow_up_count === 1 && diffDays >= 3) {

      await sendFollowUp(
        creator.thread_id,
        creator.creator_email,
        2
      )

      await supabase
        .from('creators')
        .update({
          follow_up_count: 2,
          last_email_sent: now.toISOString()
        })
        .eq('id', creator.id)

      console.log(`Follow-up 2 sent to: ${creator.creator_email}`)
    }
  }
}


// ===============================
// ROOT TEST
// ===============================
app.get('/', (req, res) => {
  res.send('Collab System Running 🚀')
})


// ===============================
// GET ALL CREATORS
// ===============================
app.get('/creators', async (req, res) => {
  const { data, error } = await supabase
    .from('creators')
    .select('*')

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
})


// ===============================
// ADD SINGLE CREATOR
// ===============================
app.post('/creators', async (req, res) => {
  const { creator_email, social_link, paypal_email } = req.body

  const { data, error } = await supabase
    .from('creators')
    .insert([
      {
        creator_email,
        social_link,
        paypal_email,
        status: 'new',
        stage: 'new',
        follow_up_count: 0,
        replied: false
      }
    ])
    .select()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
})


// ===============================
// BULK IMPORT + AUTO FIRST OUTREACH
// ===============================
app.post('/creators/bulk', async (req, res) => {
  try {
    const { emails } = req.body

    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ error: 'Emails must be an array.' })
    }

    const cleanedEmails = emails
      .map(e => e.trim().toLowerCase())
      .filter(e => /\S+@\S+\.\S+/.test(e))

    if (cleanedEmails.length === 0) {
      return res.status(400).json({ error: 'No valid emails found.' })
    }

    const { data: existing } = await supabase
      .from('creators')
      .select('creator_email')

    const existingEmails = existing.map(e => e.creator_email)

    const newEmails = cleanedEmails.filter(
      e => !existingEmails.includes(e)
    )

    if (newEmails.length === 0) {
      return res.json({
        message: 'All emails already exist.',
        inserted: 0
      })
    }

    const insertPayload = newEmails.map(email => ({
      creator_email: email,
      status: 'new',
      stage: 'new',
      follow_up_count: 0,
      replied: false
    }))

    const { error } = await supabase
      .from('creators')
      .insert(insertPayload)

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    for (const email of newEmails) {

      const gmailResponse = await sendFirstOutreachEmail(email)

      await supabase
        .from('creators')
        .update({
          status: 'contacted',
          thread_id: gmailResponse.threadId,
          last_email_sent: new Date().toISOString()
        })
        .eq('creator_email', email)
    }

    res.json({
      message: 'Bulk import + outreach sent',
      inserted: newEmails.length
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})


// ===============================
// CHECK REPLIES
// ===============================
app.get('/check-replies', async (req, res) => {

  const { data: creators } = await supabase
    .from('creators')
    .select('*')
    .eq('replied', false)

  for (const creator of creators) {

    if (!creator.thread_id) continue

    const hasReply = await checkForReply(creator.thread_id)

    if (hasReply) {
      await supabase
        .from('creators')
        .update({
          replied: true,
          status: 'replied'
        })
        .eq('id', creator.id)
    }
  }

  res.send('Reply check complete')
})


// ===============================
// RUN FOLLOW UPS
// ===============================
app.get('/run-followups', async (req, res) => {

  const { data: creators } = await supabase
    .from('creators')
    .select('*')
    .eq('replied', false)

  const now = new Date()

  for (const creator of creators) {

    if (!creator.last_email_sent || creator.replied) continue

    const lastSent = new Date(creator.last_email_sent)
    const diffDays = (now - lastSent) / (1000 * 60 * 60 * 24)

    if (creator.follow_up_count === 0 && diffDays >= 2) {

      await sendFollowUp(
        creator.thread_id,
        creator.creator_email,
        1
      )

      await supabase
        .from('creators')
        .update({
          follow_up_count: 1,
          last_email_sent: now.toISOString()
        })
        .eq('id', creator.id)
    }

    if (creator.follow_up_count === 1 && diffDays >= 3) {

      await sendFollowUp(
        creator.thread_id,
        creator.creator_email,
        2
      )

      await supabase
        .from('creators')
        .update({
          follow_up_count: 2,
          last_email_sent: now.toISOString()
        })
        .eq('id', creator.id)
    }
  }

  res.send('Follow-up check complete')
})


// ===============================
// GOOGLE OAUTH
// ===============================
app.get('/auth/google', (req, res) => {
  const url = getAuthUrl()
  res.redirect(url)
})

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query
  await setCredentials(code)
  res.send('Gmail connected successfully. You can close this window.')
})


// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

// ===============================
// AUTOMATION SCHEDULER
// ===============================

// Every 10 minutes → Check replies
cron.schedule('*/10 * * * *', async () => {
  console.log('⏳ Running automatic reply check...')
  await runReplyCheck()
})

// Every 1 hour → Run follow-ups
cron.schedule('0 * * * *', async () => {
  console.log('⏳ Running automatic follow-ups...')
  await runFollowUps()
})