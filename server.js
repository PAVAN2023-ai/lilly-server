const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const ANTHROPIC_KEY = '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';
const gmailAccounts = {};

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Lilly Server Online', accounts: Object.keys(gmailAccounts).length });
});

// Claude AI proxy
app.post('/api/ask', async (req, res) => {
  try {
    const { message, history, lang } = req.body;
    const langNames = { 'en-IN': 'English', 'kn-IN': 'Kannada', 'te-IN': 'Telugu', 'hi-IN': 'Hindi' };
    const selectedLang = langNames[lang] || 'English';

    const messages = [...(history || []), { role: 'user', content: message }];

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
CRITICAL: Always respond in ${selectedLang} language only.
Keep answers short — 2 to 3 sentences for simple questions.
For jokes — tell a genuinely funny joke in ${selectedLang}.
Always address user as Pavan. Be warm, friendly and helpful.`,
        messages: messages
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('Anthropic error:', JSON.stringify(data.error));
      return res.status(500).json({ error: data.error.message || 'Claude API error' });
    }

    const reply = data.content && data.content[0] ? data.content[0].text : 'Sorry, please try again.';
    res.json({ reply });

  } catch (e) {
    console.error('Ask error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Save Gmail token
app.post('/api/gmail/save', async (req, res) => {
  try {
    const { email, token, color } = req.body;
    if (!email || !token) return res.status(400).json({ error: 'Missing email or token' });
    gmailAccounts[email] = { email, token, color: color || '#00ffcc' };
    console.log('Gmail saved:', email);
    res.json({ success: true, accounts: Object.keys(gmailAccounts) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all accounts
app.get('/api/gmail/accounts', (req, res) => {
  const list = Object.values(gmailAccounts).map(a => ({ email: a.email, color: a.color }));
  res.json({ accounts: list });
});

// Remove account
app.delete('/api/gmail/remove/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  delete gmailAccounts[email];
  res.json({ success: true });
});

// Fetch today emails
app.post('/api/gmail/mail', async (req, res) => {
  try {
    const { email } = req.body;
    const acct = gmailAccounts[email];
    if (!acct) return res.status(404).json({ error: 'Account not found. Please reconnect Gmail.' });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const after = Math.floor(startOfDay.getTime() / 1000);

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=after:${after}`,
      { headers: { Authorization: `Bearer ${acct.token}` } }
    );

    if (listRes.status === 401) {
      delete gmailAccounts[email];
      return res.status(401).json({ error: 'Gmail session expired. Please tap + Add Gmail to reconnect.' });
    }

    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return res.json({ emails: [], total: 0, unread: 0, email });
    }

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
    console.error('Mail error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lilly Server running on port ${PORT}`));
