const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_KEY = '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';

// Store Gmail tokens in memory (persists while server runs)
// Structure: { email: { token, color, email } }
const gmailAccounts = {};

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'Lilly Server Online', accounts: Object.keys(gmailAccounts).length });
});

// ── CLAUDE AI PROXY ──
app.post('/api/ask', async (req, res) => {
  try {
    const { message, history, lang } = req.body;
    const langNames = { 'en-IN': 'English', 'kn-IN': 'Kannada', 'te-IN': 'Telugu', 'hi-IN': 'Hindi' };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `You are Lilly, a warm personal AI assistant for Pavan who lives in Bengaluru, India.
CRITICAL: Always respond in ${langNames[lang] || 'English'} language only.
Keep answers short — 2 to 3 sentences for simple questions.
For jokes — tell a genuinely funny joke in the selected language.
Always address user as Pavan. Be warm, friendly and helpful.`,
        messages: [...(history || []), { role: 'user', content: message }]
      })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }
    res.json({ reply: data.content[0].text });
  } catch (e) {
    console.error('Claude error:', e);
    res.status(500).json({ error: 'Could not reach Claude AI' });
  }
});

// ── SAVE GMAIL TOKEN ──
app.post('/api/gmail/save', async (req, res) => {
  try {
    const { email, token, color } = req.body;
    if (!email || !token) return res.status(400).json({ error: 'Missing email or token' });

    // Verify token works
    const verify = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!verify.ok) return res.status(401).json({ error: 'Invalid token' });

    gmailAccounts[email] = { email, token, color };
    console.log(`Gmail saved: ${email}`);
    res.json({ success: true, accounts: Object.keys(gmailAccounts) });
  } catch (e) {
    res.status(500).json({ error: 'Could not save account' });
  }
});

// ── GET SAVED ACCOUNTS ──
app.get('/api/gmail/accounts', (req, res) => {
  const list = Object.values(gmailAccounts).map(a => ({ email: a.email, color: a.color }));
  res.json({ accounts: list });
});

// ── REMOVE GMAIL ACCOUNT ──
app.delete('/api/gmail/remove/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  delete gmailAccounts[email];
  res.json({ success: true });
});

// ── FETCH TODAY EMAILS (server-side) ──
app.post('/api/gmail/mail', async (req, res) => {
  try {
    const { email } = req.body;
    const acct = gmailAccounts[email];
    if (!acct) return res.status(404).json({ error: 'Account not found. Please reconnect.' });

    const now = new Date();
    const after = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);

    // Fetch message list
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=after:${after}`,
      { headers: { Authorization: `Bearer ${acct.token}` } }
    );

    if (listRes.status === 401) {
      delete gmailAccounts[email];
      return res.status(401).json({ error: 'Gmail session expired. Please reconnect.' });
    }

    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return res.json({ emails: [], total: 0, unread: 0 });
    }

    // Fetch email details
    const emails = [];
    for (const msg of listData.messages.slice(0, 12)) {
      const detRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${acct.token}` } }
      );
      const det = await detRes.json();
      const headers = det.payload?.headers || [];
      const getH = n => headers.find(h => h.name === n)?.value || '';
      const from = getH('From').replace(/<.*>/, '').replace(/"/g, '').trim() || 'Unknown';
      const subject = getH('Subject') || '(no subject)';
      const isUnread = (det.labelIds || []).includes('UNREAD');
      const snippet = (det.snippet || '').substring(0, 100);
      emails.push({ from, subject, snippet, isUnread });
    }

    const unread = emails.filter(e => e.isUnread).length;
    res.json({ emails, total: listData.messages.length, unread, email });
  } catch (e) {
    console.error('Mail fetch error:', e);
    res.status(500).json({ error: 'Could not fetch emails' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lilly Server running on port ${PORT}`));
